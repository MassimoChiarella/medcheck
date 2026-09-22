CREATE TABLE `capacity_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "capacity_guard_valid" CHECK("capacity_guards"."valid"=1)
);
--> statement-breakpoint
CREATE TABLE `database_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`generation` text,
	`created` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cache` ADD `bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cache` ADD `expires` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `cache_expiry` ON `cache` (`expires`,`fetched`);