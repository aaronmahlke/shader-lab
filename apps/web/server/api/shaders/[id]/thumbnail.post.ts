export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();

  // Verify ownership
  const [shader] = await db
    .select({ id: shaders.id })
    .from(shaders)
    .where(and(eq(shaders.id, id), eq(shaders.userId, userId)))
    .limit(1);

  if (!shader) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }

  // Read uploaded file from multipart form data
  const formData = await readMultipartFormData(event);
  const file = formData?.find((f) => f.name === "file");

  if (!file || !file.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing thumbnail file" });
  }

  // Upload to S3
  const s3 = useS3();
  const key = `thumbnails/${id}.png`;
  const thumbnailUrl = await s3.putObject(key, file.data, "image/png");

  // Update the shader record
  await db
    .update(shaders)
    .set({
      thumbnailUrl,
      thumbnailUpdatedAt: new Date(),
    })
    .where(eq(shaders.id, id));

  return { thumbnailUrl };
});
