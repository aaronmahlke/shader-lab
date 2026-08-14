import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../database/schema";

export { eq, and, or, asc, desc, sql } from "drizzle-orm";
export { users, projects, compositions } from "../database/schema";

let client: ReturnType<typeof drizzle> | null = null;

export function useDrizzle() {
  if (!client) {
    const dsn = process.env.NUXT_DSN ?? "postgresql://postgres:postgres@localhost:5432/shader_lab";
    const conn = postgres(dsn, { prepare: false });
    client = drizzle({ client: conn, schema });
  }
  return client;
}
