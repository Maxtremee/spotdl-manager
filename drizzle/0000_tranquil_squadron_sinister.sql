CREATE TABLE `global_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`exit_code` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`log_path` text,
	`sync_file_path` text,
	`summary` text,
	FOREIGN KEY (`playlist_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`output_dir` text NOT NULL,
	`cover_art_url` text,
	`schedule_enabled` integer DEFAULT false NOT NULL,
	`schedule_type` text DEFAULT 'interval' NOT NULL,
	`schedule_cron` text,
	`schedule_minutes` integer DEFAULT 1440,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`spotify_track_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`yt_video_id` text,
	`download_path` text,
	`failure_reason` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracks_source_id_idx` ON `tracks` (`source_id`);--> statement-breakpoint
CREATE INDEX `tracks_state_idx` ON `tracks` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_source_spotify_unique` ON `tracks` (`source_id`,`spotify_track_id`);