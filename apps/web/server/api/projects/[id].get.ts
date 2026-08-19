import { asc, eq } from "drizzle-orm";
import { compositions, projects } from "../../database/schema";

/** Project + composition metadata (no data payloads); owner or public. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  let userId: string | null = null;
  try {
    const session = await getUserSession(event);
    userId = session.secure?.userId ?? null;
  } catch {
    // anonymous
  }

  const db = useDrizzle();
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || !(project.isPublic || project.userId === userId)) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const comps = await db
    .select({
      id: compositions.id,
      name: compositions.name,
      sortIndex: compositions.sortIndex,
      thumbnailUrl: compositions.thumbnailUrl,
      thumbnailUpdatedAt: compositions.thumbnailUpdatedAt,
      createdAt: compositions.createdAt,
      updatedAt: compositions.updatedAt,
    })
    .from(compositions)
    .where(eq(compositions.projectId, project.id))
    .orderBy(asc(compositions.sortIndex), asc(compositions.createdAt));

  return { ...project, compositions: comps.map(withAppThumbnailUrl) };
});
