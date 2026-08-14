export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);

  const form = await readMultipartFormData(event);
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!file?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing video file" });
  }

  const mime = file.type ?? "video/mp4";
  if (!mime.startsWith("video/")) {
    throw createError({ statusCode: 400, statusMessage: "File must be a video" });
  }

  const extByMime: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const ext = extByMime[mime] ?? "mp4";
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
