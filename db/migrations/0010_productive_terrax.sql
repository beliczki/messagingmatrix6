DROP INDEX "monitoring_client_period_key_idx";--> statement-breakpoint
ALTER TABLE "monitoring" ADD COLUMN "day" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "monitoring_client_day_idx" ON "monitoring" USING btree ("client_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_client_period_key_idx" ON "monitoring" USING btree ("client_id","platform","period_from","period_to","day","mc_number","mc_variant","audience_key","topic_key","size");