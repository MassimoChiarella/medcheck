CREATE TABLE `mutation_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "mutation_guard_valid" CHECK("mutation_guards"."valid"=1)
);
--> statement-breakpoint
ALTER TABLE `imports` ADD `ownerRunId` text;--> statement-breakpoint
ALTER TABLE `imports` ADD `ownerEpoch` integer;--> statement-breakpoint
ALTER TABLE `update_runs` ADD `leaseEpoch` integer DEFAULT 0 NOT NULL;