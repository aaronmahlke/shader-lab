import { pgTable, text, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  googleId: text("google_id").unique(),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

/**
 * A project owns compositions (AE model). Migrated legacy shader documents
 * become a project with a single composition; both keep the old shader id so
 * existing /shader/<id> URLs and thumbnails resolve either way.
 */
export const projects = pgTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Untitled"),
  isPublic: boolean("is_public").notNull().default(false),
  ...timestamps,
});

/** One composition: a layer stack + tracks + LFOs (CompositionConfig jsonb). */
export const compositions = pgTable("compositions", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Comp 1"),
  sortIndex: integer("sort_index").notNull().default(0),
  data: jsonb("data").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  thumbnailUpdatedAt: timestamp("thumbnail_updated_at", { withTimezone: true }),
  ...timestamps,
});

