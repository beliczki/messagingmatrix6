DROP INDEX `monitoring_client_period_key_idx`;--> statement-breakpoint
ALTER TABLE `monitoring` ADD `size` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_client_period_key_idx` ON `monitoring` (`client_id`,`platform`,`period_from`,`period_to`,`mc_number`,`mc_variant`,`audience_key`,`topic_key`,`size`);