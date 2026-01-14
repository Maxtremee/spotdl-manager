CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_version` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processing_at` integer,
	`processed_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `outbox_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_version` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`processing_at` integer,
	`processed_at` integer,
	`status` text NOT NULL,
	`retry_count` integer NOT NULL,
	`last_error` text,
	`archived_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `playlists` ADD `version` integer DEFAULT 0 NOT NULL;