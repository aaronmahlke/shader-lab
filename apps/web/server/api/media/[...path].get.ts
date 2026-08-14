// Streams uploaded media through the app so the S3 endpoint never needs to be
// browser-reachable (it is internal-only in prod; raw S3 URLs broke all media
// layers, same failure as dashboard thumbnails).

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export default defineEventHandler(async (event) => {
  await requireUser(event);

  const path = getRouterParam(event, "path");
  // Only timestamped upload keys are served: uploads/<userId>/<ts>.<ext>
  if (!path || !/^uploads\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(path)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid media path" });
  }

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    throw createError({ statusCode: 400, statusMessage: "Unsupported media type" });
  }

  const s3 = useS3();
  let data: Buffer;
  try {
    data = await s3.getObject(path);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Media not found" });
  }

  setHeader(event, "Content-Type", contentType);
  // Keys embed an upload timestamp and are never overwritten.
  setHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
  // SVG served inline is a script vector; keep it inert.
  if (ext === "svg") {
    setHeader(event, "Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  }
  return data;
});