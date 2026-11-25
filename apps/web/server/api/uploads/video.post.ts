export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);

  const form = await readMultipartFormData(event);
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!file?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing video file" });
  }
  // Local mode stores media in the project's assets/ folder.
  const projectId = form?.find((p) => p.name === "projectId")?.data.toString() || undefined;

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

  const key = await useStore().putMedia({ userId, projectId }, { ext, data: file.data, mime, name: file.filename });
  // App-served URL: storage is never browser-reachable directly.
  return { url: `/api/media/${key}` };
});
