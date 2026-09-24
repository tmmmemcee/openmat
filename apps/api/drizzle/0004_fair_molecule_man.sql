CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"entry_id" uuid,
	"team" text,
	"channel" text NOT NULL,
	"subscription" jsonb,
	"email" text,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"follow_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_follow_id_follows_id_fk" FOREIGN KEY ("follow_id") REFERENCES "public"."follows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_event_idx" ON "follows" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_key_idx" ON "notification_log" USING btree ("follow_id","key");