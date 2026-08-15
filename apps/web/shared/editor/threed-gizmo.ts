import {
  projectLayerQuad,
  projectObjectBounds,
  projectStagePoint,
  type ProjectedPoint,
  type SceneView,
  type ThreeDTransform,
} from "@shader-lab/core";

/**
 * Screen-space projection helpers for 3D layer gizmos. Everything works in
 * GL-style comp UV (0..1, y up) — the same space the 2D gizmo math uses —
 * so projected quads slot straight into the existing screen conversions.
 */

/** Everything a gizmo needs to project a 3D layer like the renderer does. */
export type ThreeDGizmoData = {
  transform: ThreeDTransform;
  view: SceneView;
  /** object3d half-extents (u_sizeX/Y/Z); null for card layers. */
  size: { x: number; y: number; z: number } | null;
};

/** The layer's screen quad (cards: projected corners; objects: projected AABB). */
export function projectGizmoQuad(
  data: ThreeDGizmoData,
  aspect: number,
): ProjectedPoint[] | null {
  if (data.size) return projectObjectBounds(data.transform, data.size, data.view, aspect);
  return projectLayerQuad(data.transform, data.view, aspect);
}

/** The layer's anchor/pivot on screen (stage point of anchor + position). */
export function projectGizmoAnchor(
  data: ThreeDGizmoData,
  aspect: number,
  posOffset: { x: number; y: number } = { x: 0, y: 0 },
): ProjectedPoint | null {
  const t = data.transform;
  return projectStagePoint(
    [
      ((t.anchorX + t.posX + posOffset.x) * 2 - 1) * aspect,
      (t.anchorY + t.posY + posOffset.y) * 2 - 1,
      t.posZ * 2,
    ],
    data.view,
    aspect,
  );
}

/**
 * Inverted 2×2 jacobian mapping a screen-UV delta back to a value delta:
 * `dValue = Jinv · dUv`. Computed numerically so drags track the cursor at
 * the layer's projected depth.
 */
export type InverseJacobian = { a: number; b: number; c: number; d: number };

const JACOBIAN_EPS = 0.01;

/**
 * Numerical inverse jacobian of `project(dx, dy)` (value offsets → screen UV).
 * Null when the point is behind the camera or the mapping is degenerate —
 * callers should fall back to the identity (2D) delta mapping.
 */
export function inverseProjectionJacobian(
  project: (dx: number, dy: number) => ProjectedPoint | null,
): InverseJacobian | null {
  const p0 = project(0, 0);
  const px = project(JACOBIAN_EPS, 0);
  const py = project(0, JACOBIAN_EPS);
  if (!p0 || !px || !py) return null;
  // Forward jacobian J = [[du/dx, du/dy], [dv/dx, dv/dy]].
  const j00 = (px.x - p0.x) / JACOBIAN_EPS;
  const j01 = (py.x - p0.x) / JACOBIAN_EPS;
  const j10 = (px.y - p0.y) / JACOBIAN_EPS;
  const j11 = (py.y - p0.y) / JACOBIAN_EPS;
  const det = j00 * j11 - j01 * j10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return { a: j11 / det, b: -j01 / det, c: -j10 / det, d: j00 / det };
}

/** Inverse jacobian for a layer's position drag (screen delta → pos delta). */
export function inversePositionJacobian(
  data: ThreeDGizmoData,
  aspect: number,
): InverseJacobian | null {
  return inverseProjectionJacobian((dx, dy) =>
    projectGizmoAnchor(data, aspect, { x: dx, y: dy }),
  );
}

/** Map a screen-UV delta through an inverse jacobian to a value delta. */
export function mapUvDelta(
  j: InverseJacobian,
  du: number,
  dv: number,
): { x: number; y: number } {
  return { x: j.a * du + j.b * dv, y: j.c * du + j.d * dv };
}

/** A light's stack-space position (matches render-passes' point-light mapping). */
export function lightStagePoint(
  posX: number,
  posY: number,
  posZ: number,
  aspect: number,
): [number, number, number] {
  return [2 * posX * aspect, 2 * posY, 2 * posZ];
}

/** Average projected depth of a quad — nearest wins in picking priority. */
export function quadDepth(quad: ProjectedPoint[]): number {
  let sum = 0;
  for (const p of quad) sum += p.depth;
  return sum / Math.max(quad.length, 1);
}
