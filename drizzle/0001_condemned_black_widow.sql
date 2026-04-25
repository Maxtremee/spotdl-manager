ALTER TABLE `invocations` ADD `kind` text DEFAULT 'scrape' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `album` text;