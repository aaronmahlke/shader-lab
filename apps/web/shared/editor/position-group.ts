import { universalUniformsFor, type LayerInstance } from "@shader-lab/core";

/**
 * AE-style linked Position: X/Y(/Z) show as one "Position" property and are
 * keyframed together. Per-axis edits happen in the axis rows folded out under
 * it in the timeline. Data stays per axis (one track each), so rendering
 * never sees the grouping.
 */
export const POSITION_GROUP = "layerPosition";

const AXES = ["layerPositionX", "layerPositionY", "layerPositionZ"];

/** Position axes the layer has (Z only on 3D layers). */
export function positionAxes(layer: Pick<LayerInstance, "type" | "is3D">): string[] {
  const names = new Set(universalUniformsFor(layer).map((d) => d.name));
  return AXES.filter((a) => names.has(a));
}

export function isPositionAxis(paramName: string): boolean {
  return AXES.includes(paramName);
}

/**
 * Params an edit to `paramName` should apply to: all position axes (linked),
 * else just the param.
 */
export function linkedParams(
  layer: Pick<LayerInstance, "type" | "is3D"> | undefined,
  paramName: string,
): string[] {
  if (!layer) return [paramName];
  if (paramName === POSITION_GROUP) return positionAxes(layer);
  if (isPositionAxis(paramName)) {
    const axes = positionAxes(layer);
    return axes.includes(paramName) ? axes : [paramName];
  }
  return [paramName];
}
