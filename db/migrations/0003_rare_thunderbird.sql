CREATE TABLE `config` (
	`client_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`category` text,
	`description` text,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`client_id`, `key`),
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `config_client_category_idx` ON `config` (`client_id`,`category`);