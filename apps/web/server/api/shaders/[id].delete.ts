import { eq } from "drizzle-orm";
import { projects } from "../../database/schema";

/** Legacy delete removes the whole project (single-comp world). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();

  const found = await findOwnedComposition(db, userId, id);
  if (!found) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  await db.delete(projects).where(eq(projects.id, found.project.id));
  return { ok: true };
});
