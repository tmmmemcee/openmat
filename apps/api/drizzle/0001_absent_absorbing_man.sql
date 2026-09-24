ALTER TABLE "events" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "state" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "start_time" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "director_email" text;--> statement-breakpoint
CREATE INDEX "events_listing_idx" ON "events" USING btree ("listed","start_date");