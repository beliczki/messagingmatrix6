DROP INDEX `uploaded_files_client_sha_unique`;--> statement-breakpoint
CREATE INDEX `uploaded_files_client_sha_idx` ON `uploaded_files` (`client_id`,`sha256`);