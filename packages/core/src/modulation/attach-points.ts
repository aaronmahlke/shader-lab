import type { LayerInstance } from "../types/editor";
import LAYER_TEMPLATES from "../compiler/layer-templates";
import { layoutTextSpec, textSpecFromValues } from "../renderer/text-raster";

/**
 * Attach points: named spots on a layer that children can be parented to
 * (instead of the layer's anchor). Positions are local offsets in
 * frame-height units from the layer's anchor, before the layer's own
 * rotation/scale (the parent chain applies those).
 *
 *   textEnd — just after the last revealed character of a text layer; moves
 *             as the text types (attach a cursor, a glow, a whole precomp…).
 */
export type AttachPoint = "textEnd";

export const ATTACH_POINTS: Record<AttachPoint, { label: string; layerTypes: LayerInstance["type"][] }> = {
  textEnd: { label: "Text end", layerTypes: ["text"] },
};

export function attachPointsFor(layer: Pick<LayerInstance, "type">): AttachPoint[] {
  return (Object.keys(ATTACH_POINTS) as AttachPoint[]).filter((p) => ATTACH_POINTS[p].layerTypes.includes(layer.type));
}

/** Width of `text` in `font` (CSS font string). */
export type TextMeasure = (text: string, font: string) => number;

/** Fallback when no canvas is available: monospace-ish estimate from the font size. */
export const estimateTextWidth: TextMeasure = (text, font) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * px * 0.6;
};

/** Reads a param after keyframes + links. */
export type PointParamReader = (layer: LayerInstance, paramName: string) => number;

/**
 * Local offset of an attach point (frame-height units, y up) from the
 * layer's anchor, or null when the layer doesn't have that point.
 */
export function attachPointOffset(
  layer: LayerInstance,
  point: AttachPoint,
  read: PointParamReader,
  measure: TextMeasure,
  compWidth: number,
  compHeight: number,
): { x: number; y: number } | null {
  if (point !== "textEnd" || layer.type !== "text") return null;
  // Animated numeric text params (progress, size, tracking…) at this frame.
  const values: Record<string, unknown> = { ...layer.values };
  for (const def of LAYER_TEMPLATES.text.uniforms) {
    if (def.type === "float" || def.type === "int") values[def.name] = read(layer, def.name);
  }
  const spec = textSpecFromValues(values);
  const { end } = layoutTextSpec(spec, compWidth, compHeight, 1, measure);
  const anchorX = read(layer, "layerAnchorX");
  const anchorY = read(layer, "layerAnchorY");
  return {
    x: (end.x / compWidth - anchorX) * (compWidth / compHeight),
    y: 1 - end.y / compHeight - anchorY,
  };
}
