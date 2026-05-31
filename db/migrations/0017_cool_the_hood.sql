CREATE TABLE `monitoring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`platform` text NOT NULL,
	`scope` text,
	`pmmid` text,
	`message_id` integer,
	`audience_key` text NOT NULL,
	`topic_key` text NOT NULL,
	`mc_number` integer NOT NULL,
	`mc_variant` text NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`conversions` integer DEFAULT 0 NOT NULL,
	`ctr` real,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`imported_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`source_filename` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `monitoring_client_message_idx` ON `monitoring` (`client_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `monitoring_client_platform_idx` ON `monitoring` (`client_id`,`platform`);--> statement-breakpoint
CREATE INDEX `monitoring_client_mc_idx` ON `monitoring` (`client_id`,`mc_number`,`mc_variant`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_client_period_key_idx` ON `monitoring` (`client_id`,`platform`,`period_from`,`period_to`,`mc_number`,`mc_variant`,`audience_key`,`topic_key`);