CREATE TABLE "bout_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"bout_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"bracket_id" uuid NOT NULL,
	"key" text NOT NULL,
	"round" integer NOT NULL,
	"entry_a" uuid,
	"entry_b" uuid,
	"mat" integer,
	"mat_order" integer,
	"bout_number" text,
	"planned_start_min" integer,
	"duration_min" real NOT NULL,
	"after" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"winner_entry_id" uuid,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"group_id" uuid,
	"weight_class" text,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"size" integer,
	"draw" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bout_events" ADD CONSTRAINT "bout_events_bout_id_bouts_id_fk" FOREIGN KEY ("bout_id") REFERENCES "public"."bouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bouts" ADD CONSTRAINT "bouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bouts" ADD CONSTRAINT "bouts_bracket_id_brackets_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."brackets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bouts" ADD CONSTRAINT "bouts_entry_a_entries_id_fk" FOREIGN KEY ("entry_a") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bouts" ADD CONSTRAINT "bouts_entry_b_entries_id_fk" FOREIGN KEY ("entry_b") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bouts" ADD CONSTRAINT "bouts_winner_entry_id_entries_id_fk" FOREIGN KEY ("winner_entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bout_events_bout_idx" ON "bout_events" USING btree ("bout_id","seq");--> statement-breakpoint
CREATE INDEX "bouts_event_idx" ON "bouts" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bouts_bracket_key_idx" ON "bouts" USING btree ("bracket_id","key");--> statement-breakpoint
CREATE INDEX "bouts_mat_idx" ON "bouts" USING btree ("event_id","mat","mat_order");--> statement-breakpoint
CREATE INDEX "brackets_event_idx" ON "brackets" USING btree ("event_id");