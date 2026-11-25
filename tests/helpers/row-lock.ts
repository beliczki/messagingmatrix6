// Deterministic interleaving for write-race tests.
//
// `holdRowLock` takes a row lock on one row (a `messages` row unless another
// table is named) in its own transaction and keeps it until `release(mutate)`
// runs; `mutate` executes inside that transaction, so the competing writer
// sees its effect only after the commit.
// `waitForLockWaiter` returns once another backend is blocked on a lock - the
// signal that the writer under test has reached the row. Together they replace
// "sleep and hope" with a fixed order: lock → writer blocks → mutate+commit →
// writer resumes.
import { sql } from "drizzle-orm";
import { db, getClient } from "@/db";

export type HeldLock = {
  release: (mutate?: () => Promise<void>) => Promise<void>;
};

export type LockedTable =
  | "messages"
  | "topics"
  | "audiences"
  | "assets"
  | "creatives"
  | "text_formatting";

export async function holdRowLock(
  id: number,
  table: LockedTable = "messages",
): Promise<HeldLock> {
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  let go!: (mutate?: () => Promise<void>) => void;
  const released = new Promise<(() => Promise<void>) | undefined>(
    (r) => (go = r),
  );
  const done = db.transaction(async () => {
    await db.execute(
      sql`select id from ${sql.identifier(table)} where id = ${id} for update`,
    );
    locked();
    const mutate = await released;
    if (mutate) await mutate();
  });
  await isLocked;
  return {
    release: async (mutate) => {
      go(mutate);
      await done;
    },
  };
}

export async function waitForLockWaiter(): Promise<void> {
  const client = getClient();
  for (let i = 0; i < 500; i += 1) {
    const [row] = await client<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if (row && row.n > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no backend ever waited on the held row lock");
}
