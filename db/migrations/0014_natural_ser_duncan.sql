ALTER TABLE `feed_exports` ADD `source` text DEFAULT 'export' NOT NULL;--> statement-breakpoint
INSERT INTO `feed_exports` (
  `client_id`,
  `product`,
  `feed_version`,
  `exported_at`,
  `exported_by`,
  `uploaded_to_adform_at`,
  `uploaded_by`,
  `default_message_id`,
  `default_label`,
  `row_count`,
  `payload_json`,
  `notes`,
  `source`
)
SELECT
  `client_id`,
  `product`,
  0,
  `uploaded_at`,
  `uploaded_by`,
  `uploaded_at`,
  `uploaded_by`,
  NULL,
  NULL,
  `row_count`,
  `payload_json`,
  'Uploaded from AdForm: ' || `filename`,
  'adform_snapshot'
FROM `adform_snapshots`;--> statement-breakpoint
DROP TABLE `adform_snapshots`;--> statement-breakpoint
CREATE INDEX `feed_exports_client_source_idx` ON `feed_exports` (`client_id`,`source`);
