CREATE TABLE `feed_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`product` text NOT NULL,
	`feed_version` integer NOT NULL,
	`exported_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`exported_by` text,
	`uploaded_to_adform_at` text,
	`uploaded_by` text,
	`default_message_id` integer,
	`default_label` text,
	`row_count` integer NOT NULL,
	`payload_json` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_exports_client_product_idx` ON `feed_exports` (`client_id`,`product`);--> statement-breakpoint
CREATE INDEX `feed_exports_client_uploaded_idx` ON `feed_exports` (`client_id`,`uploaded_to_adform_at`);--> statement-breakpoint
CREATE INDEX `feed_exports_client_product_version_idx` ON `feed_exports` (`client_id`,`product`,`feed_version`);