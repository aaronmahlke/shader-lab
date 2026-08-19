import { desc, asc, eq } from "drizzle-orm";
import { compositions, projects } from "../../database/schema";

/** Legacy list: one entry per project (its first composition carries the data). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const db = useDrizzle();

  const rows = await db
    .select({ project: projects, comp: compositions })
    .from(projects)
    .innerJoin(compositions, eq(compositions.projectId, projects.id))
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt), asc(compositions.sortIndex), asc(compositions.createdAt));

  const seen = new Set<string>();
  const result = [];
  for (const pair of rows) {
    if (seen.has(pair.project.id)) continue;
    seen.add(pair.project.id);
    result.push(withAppThumbnailUrl(toShaderShape(pair)));
  }
  return result;
});
