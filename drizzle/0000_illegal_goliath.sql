CREATE TABLE `cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`fetched` integer NOT NULL,
	`source` text NOT NULL,
	`asOf` text
);
--> statement-breakpoint
CREATE TABLE `cv_report_drugs` (
	`gen` text NOT NULL,
	`id` integer NOT NULL,
	`reportId` integer NOT NULL,
	`drugId` integer,
	`name` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`gen`, `id`)
);
--> statement-breakpoint
CREATE INDEX `cv_drug_report` ON `cv_report_drugs` (`gen`,`drugId`,`reportId`);--> statement-breakpoint
CREATE INDEX `cv_report_drug` ON `cv_report_drugs` (`gen`,`reportId`);--> statement-breakpoint
CREATE TABLE `cv_links` (
	`gen` text NOT NULL,
	`id` integer NOT NULL,
	`reportId` integer NOT NULL,
	`target` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`gen`, `id`)
);
--> statement-breakpoint
CREATE INDEX `cv_link_report` ON `cv_links` (`gen`,`reportId`);--> statement-breakpoint
CREATE TABLE `cv_products` (
	`gen` text NOT NULL,
	`id` integer NOT NULL,
	`name` text NOT NULL,
	`ingredients` text NOT NULL,
	PRIMARY KEY(`gen`, `id`)
);
--> statement-breakpoint
CREATE INDEX `cv_product_name` ON `cv_products` (`gen`,`name`);--> statement-breakpoint
CREATE TABLE `cv_reactions` (
	`gen` text NOT NULL,
	`id` integer NOT NULL,
	`reportId` integer NOT NULL,
	`term` text NOT NULL,
	PRIMARY KEY(`gen`, `id`)
);
--> statement-breakpoint
CREATE INDEX `cv_reaction_report` ON `cv_reactions` (`gen`,`reportId`);--> statement-breakpoint
CREATE TABLE `cv_reports` (
	`gen` text NOT NULL,
	`id` integer NOT NULL,
	`reportNo` text NOT NULL,
	`version` integer NOT NULL,
	`received` text,
	`updated` text,
	`serious` integer,
	`outcomes` text NOT NULL,
	PRIMARY KEY(`gen`, `id`)
);
--> statement-breakpoint
CREATE INDEX `cv_report_receipt` ON `cv_reports` (`gen`,`received`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`importId` text NOT NULL,
	`tableName` text NOT NULL,
	`batchId` integer NOT NULL,
	`rows` integer NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`importId`, `tableName`, `batchId`)
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`state` text NOT NULL,
	`cutoff` text NOT NULL,
	`hash` text NOT NULL,
	`manifest` text NOT NULL,
	`created` text NOT NULL,
	`completed` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`observed` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_state` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text,
	`lastSuccess` text,
	`lastChecked` text,
	`error` text,
	`coverage` text
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`productId` text NOT NULL,
	`version` text NOT NULL,
	`data` text NOT NULL,
	`hash` text,
	`observed` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `version_product` ON `versions` (`productId`,`observed`);