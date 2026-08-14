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
  const url = await s3.putObject(key, file.data, mime);

  return { url };
});
