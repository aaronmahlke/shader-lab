
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const db = useDrizzle();

  const result = await db
    .select()
    .from(shaders)
    .where(eq(shaders.userId, userId))
    .orderBy(desc(shaders.updatedAt));

  // Old rows store the internal S3 URL; serve the app-proxied one instead.
  return result.map(withAppThumbnailUrl);
});
