
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const body = await readBody(event);

  if (!body?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing shader data" });
  }

  const db = useDrizzle();

  const [created] = await db
    .insert(shaders)
    .values({
      userId,
      name: body.name ?? "Untitled",
      data: body.data,
      isPublic: body.isPublic ?? false,
    })
    .returning();

  return created;
});
