import { compositions, projects } from "../../database/schema";

/** Legacy create: a new project with a single composition. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const body = await readBody(event);

  if (!body?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing shader data" });
  }

  const db = useDrizzle();

  const [project] = await db
    .insert(projects)
    .values({
      userId,
      name: body.name ?? "Untitled",
      isPublic: body.isPublic ?? false,
    })
    .returning();

  const [comp] = await db
    .insert(compositions)
    .values({
      projectId: project!.id,
      name: "Comp 1",
      sortIndex: 0,
      data: body.data,
    })
    .returning();

  return toShaderShape({ project: project!, comp: comp! });
});
