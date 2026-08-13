import type { LayerInstance } from "@shader-lab/core";
import {
  isPointInLayer,
  type ContentExtent,
  type LayerTransformValues,
  type Vec2,
} from "./layer-transform";

/** Layers selectable by clicking the canvas (full-frame effects are not). */
export const PICKABLE_LAYER_TYPES = new Set<LayerInstance["type"]>([
  "gradient",
  "solid",
  "noise",
  "text",
  "component",
  "shape",
  "waveFill",
  "bandFill",
  "mesh",
]);

/** Topmost pickable layer under a comp UV point (layers are stored top-first). */
export function topLayerAt(
  layers: LayerInstance[],
  uv: Vec2,
  aspect: number,
  getTransform: (layer: LayerInstance) => LayerTransformValues,
  getExtent?: (layer: LayerInstance) => ContentExtent,
): LayerInstance | null {
  for (const layer of layers) {
    if (!layer.enabled || !PICKABLE_LAYER_TYPES.has(layer.type)) continue;
    if (isPointInLayer(uv, getTransform(layer), aspect, getExtent?.(layer))) return layer;
  }
  return null;
}
