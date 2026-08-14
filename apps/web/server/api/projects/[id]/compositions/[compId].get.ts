import { eq } from "drizzle-orm";
import { compositions } from "../../../../database/schema";

/** Full composition (including data); owner or public project. */
export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id");
  const compId = getRouterParam(event, "compId");
  if (!projectId || !compId) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  let userId: string | null = null;
  try {
    const session = await getUserSession(event);
    userId = session.secure?.userId ?? null;
  } catch {
    // anonymous
  }

  const db = useDrizzle();
  const found = await findCompositionByAnyId(db, compId);
  const accessible =
    found &&
    found.project.id === projectId &&
    (found.project.isPublic || found.project.userId === userId);
  if (!found || !accessible) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  return withAppThumbnailUrl(found.comp);
});
