import { pointInProjectedQuad, type LayerInstance, type ProjectedPoint } from "@shader-lab/core";
import {
  isPointInLayer,
  type ContentExtent,
  type LayerTransformValues,
  type Vec2,
} from "./layer-transform";
import { quadDepth } from "./threed-gizmo";

/** Layers selectable by clicking the canvas (full-frame effects are not). */
export const PICKABLE_LAYER_TYPES = new Set<LayerInstance["type"]>([
  "gradient",
  "solid",
  "noise",
  "text",
  "component",
  "image",
  "video",
  "shape",
  "waveFill",
  "bandFill",
  "mesh",
  "object3d",
]);

/**
 * A 3D layer's projected screen quad (comp UV, y up). Non-null result marks
 * the layer as 3D; a null `quad` inside means it is behind the camera and
 * therefore unpickable.
 */
export type LayerProjection = { quad: ProjectedPoint[] | null };

/**
 * Topmost pickable layer under a comp UV point (layers are stored top-first).
 *
 * 2D layers keep the plain stack priority. 3D layers hit-test against their
 * projected quad; among the leading run of 3D hits the NEAREST depth wins —
 * matching the painter's depth sort visually. A 2D hit above any 3D hit
 * still wins, like today's stack order.
 */
export function topLayerAt(
  layers: LayerInstance[],
  uv: Vec2,
  aspect: number,
  getTransform: (layer: LayerInstance) => LayerTransformValues,
  getExtent?: (layer: LayerInstance) => ContentExtent,
  getProjection?: (layer: LayerInstance) => LayerProjection | null,
): LayerInstance | null {
  type Hit = { layer: LayerInstance; depth: number | null };
  const hits: Hit[] = [];
  for (const layer of layers) {
    if (!layer.enabled || !PICKABLE_LAYER_TYPES.has(layer.type)) continue;
    const projection = getProjection?.(layer);
    if (projection) {
      const quad = projection.quad;
      if (!quad) continue; // behind the camera → not visible, not pickable
      if (pointInProjectedQuad(uv.x, uv.y, quad)) {
        hits.push({ layer, depth: quadDepth(quad) });
      }
      continue;
    }
    if (isPointInLayer(uv, getTransform(layer), aspect, getExtent?.(layer))) {
      hits.push({ layer, depth: null });
    }
  }

  const first = hits[0];
  if (!first) return null;
  if (first.depth === null) return first.layer;

  // Leading run of 3D hits (down to the first 2D hit): nearest depth wins.
  let best = first;
  for (let i = 1; i < hits.length; i++) {
    const hit = hits[i]!;
    if (hit.depth === null) break;
    if (hit.depth < best.depth!) best = hit;
  }
  return best.layer;
}
