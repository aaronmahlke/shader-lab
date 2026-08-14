import { desc, asc, eq } from "drizzle-orm";
import { compositions, projects } from "../../database/schema";

/** All projects of the user, with composition metadata (no data payloads). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const db = useDrizzle();

  const rows = await db
    .select({
      project: projects,
      compId: compositions.id,
      compName: compositions.name,
      compSortIndex: compositions.sortIndex,
      compThumbnailUrl: compositions.thumbnailUrl,
      compThumbnailUpdatedAt: compositions.thumbnailUpdatedAt,
      compUpdatedAt: compositions.updatedAt,
    })
    .from(projects)
    .innerJoin(compositions, eq(compositions.projectId, projects.id))
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt), asc(compositions.sortIndex), asc(compositions.createdAt));

  const byProject = new Map<string, any>();
  for (const row of rows) {
    let entry = byProject.get(row.project.id);
    if (!entry) {
      entry = { ...row.project, compositions: [] };
      byProject.set(row.project.id, entry);
    }
    entry.compositions.push(
      withAppThumbnailUrl({
        id: row.compId,
        name: row.compName,
        sortIndex: row.compSortIndex,
        thumbnailUrl: row.compThumbnailUrl,
        thumbnailUpdatedAt: row.compThumbnailUpdatedAt,
        updatedAt: row.compUpdatedAt,
      }),
    );
  }
  return [...byProject.values()];
});
