CREATE TABLE `keywords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`form` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keywords_client_form_field_value_unique` ON `keywords` (`client_id`,`form`,`field`,`value`);--> statement-breakpoint
CREATE INDEX `keywords_client_form_field_order_idx` ON `keywords` (`client_id`,`form`,`field`,`order_index`);