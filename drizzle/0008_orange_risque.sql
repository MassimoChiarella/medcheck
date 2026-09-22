CREATE TABLE `archive_writes` (
	`key` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`bytes` integer NOT NULL,
	`state` text NOT NULL,
	`writeId` text NOT NULL,
	`inFlight` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`seenScan` text
);
--> statement-breakpoint
CREATE INDEX `archive_scan` ON `archive_writes` (`seenScan`);--> statement-breakpoint
CREATE TABLE `storage_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL
);
