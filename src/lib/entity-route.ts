// Reusable API-route factories for the standard tenant-scoped CRUD entities
// (audiences, topics, assets, creatives, text_formatting). These routes were
// byte-for-byte identical except for the entity functions and the response key,
// so the duplication is collapsed here — and the SQLite→Postgres async wiring
// lives in ONE place instead of being copy-pasted across ~19 route files.
//
// Entities with extra behaviour (messages' propagate, snapshots, files, feed
// exports, etc.) keep bespoke routes.
import { NextResponse } from "next/server";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { type BlockingMc } from "@/lib/entities/mc-refs";
import {
  previewRekey,
  rekeyDimension,
  type Dimension,
} from "@/lib/entities/rekey";
import {
  missingVersion,
  readClientVersion,
  versionMismatch,
} from "@/lib/optimistic";

type Params = { id: string };

export function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const badId = () => NextResponse.json({ error: "bad_id" }, { status: 400 });
const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

type Row = { id: number; version: number };
type Mut<R> =
  | { ok: true; row: R; cascadedMessageIds?: number[] }
  | { ok: false; current: R | null };
type DeleteRes<R> =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_mismatch"; current: R }
  | { ok: false; reason: "in_use"; referencedBy: BlockingMc[] };

// GET (list) + POST (create)
export function makeCollectionRoute<R extends Row, I>(cfg: {
  listKey: string;
  itemKey: string;
  entityType: string;
  // List rows are only JSON-serialized in the GET response, so they're
  // decoupled from R (e.g. listAudiences returns Audience & { mcCount }).
  list: (cid: number, opts: { includeArchived: boolean }) => Promise<readonly unknown[]>;
  // The raw request body is passed third so an entity can read fields that
  // must stay out of its writable input (e.g. messages' mc_number).
  create: (cid: number, input: I, body?: unknown) => Promise<R>;
  pickWritable: (body: unknown) => I;
  /** Map a known validation error to a 400 message; return null to rethrow. */
  validationError?: (e: unknown) => string | null;
}) {
  const GET = withSession(async ({ req, claims }) => {
    const includeArchived =
      new URL(req.url).searchParams.get("includeArchived") === "1";
    return NextResponse.json({
      [cfg.listKey]: await cfg.list(claims.cid, { includeArchived }),
    });
  });

  const POST = withSession(async ({ req, claims }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const body = await req.json().catch(() => null);
    const input = cfg.pickWritable(body);
    try {
      const row = await cfg.create(claims.cid, input, body);
      await writeAudit({
        clientId: claims.cid,
        userId: claims.sub,
        entityType: cfg.entityType,
        entityId: row.id,
        action: "create",
        after: row,
      });
      return NextResponse.json({ [cfg.itemKey]: row }, { status: 201 });
    } catch (e) {
      const msg = cfg.validationError?.(e);
      if (msg != null) return NextResponse.json({ error: msg }, { status: 400 });
      throw e;
    }
  });

  return { GET, POST };
}

// GET (one) + PATCH (update) + DELETE (archive)
export function makeItemRoute<R extends Row, I>(cfg: {
  itemKey: string;
  entityType: string;
  get: (cid: number, id: number) => Promise<R | null>;
  update: (cid: number, id: number, expected: number, input: I) => Promise<Mut<R>>;
  archive: (cid: number, id: number, expected: number) => Promise<Mut<R>>;
  pickWritable: (body: unknown) => I;
  /** Include result.cascadedMessageIds in the DELETE response (audiences/topics). */
  cascade?: boolean;
}) {
  const GET = withSession<Params>(async ({ claims, params }) => {
    const id = parseId(params.id);
    if (!id) return badId();
    const row = await cfg.get(claims.cid, id);
    if (!row) return notFound();
    return NextResponse.json({ [cfg.itemKey]: row });
  });

  const PATCH = withSession<Params>(async ({ req, claims, params }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const id = parseId(params.id);
    if (!id) return badId();
    const body = await req.json().catch(() => null);
    const expected = readClientVersion(req, body);
    if (expected === null) return missingVersion();
    const input = cfg.pickWritable(body);
    const before = await cfg.get(claims.cid, id);
    const result = await cfg.update(claims.cid, id, expected, input);
    if (!result.ok) {
      if (!result.current) return notFound();
      return versionMismatch(result.current, result.current.version);
    }
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: cfg.entityType,
      entityId: id,
      action: "update",
      before,
      after: result.row,
    });
    return NextResponse.json({ [cfg.itemKey]: result.row });
  });

  const DELETE = withSession<Params>(async ({ req, claims, params }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const id = parseId(params.id);
    if (!id) return badId();
    const expected = readClientVersion(req, null);
    if (expected === null) return missingVersion();
    const before = await cfg.get(claims.cid, id);
    const result = await cfg.archive(claims.cid, id, expected);
    if (!result.ok) {
      if (!result.current) return notFound();
      return versionMismatch(result.current, result.current.version);
    }
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: cfg.entityType,
      entityId: id,
      action: "archive",
      before,
      after: result.row,
    });
    const payload: Record<string, unknown> = { [cfg.itemKey]: result.row };
    if (cfg.cascade) payload.cascadedMessageIds = result.cascadedMessageIds ?? [];
    return NextResponse.json(payload);
  });

  return { GET, PATCH, DELETE };
}

