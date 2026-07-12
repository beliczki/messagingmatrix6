import { makeCollectionRoute } from "@/lib/entity-route";
import {
  createMessage,
  listMessages,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";

// mc_number on POST: claim a specific MC number, or "new" to force a fresh
// number in an occupied cell. Read from the raw body — it's an allocation
// directive, not a writable message field.
function readMcNumber(body: unknown): number | "new" | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const v = (body as { mc_number?: unknown }).mc_number;
  if (v === "new") return "new";
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  return undefined;
}

// variant on POST: pin an exact variant letter. Same allocation-directive
// status as mc_number — read from the raw body, not a writable message field.
function readVariant(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const v = (body as { variant?: unknown }).variant;
  return typeof v === "string" ? v : undefined;
}

export const { GET, POST } = makeCollectionRoute({
  listKey: "messages",
  itemKey: "message",
  entityType: "messages",
  list: listMessages,
  create: (cid, input, body) =>
    createMessage(cid, input, {
      requestedNumber: readMcNumber(body),
      requestedVariant: readVariant(body),
    }),
  pickWritable,
  validationError: (e) => (e instanceof MessageError ? e.message : null),
});
