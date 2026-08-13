-- Baseline. Two audiences:
--  * legacy databases (v1): tables already exist under old names — rename,
--    guarded so re-running or fresh databases don't explode.
--  * fresh databases: create the full current schema.
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"google_id" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
-- Legacy table rename (preserves existing shader rows); no-op on fresh DBs.
DO $$ BEGIN
	IF to_regclass('public.compositions') IS NOT NULL AND to_regclass('public.shaders') IS NULL THEN
		ALTER TABLE "compositions" RENAME TO "shaders";
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shaders" (
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
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'shaders_user_id_users_id_fkey'
	) THEN
		ALTER TABLE "shaders" ADD CONSTRAINT "shaders_user_id_users_id_fkey"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
-- Historical artworks table (dropped again by the next migration); kept so
-- legacy databases replaying history stay consistent.
CREATE TABLE IF NOT EXISTS "artworks" (
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
