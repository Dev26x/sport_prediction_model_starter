CREATE TABLE `paper_days` (
	`day` text PRIMARY KEY NOT NULL,
	`captured_at` text NOT NULL,
	`snapshot` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_slips` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`profile` text NOT NULL,
	`frozen` text NOT NULL,
	`stake_cents` integer NOT NULL,
	`status` text NOT NULL,
	`gross_cents` integer DEFAULT 0 NOT NULL,
	`results` text NOT NULL,
	`unresolved_legs` integer DEFAULT 0 NOT NULL,
	`settled_at` text,
	`checked_at` text
);
