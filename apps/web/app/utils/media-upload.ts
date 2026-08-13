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
