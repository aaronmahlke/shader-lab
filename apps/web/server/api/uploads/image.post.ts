export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);

  const form = await readMultipartFormData(event);
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!file?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing image file" });
  }

  const mime = file.type ?? "image/png";
  if (!mime.startsWith("image/")) {
    throw createError({ statusCode: 400, statusMessage: "File must be an image" });
  }

  // "svg+xml" is not a usable file extension, and the media runtime detects
  // SVG sources by the ".svg" suffix to route them through vector rasterizing.
  const ext =
    mime === "image/jpeg" ? "jpg"
    : mime === "image/svg+xml" ? "svg"
    : mime.split("/")[1] ?? "png";
  const key = `uploads/${userId}/${Date.now()}.${ext}`;
  const s3 = useS3();
  try {
    await s3.putObject(key, file.data, mime);
  } catch (err) {
    console.error(`[uploads] putObject failed for ${key}:`, err);
    throw createError({ statusCode: 502, statusMessage: "Media storage is unavailable" });
  }

  // App-served URL: the S3 endpoint is internal-only in prod, so its raw URL
  // would be unreachable from the browser.
  return { url: `/api/media/${key}` };
});
