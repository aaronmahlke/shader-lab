/**
 * Drag payload for dragging a composition out of the project panel into the
 * timeline (or onto the viewport). Uses a custom MIME type so the media-file
 * drop path and other drags ignore it entirely.
 */
export const COMP_DRAG_TYPE = "application/x-shaderlab-comp";

export type CompDragPayload = { id: string; name: string };

/** True when a drag carries a composition. Usable during dragover (types only). */
export function dataTransferHasComp(data: DataTransfer | null): boolean {
  return !!data && [...data.types].includes(COMP_DRAG_TYPE);
}

/** Parse the payload on drop. Returns null for foreign or malformed drags. */
export function readCompDragPayload(data: DataTransfer | null): CompDragPayload | null {
  const raw = data?.getData(COMP_DRAG_TYPE) ?? "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompDragPayload>;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    return { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : "" };
  } catch {
    return null;
  }
}