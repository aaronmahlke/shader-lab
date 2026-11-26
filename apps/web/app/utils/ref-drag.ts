import { shallowRef } from "vue";

/**
 * Drag things onto object fields (Unity-style reference slots).
 *
 * Layers are dragged with the timeline's pointer-based reorder, so they don't
 * use HTML drag-and-drop: the reorder publishes what it carries here, finds
 * the field under the pointer (`[data-ref-drop]`) and, on release over one,
 * dispatches `ref-drop` on it instead of reordering. Comps and components
 * come from the project panel via native drag-and-drop (MIME types below).
 */
export type RefDragPayload =
  | { kind: "layer"; ids: string[] }
  | { kind: "comp"; ids: string[] }
  | { kind: "component"; ids: string[] };

export const COMPONENT_DRAG_TYPE = "application/x-shaderlab-component";

/** What's being dragged right now (pointer-based drags only). */
export const refDrag = shallowRef<RefDragPayload | null>(null);
/** The object field under the pointer during such a drag. */
export const refDropTarget = shallowRef<HTMLElement | null>(null);

export const REF_DROP_EVENT = "ref-drop";

export function refFieldAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  return (el?.closest("[data-ref-drop]") as HTMLElement | null) ?? null;
}
