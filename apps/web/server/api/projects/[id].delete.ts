import { eq } from "drizzle-orm";
import { projects } from "../../database/schema";

export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();
  const project = await findOwnedProject(db, userId, id);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  await db.delete(projects).where(eq(projects.id, project.id));
  return { ok: true };
});
