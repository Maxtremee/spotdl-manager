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
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade
);
