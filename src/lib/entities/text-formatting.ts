import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { textFormatting, type TextFormatting } from "@/db/schema";

const WRITABLE_FIELDS = [
  "textOriginal",
  "textFormatted",
  "formattingScope",
  "formattingMcScope",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type TextFormattingInput = Partial<
  Pick<TextFormatting, WritableField>
>;

export function pickWritable(input: unknown): TextFormattingInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as TextFormattingInput;
}

export class TextFormattingError extends Error {}

export function listTextFormatting(clientId: number): TextFormatting[] {
  return db
    .select()
    .from(textFormatting)
    .where(eq(textFormatting.clientId, clientId))
    .orderBy(textFormatting.id)
    .all();
}

export function getTextFormatting(
  clientId: number,
  id: number,
): TextFormatting | null {
  return (
    db
      .select()
      .from(textFormatting)
      .where(
        and(
          eq(textFormatting.clientId, clientId),
          eq(textFormatting.id, id),
        ),
      )
      .get() ?? null
  );
}

export function createTextFormatting(
  clientId: number,
  input: TextFormattingInput,
): TextFormatting {
  if (!input.textOriginal) {
    throw new TextFormattingError("textOriginal is required");
  }
  if (!input.textFormatted) {
    throw new TextFormattingError("textFormatted is required");
  }
  return db
    .insert(textFormatting)
    .values({
      clientId,
      textOriginal: input.textOriginal,
      textFormatted: input.textFormatted,
      formattingScope: input.formattingScope ?? null,
      formattingMcScope: input.formattingMcScope ?? null,
    })
    .returning()
    .get();
}

export function updateTextFormatting(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: TextFormattingInput,
):
  | { ok: true; row: TextFormatting }
  | { ok: false; current: TextFormatting | null } {
  const current = getTextFormatting(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(textFormatting)
    .set({
      ...input,
      version: sql`${textFormatting.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(eq(textFormatting.clientId, clientId), eq(textFormatting.id, id)),
    )
    .returning()
    .get();
  return { ok: true, row: updated };
}

export function deleteTextFormatting(
  clientId: number,
  id: number,
  expectedVersion: number,
):
  | { ok: true; row: TextFormatting }
  | { ok: false; current: TextFormatting | null } {
  const current = getTextFormatting(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  db.delete(textFormatting)
    .where(
      and(eq(textFormatting.clientId, clientId), eq(textFormatting.id, id)),
    )
    .run();
  return { ok: true, row: current };
}

// Spec §3.6 — scope parsing helpers, used at render time.
//   formattingScope: "" → universal; otherwise CSV/whitespace separated sizes
//   formattingMcScope: "" → universal; otherwise CSV/whitespace separated MC labels
function parseScope(raw: string | null | undefined): string[] | null {
  if (raw == null) return null; // null/undefined → universal
  const trimmed = raw.trim();
  if (trimmed === "") return null; // empty → universal
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function matchesScope(
  rule: TextFormatting,
  size: string,
  mcLabel: string,
): boolean {
  const sizeScope = parseScope(rule.formattingScope);
  if (sizeScope !== null && !sizeScope.includes(size.toLowerCase())) {
    return false;
  }
  const mcScope = parseScope(rule.formattingMcScope);
  if (mcScope !== null && !mcScope.includes(mcLabel.toLowerCase())) {
    return false;
  }
  return true;
}
