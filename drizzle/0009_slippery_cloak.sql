CREATE TABLE `archive_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`registryId` text NOT NULL,
	`hash` text NOT NULL,
	`bytes` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `archive_attempt_key` ON `archive_attempts` (`key`);