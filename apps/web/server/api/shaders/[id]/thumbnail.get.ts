// Serves thumbnails through the app so the S3 endpoint never needs to be
// browser-reachable (in prod it is internal-only; the raw S3 URL broke cards).
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();
  const found = await findOwnedComposition(db, userId, id);
  if (!found?.comp.thumbnailUpdatedAt) {
    throw createError({ statusCode: 404, statusMessage: "Thumbnail not found" });
  }

  const s3 = useS3();
  let data: Buffer;
  try {
    data = await s3.getObject(`thumbnails/${found.comp.id}.png`);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Thumbnail not found" });
  }

  setHeader(event, "Content-Type", "image/png");
  // Immutable per version; the URL carries ?v=<thumbnailUpdatedAt> for busting.
  setHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
  return data;
});
