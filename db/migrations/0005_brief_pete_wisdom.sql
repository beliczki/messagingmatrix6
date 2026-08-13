ALTER TABLE "audiences" ADD COLUMN "channel" text;--> statement-breakpoint
CREATE INDEX "audiences_client_channel_idx" ON "audiences" USING btree ("client_id","channel");