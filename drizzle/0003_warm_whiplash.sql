CREATE TABLE `update_runs` (
	`source` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`started` text NOT NULL,
	`heartbeat` text NOT NULL,
	`finished` text,
	`lastSuccess` text,
	`outcome` text NOT NULL,
	`phase` text NOT NULL,
	`error` text,
	`cursor` text DEFAULT '' NOT NULL,
	`details` text DEFAULT '{}' NOT NULL
);
