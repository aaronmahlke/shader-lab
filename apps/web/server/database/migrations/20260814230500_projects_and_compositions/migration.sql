-- Projects own compositions (AE model). Every legacy shader row becomes a
-- project with one composition; BOTH reuse the shader's id so existing
-- /shader/<id> URLs, thumbnails, and share links resolve by either id.
-- Idempotent: guarded creates + ON CONFLICT inserts (safe on re-run).
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Untitled' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compositions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text DEFAULT 'Comp 1' NOT NULL,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"thumbnail_url" text,
	"thumbnail_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "compositions" ADD CONSTRAINT "compositions_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compositions_project_id_idx" ON "compositions" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");
--> statement-breakpoint
-- Migrate legacy shader documents (no-op when the table is already gone).
DO $$ BEGIN
	IF to_regclass('public.shaders') IS NOT NULL THEN
		INSERT INTO "projects" ("id", "user_id", "name", "is_public", "created_at", "updated_at")
			SELECT "id", "user_id", "name", "is_public", "created_at", "updated_at" FROM "shaders"
			ON CONFLICT ("id") DO NOTHING;
		INSERT INTO "compositions" ("id", "project_id", "name", "sort_index", "data",
				"thumbnail_url", "thumbnail_updated_at", "created_at", "updated_at")
			SELECT "id", "id", 'Comp 1', 0, "data",
				"thumbnail_url", "thumbnail_updated_at", "created_at", "updated_at" FROM "shaders"
			ON CONFLICT ("id") DO NOTHING;
		DROP TABLE "shaders";
	END IF;
END $$;