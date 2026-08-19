import type { LayerInstance } from "../types/editor";
import { isLayer3D } from "./universal-uniforms";

/**
 * 3D grouping (AE model): contiguous 3D layers share one depth-sorted space;
 * any 2D layer between them acts as a wall that splits the group.
 *
 * Disabled layers are neutral: they neither join nor break a run, because they
 * do not exist at render time.
 */

/** A contiguous run of 3D layers, as indices into the given array: [start, end). */
export type ThreeDRun = {
  start: number;
  end: number;
  /** Ids of the enabled 3D members, in array order. */
  layerIds: string[];
};

type RunLayer = Pick<LayerInstance, "id" | "type" | "is3D" | "enabled">;

/**
 * Find contiguous 3D runs in a layer list (works on any consistent order —
 * UI top→bottom or compiler bottom→top). Runs of a single 3D layer count:
 * a lone 3D layer still renders through the 3D path.
 */
export function find3DRuns(layers: readonly RunLayer[]): ThreeDRun[] {
  const runs: ThreeDRun[] = [];
  let current: ThreeDRun | null = null;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.enabled) continue; // neutral: keeps an open run alive
    if (isLayer3D(layer)) {
      if (!current) current = { start: i, end: i + 1, layerIds: [] };
      current.end = i + 1;
      current.layerIds.push(layer.id);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

/** Ids of every layer that is part of some 3D run (for UI group brackets). */
export function threeDGroupMemberIds(layers: readonly RunLayer[]): Set<string> {
  const ids = new Set<string>();
  for (const run of find3DRuns(layers)) {
    for (const id of run.layerIds) ids.add(id);
  }
  return ids;
}