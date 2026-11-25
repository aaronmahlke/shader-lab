// Serves thumbnails through the app so storage never needs to be
// browser-reachable (S3 is internal-only in prod; local files aren't URLs).
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const found = await findOwnedComposition(userId, id);
  if (!found?.comp.thumbnailUpdatedAt) {
    throw createError({ statusCode: 404, statusMessage: "Thumbnail not found" });
  }
  const data = await useStore().getThumbnail(found.comp.id);
  if (!data) throw createError({ statusCode: 404, statusMessage: "Thumbnail not found" });

  setHeader(event, "Content-Type", "image/png");
  // Immutable per version; the URL carries ?v=<thumbnailUpdatedAt> for busting.
  setHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
  return data;
});
