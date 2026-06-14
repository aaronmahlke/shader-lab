import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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

/** Reusable shader stack (layers + LFOs). */
export const shaders = pgTable("shaders", {
  id: text("id").primaryKey().$defaultFn(() => uuidv7()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Untitled"),
  data: jsonb("data").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  thumbnailUrl: text("thumbnail_url"),
  thumbnailUpdatedAt: timestamp("thumbnail_updated_at", { withTimezone: true }),
  ...timestamps,
});

