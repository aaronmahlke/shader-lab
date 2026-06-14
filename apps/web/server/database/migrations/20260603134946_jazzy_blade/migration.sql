-- Legacy table rename (preserves existing shader rows)
ALTER TABLE "compositions" RENAME TO "shaders";
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Untitled' NOT NULL,
	"data" jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"thumbnail_url" text,
	"thumbnail_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
