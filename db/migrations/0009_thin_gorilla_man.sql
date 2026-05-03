CREATE TABLE `share_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`share_gallery_id` text NOT NULL,
	`item_key` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`share_gallery_id`) REFERENCES `share_galleries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_comments_share_idx` ON `share_comments` (`share_gallery_id`);--> statement-breakpoint
CREATE INDEX `share_comments_share_item_idx` ON `share_comments` (`share_gallery_id`,`item_key`);