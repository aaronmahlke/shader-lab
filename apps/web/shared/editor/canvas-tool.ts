/** Active pointer tool on the canvas (Figma-style toolbar). */
export type CanvasTool = "select" | "text";

/** How the inline text editor places its initial caret/selection. */
export type TextEditIntent =
  | { type: "end" }
  | { type: "all" }
  | { type: "point"; clientX: number; clientY: number; drag?: boolean };
