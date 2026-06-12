import type { MeshPoint } from "../types/mesh";
import { clientToShaderNorm, snap, type ShaderNorm } from "./wave-position";

export { clientToShaderNorm };

export const MESH_GIZMO_STEPS = {
  position: 0.001,
  radius: 0.001,
} as const;

export type MeshDragTarget =
  | { kind: "move"; index: number }
  | { kind: "radius"; index: number };

export function meshShaderYToCssPercent(shaderY: number): number {
  return (1 - shaderY) * 100;
}

export function aspectRatio(rect: DOMRect): number {
  return rect.height > 0 ? rect.width / rect.height : 1;
}

/** Norm UV (0–1, bottom-left) → aspect-weighted shader plane coords. */
export function normToAspectPlane(norm: ShaderNorm, aspect: number): { x: number; y: number } {
  return {
    x: (norm.x * 2 - 1) * aspect,
    y: norm.y * 2 - 1,
  };
}

export function aspectDistance(a: ShaderNorm, b: ShaderNorm, aspect: number): number {
  const pa = normToAspectPlane(a, aspect);
  const pb = normToAspectPlane(b, aspect);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Visual radius in CSS % for an overlay on the canvas (matches mesh.frag aspect space). */
export function meshGizmoRadiusSize(
  radius: number,
  aspect: number,
): { widthPct: number; heightPct: number } {
  return {
    widthPct: (radius / aspect) * 100,
    heightPct: radius * 100,
  };
}

export function normToScreenPx(norm: ShaderNorm, rect: DOMRect): { x: number; y: number } {
  return {
    x: norm.x * rect.width,
    y: (1 - norm.y) * rect.height,
  };
}

export function meshRingRadiiPx(
  point: MeshPoint,
  rect: DOMRect,
  aspect: number,
): { rx: number; ry: number } {
  const size = meshGizmoRadiusSize(point.radius, aspect);
  return {
    rx: (size.widthPct / 100) * rect.width * 0.5,
    ry: (size.heightPct / 100) * rect.height * 0.5,
  };
}

/** True when the pointer is on the ring stroke (any angle), in screen pixels. */
export function hitMeshRingEdge(
  norm: ShaderNorm,
  point: MeshPoint,
  rect: DOMRect,
  aspect: number,
  hitPx: number,
): boolean {
  const pointer = normToScreenPx(norm, rect);
  const center = normToScreenPx({ x: point.x, y: point.y }, rect);
  const { rx, ry } = meshRingRadiiPx(point, rect, aspect);
  if (rx <= 0 || ry <= 0) return false;

  const dx = (pointer.x - center.x) / rx;
  const dy = (pointer.y - center.y) / ry;
  const ellipseDist = Math.sqrt(dx * dx + dy * dy);
  const radialPx = Math.abs(ellipseDist - 1) * Math.min(rx, ry);
  return radialPx <= hitPx;
}

export function hitMeshGizmoHandle(
  norm: ShaderNorm,
  rect: DOMRect,
  points: MeshPoint[],
  hitPx = 12,
): MeshDragTarget | null {
  const aspect = aspectRatio(rect);
  const centerHitPxSq = (hitPx * 1.5) * (hitPx * 1.5);
  const pointer = normToScreenPx(norm, rect);

  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    const center = normToScreenPx({ x: p.x, y: p.y }, rect);
    const dx = pointer.x - center.x;
    const dy = pointer.y - center.y;
    if (dx * dx + dy * dy <= centerHitPxSq) {
      return { kind: "move", index: i };
    }
  }

  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (hitMeshRingEdge(norm, p, rect, aspect, hitPx)) {
      return { kind: "radius", index: i };
    }
  }

  return null;
}

export type MeshGizmoRanges = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xStep: number;
  yStep: number;
  radiusMin: number;
  radiusMax: number;
  radiusStep: number;
};

export function dragMeshPoints(
  target: MeshDragTarget,
  norm: ShaderNorm,
  points: MeshPoint[],
  ranges: MeshGizmoRanges,
  aspect: number,
): MeshPoint[] {
  const next = points.map((p) => ({ ...p }));
  const current = next[target.index];
  if (!current) return next;

  if (target.kind === "move") {
    next[target.index] = {
      ...current,
      x: snap(norm.x, ranges.xMin, ranges.xMax, ranges.xStep),
      y: snap(norm.y, ranges.yMin, ranges.yMax, ranges.yStep),
    };
    return next;
  }

  const dist = aspectDistance({ x: current.x, y: current.y }, norm, aspect);
  next[target.index] = {
    ...current,
    radius: snap(dist, ranges.radiusMin, ranges.radiusMax, ranges.radiusStep),
  };
  return next;
}
