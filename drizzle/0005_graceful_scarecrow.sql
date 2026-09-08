ALTER TABLE `imports` ADD `touched` text;--> statement-breakpoint
ALTER TABLE `imports` ADD `estimatedBytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `reservedBytes` integer DEFAULT 0 NOT NULL;