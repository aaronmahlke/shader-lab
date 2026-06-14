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

  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "png";
  const key = `uploads/${userId}/${Date.now()}.${ext}`;
  const s3 = useS3();
  const url = await s3.putObject(key, file.data, mime);

  return { url };
});
