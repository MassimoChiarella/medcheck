CREATE TABLE `dpd_staging` (
	`gen` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`hash` text NOT NULL,
	`versionData` text NOT NULL,
	PRIMARY KEY(`gen`, `id`)
);