// POST — restore an archived row
export function makeRestoreRoute<R extends Row>(cfg: {
  itemKey: string;
  entityType: string;
  get: (cid: number, id: number) => Promise<R | null>;
  restore: (cid: number, id: number, expected: number) => Promise<Mut<R>>;
}) {
  const POST = withSession<Params>(async ({ req, claims, params }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const id = parseId(params.id);
    if (!id) return badId();
    const body = await req.json().catch(() => null);
    const expected = readClientVersion(req, body);
    if (expected === null) return missingVersion();
    const before = await cfg.get(claims.cid, id);
    const result = await cfg.restore(claims.cid, id, expected);
    if (!result.ok) {
      if (!result.current) return notFound();
      return versionMismatch(result.current, result.current.version);
    }
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: cfg.entityType,
      entityId: id,
      action: "restore",
      before,
      after: result.row,
    });
    return NextResponse.json({ [cfg.itemKey]: result.row });
  });
  return { POST };
}

// POST — duplicate a row
export function makeDuplicateRoute<R extends Row>(cfg: {
  itemKey: string;
  entityType: string;
  duplicate: (cid: number, id: number) => Promise<R | null>;
}) {
  const POST = withSession<Params>(async ({ claims, params }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const id = parseId(params.id);
    if (!id) return badId();
    const row = await cfg.duplicate(claims.cid, id);
    if (!row) return notFound();
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: cfg.entityType,
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ [cfg.itemKey]: row }, { status: 201 });
  });
  return { POST };
}

// GET (preview) + POST (apply) — regenerate the row's key from its pattern and
// carry every referencing MC along. GET is the preview the UI shows before the
// user commits; POST refuses on a stale-version, a no-op, or any blocker.
export function makeRekeyRoute(cfg: {
  itemKey: string;
  dimension: Dimension;
}) {
  const GET = withSession<Params>(async ({ claims, params }) => {
    const id = parseId(params.id);
    if (!id) return badId();
    const preview = await previewRekey(claims.cid, cfg.dimension, id);
    if (!preview) return notFound();
    return NextResponse.json({ preview });
  });

  const POST = withSession<Params>(async ({ req, claims, params }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const id = parseId(params.id);
    if (!id) return badId();
    const body = await req.json().catch(() => null);
    const expected = readClientVersion(req, body);
    if (expected === null) return missingVersion();
    const result = await rekeyDimension(
      claims.cid,
      cfg.dimension,
      id,
      expected,
      claims.sub,
    );
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      if (result.reason === "version_mismatch") {
        return versionMismatch(result.current, result.current.version);
      }
      // not_stale is not an error the user caused — the key already matches the
      // pattern (a peer got there first). Both carry the preview so the client
      // can show why nothing happened.
      return NextResponse.json(
        { error: result.reason, preview: result.preview },
        { status: 409 },
      );
    }
    // The cascade wrote its own audit rows (one per MC, plus the dimension
    // row); no writeAudit here or the change would be recorded twice.
    return NextResponse.json({
      [cfg.itemKey]: result.row,
      newKey: result.newKey,
      messageIds: result.messageIds,
    });
  });

  return { GET, POST };
}

// POST — hard delete (refuses on in_use)
export function makeHardDeleteRoute<R extends Row>(cfg: {
  entityType: string;
  get: (cid: number, id: number) => Promise<R | null>;
  remove: (cid: number, id: number, expected: number) => Promise<DeleteRes<R>>;
}) {
  const POST = withSession<Params>(async ({ req, claims, params }) => {
    const denial = denyDemo(claims);
    if (denial) return denial;
    const id = parseId(params.id);
    if (!id) return badId();
    const body = await req.json().catch(() => null);
    const expected = readClientVersion(req, body);
    if (expected === null) return missingVersion();
    const before = await cfg.get(claims.cid, id);
    const result = await cfg.remove(claims.cid, id, expected);
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      if (result.reason === "version_mismatch") {
        return versionMismatch(result.current, result.current.version);
      }
      return NextResponse.json(
        { error: "in_use", referencedBy: result.referencedBy },
        { status: 409 },
      );
    }
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: cfg.entityType,
      entityId: id,
      action: "delete",
      before,
    });
    return NextResponse.json({ ok: true });
  });
  return { POST };
}
