export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const userId = await optionalUserId(event);
  const found = await useStore().findCompositionByAnyId(id);
  const accessible = found && (found.project.isPublic || (userId && found.project.userId === userId));
  if (!found || !accessible) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }
  return withAppThumbnailUrl(toShaderShape(found));
});
