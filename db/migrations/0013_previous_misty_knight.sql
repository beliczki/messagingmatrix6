CREATE TABLE `adform_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`product` text NOT NULL,
	`uploaded_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`uploaded_by` text,
	`filename` text NOT NULL,
	`row_count` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adform_snapshots_client_product_uq` ON `adform_snapshots` (`client_id`,`product`);