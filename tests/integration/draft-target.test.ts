import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages } from "@/db/schema";
import {
  createDraft,
  createDraftVariant,
  pickWritable,
  updateMessage,
} from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../helpers/test-db";

// The constraint name, not the message: drizzle wraps a rejected write as
// "Failed query: …" and only the driver's cause carries which check fired.
// Same helper shape as briefs-draft-invariant.test.ts.
async function violatedConstraint(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = (e as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name ?? `no constraint name on: ${String(e)}`;
  }
  throw new Error("expected the write to be rejected, but it succeeded");
}

let h: TestDb;
let erste: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

// draft_target says which world a draft is being made for, and that decides
// which preview its card shows. It is a stored decision rather than something
// inferred from "are there creatives yet", because it is read before any file
// exists.
describe("draft_target", () => {
  it("is null on a fresh draft — nobody has decided yet", async () => {
    const d = await createDraft(erste.id);
    expect(d.draftTarget).toBeNull();
  });

  it("is writable through the ordinary edit path", async () => {
    const d = await createDraft(erste.id);
    const res = await updateMessage(erste.id, d.id, d.version, {
      draftTarget: "agentic",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.draftTarget).toBe("agentic");
  });

  it("is in the writable set, so a PATCH carries it", () => {
    expect(pickWritable({ draftTarget: "both" })).toEqual({
      draftTarget: "both",
    });
  });

  it("refuses a value outside the three targets at the database", async () => {
    const d = await createDraft(erste.id);
    expect(
      await violatedConstraint(
        db
          .update(messages)
          .set({ draftTarget: "agenic" })
          .where(eq(messages.id, d.id)),
      ),
    ).toBe("messages_draft_target_values");
  });

  it("travels to a variant, in both modes — the sibling is for the same world", async () => {
    const a = await createDraft(erste.id);
    await updateMessage(erste.id, a.id, a.version, { draftTarget: "agentic" });

    const dup = await createDraftVariant(erste.id, a.id, "duplicate");
    const empty = await createDraftVariant(erste.id, a.id, "empty");
    expect(dup.draftTarget).toBe("agentic");
    expect(empty.draftTarget).toBe("agentic");
  });
});
