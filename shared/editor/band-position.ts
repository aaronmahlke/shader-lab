import { clientToShaderNorm, snap, waveShaderYToCssPercent, type ShaderNorm } from "./wave-position";

export { clientToShaderNorm, waveShaderYToCssPercent as bandShaderYToCssPercent };

export const BAND_Y = "bandY" as const;
export const BAND_EDGE = "edge" as const;

export const BAND_GIZMO_STEPS = {
  position: 0.001,
  edge: 0.001,
} as const;

export type BandDragMode = "move" | "n" | "s";

export type BandGizmoValues = {
  bandY: number;
  edge: number;
};

export type BandGizmoContext = {
  /** Global edgeWidth from hybrid dissolve (composite-fill uniform). */
  globalEdgeWidth: number;
};

export type BandGizmoRanges = {
  yMin: number;
  yMax: number;
  yStep: number;
  edgeMin: number;
  edgeMax: number;
  edgeStep: number;
};

/**
 * Visible feather half-height on the band gizmo.
 * composite-fill applies coverageMask then shapeAt; both use e = edgeWidth * edge,
 * which compresses the on-screen transition to roughly e² in UV space.
 */
export function bandFeatherHalf(edge: number, globalEdgeWidth: number): number {
  const e = globalEdgeWidth * edge;
  return e * e;
}

export function edgeFromFeatherHalf(half: number, globalEdgeWidth: number): number {
  if (globalEdgeWidth <= 1e-6) return 0;
  return Math.sqrt(Math.max(half, 0)) / globalEdgeWidth;
}

export function hitBandGizmoHandle(
  norm: ShaderNorm,
  rect: DOMRect,
  values: BandGizmoValues,
  context: BandGizmoContext,
  hitPx = 12,
): BandDragMode | null {
  const feather = bandFeatherHalf(values.edge, context.globalEdgeWidth);
  const hitNormY = hitPx / rect.height;
  const north = values.bandY + feather;
  const south = values.bandY - feather;

  if (Math.abs(norm.y - north) <= hitNormY) return "n";
  if (Math.abs(norm.y - south) <= hitNormY) return "s";
  if (Math.abs(norm.y - values.bandY) <= hitNormY * 1.25) return "move";

  return null;
}

export function dragBandGizmo(
  mode: BandDragMode,
  norm: ShaderNorm,
  current: BandGizmoValues,
  ranges: BandGizmoRanges,
  context: BandGizmoContext,
  moveOffsetY: number | null = null,
): BandGizmoValues {
  if (mode === "move") {
    const y = moveOffsetY !== null ? norm.y - moveOffsetY : norm.y;
    return {
      ...current,
      bandY: snap(y, ranges.yMin, ranges.yMax, ranges.yStep),
    };
  }

  if (mode === "n") {
    const half = Math.max(0, norm.y - current.bandY);
    return {
      ...current,
      edge: snap(
        edgeFromFeatherHalf(half, context.globalEdgeWidth),
        ranges.edgeMin,
        ranges.edgeMax,
        ranges.edgeStep,
      ),
    };
  }

  const half = Math.max(0, current.bandY - norm.y);
  return {
    ...current,
    edge: snap(
      edgeFromFeatherHalf(half, context.globalEdgeWidth),
      ranges.edgeMin,
      ranges.edgeMax,
      ranges.edgeStep,
    ),
  };
}
