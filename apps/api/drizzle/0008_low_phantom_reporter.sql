ALTER TABLE "events" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "live_version" integer DEFAULT 0 NOT NULL;