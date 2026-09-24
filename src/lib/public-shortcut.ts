// Signed public image URLs — the token behind /publicshortcut/<token>[/<size>].
//
// It is a SIGNATURE, not a cipher: the id travels in the clear and the MAC
// beside it is what cannot be produced without the secret. That is what makes
// the URL computable from outside (an agent holding a message id can build its
// own link) while staying unforgeable, and it keeps verification O(1) — no
// enumeration of every candidate row on each request.
//
// The signature REPLACES the status gate (user decision, 2026-09-24): a draft
// preview is served like any other, because following how a draft evolves is
// exactly what a client's agent is given a link for.
//
// The crypto half is pure and takes the secret as an argument; only the two
// thin wrappers at the bottom touch the database. That keeps the signing rules
// unit-testable without a Postgres, and it is the half that must be right.
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemConfig } from "@/db/schema";

/** `m` = a message's DCO preview (needs a size), `c` = an agentic creative file. */
export type ShortcutKind = "m" | "c";

export const SECRET_KEY = "public_shortcut_secret";

const TOKEN_RE = /^([mc])(\d+)\.([0-9a-f]{16})$/;
const SIG_LEN = 16;

export function signPayload(secret: string, payload: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, SIG_LEN);
}

/** `m`, 1877 -> `m1877.b990c3f692bb257c` */
export function signTokenWith(
  secret: string,
  kind: ShortcutKind,
  id: number,
): string {
  const payload = `${kind}${id}`;
  return `${payload}.${signPayload(secret, payload)}`;
}

/**
 * Null for anything that does not verify — a malformed token or a bad
 * signature. The caller turns every one of those into the same 404, so a probe
 * cannot tell them apart.
 */
export function verifyTokenWith(
  secret: string,
  token: string,
): { kind: ShortcutKind; id: number } | null {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, kind, idRaw, sig] = m;
  const expected = signPayload(secret, `${kind}${idRaw}`);
  // Equal length by construction (both 16 hex chars), so timingSafeEqual never
  // throws here and the comparison does not leak the prefix that matched.
  if (
    !crypto.timingSafeEqual(Buffer.from(sig!, "hex"), Buffer.from(expected, "hex"))
  ) {
    return null;
  }
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { kind: kind as ShortcutKind, id };
}

/** Same mask format Settings → MCP uses for bearer tokens. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** A fresh secret for the Settings → API rotate button. */
export function generateSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// Read per call, never cached: the one moment the value must not be stale is a
// rotation, which is also the only moment it ever changes.
export async function readSecret(): Promise<string | null> {
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, SECRET_KEY))
    .limit(1);
  const v = row?.value?.trim();
  return v ? v : null;
}

/** Null when no secret is configured — nothing can be signed, and nothing serves. */
export async function signToken(
  kind: ShortcutKind,
  id: number,
): Promise<string | null> {
  const secret = await readSecret();
  return secret ? signTokenWith(secret, kind, id) : null;
}

export async function verifyToken(
  token: string,
): Promise<{ kind: ShortcutKind; id: number } | null> {
  const secret = await readSecret();
  return secret ? verifyTokenWith(secret, token) : null;
}

/**
 * The secret, creating it on first use.
 *
 * Only ever called by code that is about to HAND OUT a link — an MCP tool
 * result, the share viewer's index, an export. Without this, the very first
 * deploy would answer `list_mc` with an empty preview_urls map until somebody
 * happened to open Settings → API, which reads as "there are no previews"
 * rather than as "nothing has been configured". The verifier deliberately does
 * NOT use it: a request that arrives with no secret in the database is a 404,
 * not a reason to mint one.
 */
export async function ensureSecret(): Promise<string> {
  const existing = await readSecret();
  if (existing) return existing;
  await db
    .insert(systemConfig)
    .values({
      key: SECRET_KEY,
      value: generateSecret(),
      description:
        "HMAC secret for /publicshortcut signed image URLs. Rotating it invalidates every link already handed out.",
    })
    .onConflictDoNothing();
  // Re-read rather than returning what we just built: a concurrent first call
  // may have won the insert, and both must end up signing with the same value.
  const created = await readSecret();
  if (!created) throw new Error("public shortcut secret could not be created");
  return created;
}
