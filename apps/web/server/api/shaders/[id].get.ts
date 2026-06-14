
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();

  // Try to get authenticated user (optional for public shaders)
  let userId: string | null = null;
  try {
    const session = await getUserSession(event);
    userId = session.secure?.userId ?? null;
  } catch {
    // Not authenticated — only public shaders accessible
  }

  const [shader] = await db
    .select()
    .from(shaders)
    .where(
      userId
        ? and(eq(shaders.id, id), or(eq(shaders.userId, userId), eq(shaders.isPublic, true)))
        : and(eq(shaders.id, id), eq(shaders.isPublic, true)),
    )
    .limit(1);

  if (!shader) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  return shader;
});
