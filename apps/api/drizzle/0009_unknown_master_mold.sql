ALTER TABLE "entries" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "photo_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "photo_uploaded_at" timestamp with time zone;