CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`brand` text,
	`product` text,
	`type` text,
	`visual_keyword` text,
	`file_id` text,
	`file_name` text,
	`file_format` text,
	`file_size` text,
	`file_dimensions` text,
	`comment` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_client_brand_idx` ON `assets` (`client_id`,`brand`);--> statement-breakpoint
CREATE INDEX `assets_client_product_idx` ON `assets` (`client_id`,`product`);--> statement-breakpoint
CREATE INDEX `assets_client_type_idx` ON `assets` (`client_id`,`type`);--> statement-breakpoint
CREATE INDEX `assets_client_file_idx` ON `assets` (`client_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `audiences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL,
	`status` text,
	`product` text,
	`strategy` text,
	`buying_platform` text,
	`data_source` text,
	`targeting_type` text,
	`device` text,
	`tag` text,
	`comment` text,
	`campaign_name` text,
	`campaign_id` text,
	`lineitem_name` text,
	`lineitem_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audiences_client_key_unique` ON `audiences` (`client_id`,`key`);--> statement-breakpoint
CREATE INDEX `audiences_client_product_idx` ON `audiences` (`client_id`,`product`);--> statement-breakpoint
CREATE INDEX `audiences_client_order_idx` ON `audiences` (`client_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `creatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`brand` text,
	`product` text,
	`type` text,
	`visual_keyword` text,
	`copy_keyword` text,
	`template` text,
	`banner_version` text,
	`mc_number` integer,
	`mc_variant` text,
	`file_id` text,
	`file_name` text,
	`file_format` text,
	`file_size` text,
	`file_dimensions` text,
	`comment` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `creatives_client_brand_idx` ON `creatives` (`client_id`,`brand`);--> statement-breakpoint
CREATE INDEX `creatives_client_product_idx` ON `creatives` (`client_id`,`product`);--> statement-breakpoint
CREATE INDEX `creatives_client_file_idx` ON `creatives` (`client_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `creatives_client_mc_idx` ON `creatives` (`client_id`,`mc_number`,`mc_variant`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`number` integer NOT NULL,
	`variant` text NOT NULL,
	`audience` text NOT NULL,
	`topic` text NOT NULL,
	`version_no` integer DEFAULT 1 NOT NULL,
	`pmmid` text,
	`status` text,
	`start_date` text,
	`end_date` text,
	`template` text,
	`template_variant_classes` text,
	`name` text,
	`headline` text,
	`copy1` text,
	`copy2` text,
	`image1` text,
	`image2` text,
	`image3` text,
	`image4` text,
	`image5` text,
	`image6` text,
	`video1` text,
	`flash` text,
	`flash_style` text,
	`cta` text,
	`landing_url` text,
	`comment` text,
	`utm_campaign` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_content` text,
	`utm_term` text,
	`utm_cd26` text,
	`final_trafficked_url` text,
	`brief` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_client_topic_audience_idx` ON `messages` (`client_id`,`topic`,`audience`);--> statement-breakpoint
CREATE INDEX `messages_client_status_idx` ON `messages` (`client_id`,`status`);--> statement-breakpoint
CREATE INDEX `messages_client_number_idx` ON `messages` (`client_id`,`number`);--> statement-breakpoint
CREATE INDEX `messages_client_pmmid_idx` ON `messages` (`client_id`,`pmmid`);--> statement-breakpoint
CREATE TABLE `reporting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`level` text NOT NULL,
	`mc_label` text,
	`size` text,
	`banner_id` text,
	`banner_name` text,
	`adform_status` text,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`ctr` real,
	`campaign_id` text,
	`campaign_name` text,
	`synced_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reporting_client_mc_idx` ON `reporting` (`client_id`,`mc_label`);--> statement-breakpoint
CREATE INDEX `reporting_client_mc_size_idx` ON `reporting` (`client_id`,`mc_label`,`size`);--> statement-breakpoint
CREATE INDEX `reporting_client_level_idx` ON `reporting` (`client_id`,`level`);--> statement-breakpoint
CREATE TABLE `share_galleries` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` integer NOT NULL,
	`title` text,
	`description` text,
	`created_by` text,
	`metadata` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_galleries_client_idx` ON `share_galleries` (`client_id`);--> statement-breakpoint
CREATE TABLE `text_formatting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`text_original` text NOT NULL,
	`text_formatted` text NOT NULL,
	`formatting_scope` text,
	`formatting_mc_scope` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `text_formatting_client_idx` ON `text_formatting` (`client_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL,
	`status` text,
	`product` text,
	`strategy` text,
	`buying_platform` text,
	`data_source` text,
	`targeting_type` text,
	`device` text,
	`tag` text,
	`tag1` text,
	`tag2` text,
	`tag3` text,
	`tag4` text,
	`comment` text,
	`campaign_name` text,
	`campaign_id` text,
	`lineitem_name` text,
	`lineitem_id` text,
	`created` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_client_key_unique` ON `topics` (`client_id`,`key`);--> statement-breakpoint
CREATE INDEX `topics_client_product_idx` ON `topics` (`client_id`,`product`);--> statement-breakpoint
CREATE INDEX `topics_client_order_idx` ON `topics` (`client_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `uploaded_files` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` integer NOT NULL,
	`filename` text NOT NULL,
	`original_filename` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`dimensions` text,
	`sha256` text,
	`uploaded_by` text,
	`category` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_files_client_sha_unique` ON `uploaded_files` (`client_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `uploaded_files_client_category_idx` ON `uploaded_files` (`client_id`,`category`);--> statement-breakpoint
CREATE INDEX `uploaded_files_client_cat_created_idx` ON `uploaded_files` (`client_id`,`category`,`created_at`);