import { compositions, projects } from "../../database/schema";

/** Create a project with its first composition. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const body = (await readBody(event).catch(() => null)) ?? {};
  const db = useDrizzle();

  const [project] = await db
    .insert(projects)
    .values({ userId, name: body.name ?? "Untitled", isPublic: body.isPublic ?? false })
    .returning();

  const [comp] = await db
    .insert(compositions)
    .values({
      projectId: project!.id,
      name: body.compositionName ?? "Comp 1",
      sortIndex: 0,
      data: body.data ?? emptyCompositionData(),
    })
    .returning();

  return { ...project!, compositions: [comp!] };
});
