CREATE TABLE "rating_changes" (
	"bout_id" uuid NOT NULL,
	"wrestler_id" uuid NOT NULL,
	"delta" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"coach_email" text,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrestlers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_year" integer,
	"gender" text,
	"weight" real,
	"weight_updated_at" timestamp with time zone,
	"level" text,
	"years_wrestled" integer,
	"rating" real DEFAULT 1000 NOT NULL,
	"rated_matches" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "wrestler_id" uuid;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_bout_id_bouts_id_fk" FOREIGN KEY ("bout_id") REFERENCES "public"."bouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_wrestler_id_wrestlers_id_fk" FOREIGN KEY ("wrestler_id") REFERENCES "public"."wrestlers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrestlers" ADD CONSTRAINT "wrestlers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rating_changes_bout_wrestler_idx" ON "rating_changes" USING btree ("bout_id","wrestler_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_token_idx" ON "teams" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "wrestlers_team_idx" ON "wrestlers" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_wrestler_id_wrestlers_id_fk" FOREIGN KEY ("wrestler_id") REFERENCES "public"."wrestlers"("id") ON DELETE set null ON UPDATE no action;