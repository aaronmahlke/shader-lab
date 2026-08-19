import { eq } from "drizzle-orm";
import { projects } from "../../database/schema";

export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(event);
  const db = useDrizzle();

  const project = await findOwnedProject(db, userId, id);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.isPublic !== undefined) updates.isPublic = body.isPublic;

  const [updated] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, project.id))
    .returning();
  return updated;
});
