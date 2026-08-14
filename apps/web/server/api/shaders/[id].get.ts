export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();

  // Try to get authenticated user (optional for public compositions)
  let userId: string | null = null;
  try {
    const session = await getUserSession(event);
    userId = session.secure?.userId ?? null;
  } catch {
    // Not authenticated — only public compositions accessible
  }

  const found = await findCompositionByAnyId(db, id);
  const accessible =
    found && (found.project.isPublic || (userId && found.project.userId === userId));
  if (!found || !accessible) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  return withAppThumbnailUrl(toShaderShape(found));
});
