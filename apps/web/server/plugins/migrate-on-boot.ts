import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Applies pending SQL migrations on server boot.
 *
 * The runtime container ships only the nitro output (no bun, no drizzle-kit),
 * so a "release command" cannot run migrations — the server does it itself:
 *
 * - migrations live in folder-per-migration layout (<name>/migration.sql,
 *   statements separated by `--> statement-breakpoint`)
 * - a pg advisory lock serializes concurrent instances
 * - applied migrations are recorded in public.__app_migrations; databases
 *   migrated by drizzle-kit before this journal existed simply re-run the
 *   (idempotent) baseline once and are journaled from then on
 *
 * Opt out with NUXT_MIGRATE_ON_BOOT=false (e.g. when a platform runs
 * migrations out of band).
 */
export default defineNitroPlugin(async () => {
  if (process.env.NUXT_MIGRATE_ON_BOOT === "false") return;
  if (import.meta.dev && process.env.NUXT_MIGRATE_ON_BOOT !== "true") return;

  const dir =
    process.env.NUXT_MIGRATIONS_DIR ??
    join(process.cwd(), "server", "database", "migrations");
  if (!existsSync(dir)) {
    console.warn(`[migrate] migrations dir not found (${dir}), skipping`);
    return;
  }

  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "migration.sql")))
    .map((e) => e.name)
    .sort();
  if (folders.length === 0) return;

  const dsn =
    process.env.NUXT_DSN ?? "postgresql://postgres:postgres@localhost:5432/shader_lab";
  const sql = postgres(dsn, { max: 1, prepare: false, onnotice: () => {} });
  const LOCK_KEY = 727_274; // arbitrary app-wide migration lock

  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS public.__app_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
    const applied = new Set(
      (await sql`select name from public.__app_migrations`).map((r) => r.name as string),
    );

    for (const name of folders) {
      if (applied.has(name)) continue;
      const file = readFileSync(join(dir, name, "migration.sql"), "utf8");
      const statements = file
        .split(/^\s*-->\s*statement-breakpoint\s*$/m)
        .map((s) => s.trim())
        .filter(Boolean);

      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx`insert into public.__app_migrations (name) values (${name})`;
      });
      console.log(`[migrate] applied ${name} (${statements.length} statements)`);
    }
  } catch (err) {
    // A broken schema is worse than a dead deploy: fail loudly.
    console.error("[migrate] migration failed, refusing to start:", err);
    throw err;
  } finally {
    try {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    } catch {
      // connection may already be gone
    }
    await sql.end({ timeout: 5 });
  }
});
