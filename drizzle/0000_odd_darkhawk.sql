CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_game_id` text,
	`title` text NOT NULL,
	`cover_url` text,
	`minerva_path` text,
	`target_platform_id` integer NOT NULL,
	`target_platform_slug` text NOT NULL,
	`release_name` text,
	`magnet_or_hash` text,
	`torbox_id` integer,
	`torbox_file_id` integer,
	`state` text DEFAULT 'requested' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`bytes_total` integer,
	`bytes_downloaded` integer,
	`uploaded_filename` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`romm_url` text,
	`romm_token` text,
	`torbox_api_key` text,
	`igdb_client_id` text,
	`igdb_client_secret` text,
	`download_tmp_dir` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
