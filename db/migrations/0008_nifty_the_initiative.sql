-- Backfill first: SET NOT NULL fails outright if a single NULL survives, and
-- the producer that made them (scripts/rebuild-creatives.ts, which omitted the
-- column) may run again between this file being written and the deploy. ACTIVE
-- matches what that path uploads: already-delivered creatives.
UPDATE "messages" SET "status" = 'ACTIVE' WHERE "status" IS NULL OR "status" = '';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "status" SET NOT NULL;
