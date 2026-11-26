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
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export default defineEventHandler(async (event) => {
  await requireUser(event);

  const path = getRouterParam(event, "path");
  const store = useStore();
  // Only store-issued keys are served (hosted: uploads/<userId>/<ts>.<ext>,
  // local: local/<projectId>/<file>).
  if (!path || !store.isValidMediaKey(path)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid media path" });
  }

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    throw createError({ statusCode: 400, statusMessage: "Unsupported media type" });
  }

  const data = await store.getMedia(path);
  if (!data) throw createError({ statusCode: 404, statusMessage: "Media not found" });

  setHeader(event, "Content-Type", contentType);
  // Keys embed an upload timestamp and are never overwritten.
  setHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
  // SVG served inline is a script vector; keep it inert.
  if (ext === "svg") {
    setHeader(event, "Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  }
  return data;
});