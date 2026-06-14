
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const db = useDrizzle();

  const result = await db
    .select()
    .from(shaders)
    .where(eq(shaders.userId, userId))
    .orderBy(desc(shaders.updatedAt));

  return result;
});
