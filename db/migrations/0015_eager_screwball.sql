ALTER TABLE `creatives` ADD `family_key` text;--> statement-breakpoint
CREATE INDEX `creatives_client_family_idx` ON `creatives` (`client_id`,`family_key`);