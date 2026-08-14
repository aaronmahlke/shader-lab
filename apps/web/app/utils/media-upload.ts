/** Media kinds the editor can upload; each maps to its own endpoint. */
export type MediaUploadKind = "image" | "video";

/**
 * POST a media file to the upload endpoint (multipart field "file", session
 * cookie auth) and return the hosted URL to store in the layer's `src`.
 */
export async function uploadMediaFile(
  kind: MediaUploadKind,
  file: File,
): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const response = await $fetch<{ url: string }>(`/api/uploads/${kind}`, {
    method: "POST",
    body,
  });
  return response.url;
}

/** Upload kind a file maps to by MIME type, or null when the editor can't use it. */
export function mediaUploadKindForFile(file: File): MediaUploadKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** Media files (image/video) in a drop or paste payload, in listed order. */
export function mediaFilesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((file) => mediaUploadKindForFile(file) !== null);
}

/**
 * Whether a drag payload carries files. During dragover the browser hides
 * file contents, so `types` is the only signal available before the drop.
 */
export function dataTransferHasFiles(data: DataTransfer | null): boolean {
  return !!data && [...data.types].includes("Files");
}

/** SVG markup at the start of pasted text (optional XML prolog / doctype). */
const SVG_TEXT_RE = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!DOCTYPE[\s\S]*?>\s*)?<svg[\s>]/i;

/**
 * "Copy as SVG" in vector tools (and copying markup in a code editor) puts
 * SVG source on the clipboard as plain text, not a file. Wrap it into a File
 * so it can ride the normal upload path.
 */
export function svgFileFromText(text: string): File | null {
  if (!SVG_TEXT_RE.test(text)) return null;
  return new File([text], "pasted.svg", { type: "image/svg+xml" });
}

/** Last path segment of a src URL (query stripped) for compact display. */
export function mediaSrcFileName(src: string): string {
  if (!src) return "";
  const withoutQuery = src.split(/[?#]/, 1)[0] ?? src;
  const tail = withoutQuery.split("/").filter(Boolean).pop();
  try {
    return decodeURIComponent(tail ?? withoutQuery);
  } catch {
    return tail ?? withoutQuery;
  }
}
