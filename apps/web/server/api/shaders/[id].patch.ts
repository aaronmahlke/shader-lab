import { eq } from "drizzle-orm";
import { compositions, projects } from "../../database/schema";

/** Legacy update: data goes to the composition, name/isPublic to the project. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(event);
  const db = useDrizzle();

  const found = await findOwnedComposition(db, userId, id);
  if (!found) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  const now = new Date();

  if (body.data !== undefined) {
    await db
      .update(compositions)
      .set({ data: body.data, updatedAt: now })
      .where(eq(compositions.id, found.comp.id));
  }

  const projectUpdates: Record<string, unknown> = { updatedAt: now };
  if (body.name !== undefined) projectUpdates.name = body.name;
  if (body.isPublic !== undefined) projectUpdates.isPublic = body.isPublic;
  await db.update(projects).set(projectUpdates).where(eq(projects.id, found.project.id));

  const updated = await findOwnedComposition(db, userId, found.comp.id);
  return toShaderShape(updated!);
});
