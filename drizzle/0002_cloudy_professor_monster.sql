CREATE TABLE `dead_torrents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`reason` text NOT NULL,
	`detected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
