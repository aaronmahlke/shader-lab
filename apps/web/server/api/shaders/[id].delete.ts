
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();

  const [deleted] = await db
    .delete(shaders)
    .where(and(eq(shaders.id, id), eq(shaders.userId, userId)))
    .returning({ id: shaders.id });

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  return { ok: true };
});
