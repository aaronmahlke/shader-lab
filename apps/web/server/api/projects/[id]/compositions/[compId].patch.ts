import { eq } from "drizzle-orm";
import { compositions, projects } from "../../../../database/schema";

export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const projectId = getRouterParam(event, "id");
  const compId = getRouterParam(event, "compId");
  if (!projectId || !compId) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(event);
  const db = useDrizzle();

  const found = await findOwnedComposition(db, userId, compId);
  if (!found || found.project.id !== projectId) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.data !== undefined) updates.data = body.data;
  if (body.sortIndex !== undefined) updates.sortIndex = body.sortIndex;

  const [updated] = await db
    .update(compositions)
    .set(updates)
    .where(eq(compositions.id, found.comp.id))
    .returning();

  // Keep the project fresh for dashboard ordering.
  await db
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, found.project.id));

  return updated;
});
