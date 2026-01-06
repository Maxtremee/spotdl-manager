CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`output_dir` text NOT NULL,
	`flags_overwrite` integer DEFAULT false NOT NULL,
	`flags_retries` integer DEFAULT 3 NOT NULL,
	`flags_quality` text DEFAULT 'high' NOT NULL,
	`flags_format` text DEFAULT 'mp3' NOT NULL,
	`schedule_enabled` integer DEFAULT false NOT NULL,
	`schedule_type` text DEFAULT 'interval' NOT NULL,
	`schedule_cron` text,
	`schedule_minutes` integer DEFAULT 1440,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
