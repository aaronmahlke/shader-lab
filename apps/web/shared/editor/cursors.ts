/**
 * Built-in cursor graphics (public/cursors/v2/*.svg, `data-native-size`: shown
 * at their own size). The hotspot is where the cursor points; it becomes the
 * layer's anchor, so the cursor scales (press) and rotates around its tip.
 */
export type BuiltInCursor = {
  src: string;
  label: string;
  width: number;
  height: number;
  /** Hotspot in SVG px from the top-left. */
  tipX: number;
  tipY: number;
};

export const BUILT_IN_CURSORS: BuiltInCursor[] = [
  { src: "/cursors/v2/arrow.svg", label: "Arrow", width: 32, height: 48, tipX: 3, tipY: 3 },
  { src: "/cursors/v2/hand.svg", label: "Hand", width: 40, height: 48, tipX: 13, tipY: 3 },
  { src: "/cursors/v2/text.svg", label: "Text", width: 24, height: 48, tipX: 12, tipY: 24 },
];

export function builtInCursor(src: unknown): BuiltInCursor | null {
  return BUILT_IN_CURSORS.find((c) => c.src === src) ?? null;
}

/**
 * Layer-UV anchor on the hotspot. Image content is drawn centered in the
 * layer, whose UV spans the comp frame (y up).
 */
export function cursorAnchor(c: BuiltInCursor, comp: { width: number; height: number }): { x: number; y: number } {
  return {
    x: 0.5 + (c.tipX - c.width / 2) / comp.width,
    y: 0.5 - (c.tipY - c.height / 2) / comp.height,
  };
}
