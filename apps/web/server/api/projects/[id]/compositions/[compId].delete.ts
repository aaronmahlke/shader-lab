import { count, eq } from "drizzle-orm";
import { compositions } from "../../../../database/schema";

export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const projectId = getRouterParam(event, "id");
  const compId = getRouterParam(event, "compId");
  if (!projectId || !compId) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();
  const found = await findOwnedComposition(db, userId, compId);
  if (!found || found.project.id !== projectId) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(compositions)
    .where(eq(compositions.projectId, found.project.id));
  if (Number(total) <= 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "A project needs at least one composition",
    });
  }

  await db.delete(compositions).where(eq(compositions.id, found.comp.id));
  return { ok: true };
});
