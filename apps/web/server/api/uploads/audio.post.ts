export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);

  const form = await readMultipartFormData(event);
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!file?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing audio file" });
  }
  // Local mode stores media in the project's assets/ folder.
  const projectId = form?.find((p) => p.name === "projectId")?.data.toString() || undefined;

  const mime = file.type ?? "audio/mpeg";
  if (!mime.startsWith("audio/")) {
    throw createError({ statusCode: 400, statusMessage: "File must be audio" });
  }

  // Formats browsers can decode (Web Audio). AIFF isn't one in Chrome.
  const extByMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
  };
  const ext = extByMime[mime];
  if (!ext) {
    throw createError({ statusCode: 400, statusMessage: "Unsupported audio format (use MP3, WAV, M4A, OGG or FLAC)" });
  }

  const key = await useStore().putMedia({ userId, projectId }, { ext, data: file.data, mime, name: file.filename });
  // App-served URL: storage is never browser-reachable directly.
  return { url: `/api/media/${key}` };
});
