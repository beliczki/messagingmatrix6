-- The brief stops being a table and becomes a column: messages.brief_slides_file_id
-- (added in 0016) holds the Google Drive FILE ID of the deck, which is already
-- the brief's identity — slides-link.ts normalises every URL spelling to it.
-- "These six cards came from one deck" is a GROUP BY on that column; the table
-- was a surrogate key for a value that had one, and its only possible payload
-- (a human label) was never written by anything.
--
-- Backfill FIRST, while the join still exists.
UPDATE "messages" SET "brief_slides_file_id" = "briefs"."slides_file_id"
  FROM "briefs"
  WHERE "messages"."brief_id" = "briefs"."id";
--> statement-breakpoint
-- IF EXISTS because the DROP TABLE below would take this constraint with it —
-- the generated order dropped the table first and then failed on a constraint
-- that CASCADE had already removed.
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_brief_id_briefs_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "messages_client_brief_idx";
--> statement-breakpoint
CREATE INDEX "messages_client_brief_idx" ON "messages" USING btree ("client_id","brief_slides_file_id");
--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "brief_id";
--> statement-breakpoint
DROP TABLE "briefs" CASCADE;
