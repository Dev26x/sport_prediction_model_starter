CREATE TABLE `cache_entries` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_slips` (
	`user_id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
