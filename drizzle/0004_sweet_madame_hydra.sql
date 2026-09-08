CREATE TABLE `label_refresh` (
	`setId` text PRIMARY KEY NOT NULL,
	`cycle` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`nextAttempt` integer DEFAULT 0 NOT NULL,
	`changed` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `label_refresh_pending` ON `label_refresh` (`cycle`,`state`,`nextAttempt`);