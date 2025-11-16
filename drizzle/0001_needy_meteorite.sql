ALTER TABLE `messages` ADD `llm_sender_name` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_confidence` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_mail_type` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_summary` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_is_important` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_importance_reason` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `llm_raw_json` text;