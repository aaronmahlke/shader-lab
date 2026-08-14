import { asc, desc, eq } from "drizzle-orm";
import { compositions } from "../../../../database/schema";

/** Add a composition to a project (optionally duplicating an existing one). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const projectId = getRouterParam(event, "id");
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = (await readBody(event).catch(() => null)) ?? {};
  const db = useDrizzle();

  const project = await findOwnedProject(db, userId, projectId);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  let data = body.data;
  let name = body.name;
  if (body.duplicateOf) {
    const [source] = await db
      .select()
      .from(compositions)
      .where(eq(compositions.id, body.duplicateOf))
      .limit(1);
    if (!source || source.projectId !== project.id) {
      throw createError({ statusCode: 404, statusMessage: "Source composition not found" });
    }
    data = data ?? source.data;
    name = name ?? `${source.name} copy`;
  }

  const [last] = await db
    .select({ sortIndex: compositions.sortIndex })
    .from(compositions)
    .where(eq(compositions.projectId, project.id))
    .orderBy(desc(compositions.sortIndex))
    .limit(1);

  const [comp] = await db
    .insert(compositions)
    .values({
      projectId: project.id,
      name: name ?? "Comp",
      sortIndex: (last?.sortIndex ?? -1) + 1,
      data: data ?? emptyCompositionData(),
    })
    .returning();

  return comp;
});
