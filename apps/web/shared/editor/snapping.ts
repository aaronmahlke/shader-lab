import type { LayerInstance } from "@shader-lab/core";
import {
  layerBoundsInCompUv,
  type LayerTransformValues,
} from "./layer-transform";
import { PICKABLE_LAYER_TYPES } from "./canvas-picking";

/** Candidate snap lines on both axes, in comp UV. */
export type SnapTargets = {
  x: number[];
  y: number[];
};

export type SnapHit = {
  /** Offset to add to the dragged value so it lands on the target. */
  delta: number;
  /** The target line that matched (for drawing the guide). */
  target: number;
};

/**
 * Best snap for a set of candidate lines (edges + center of the dragged
 * bounds) against target lines. Returns null when nothing is within the
 * threshold.
 */
export function findSnap(
  candidates: number[],
  targets: number[],
  threshold: number,
): SnapHit | null {
  let best: SnapHit | null = null;
  for (const candidate of candidates) {
    for (const target of targets) {
      const delta = target - candidate;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, target };
      }
    }
  }
  return best;
}

/**
 * Snap lines for a composition: frame edges + center, plus the edges and
 * centers of every other visible pickable layer.
 */
export function collectSnapTargets(
  layers: LayerInstance[],
  excludeLayerId: string | null,
  aspect: number,
  getTransform: (layer: LayerInstance) => LayerTransformValues,
): SnapTargets {
  const x = [0, 0.5, 1];
  const y = [0, 0.5, 1];
  for (const layer of layers) {
    if (!layer.enabled || layer.id === excludeLayerId) continue;
    if (!PICKABLE_LAYER_TYPES.has(layer.type)) continue;
    const bounds = layerBoundsInCompUv(getTransform(layer), aspect);
    x.push(bounds.minX, bounds.centerX, bounds.maxX);
    y.push(bounds.minY, bounds.centerY, bounds.maxY);
  }
  return { x, y };
}
