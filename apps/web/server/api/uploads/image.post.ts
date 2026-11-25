export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);

  const form = await readMultipartFormData(event);
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!file?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing image file" });
  }
  // Local mode stores media in the project's assets/ folder.
  const projectId = form?.find((p) => p.name === "projectId")?.data.toString() || undefined;

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

  const key = await useStore().putMedia({ userId, projectId }, { ext, data: file.data, mime, name: file.filename });
  // App-served URL: storage is never browser-reachable directly.
  return { url: `/api/media/${key}` };
});
