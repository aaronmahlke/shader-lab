/**
 * Math for the universal layer transform gizmo.
 *
 * Mirrors the mapping in `layer-composite.frag`: a layer's unit UV square is
 * scaled/rotated (aspect-corrected) about its anchor, then offset by position.
 * All UVs are GL-style (y up); screen conversions flip y.
 */

export type LayerTransformValues = {
  positionX: number;
  positionY: number;
  scale: number;    // percent, 100 = identity
  rotation: number; // degrees, positive = clockwise on screen
  anchorX: number;
  anchorY: number;
};

export type Vec2 = { x: number; y: number };

/**
 * The rect a layer's pixels actually occupy inside its full-frame FBO, in
 * layer-UV unit-square terms (GL-style, y up). Most generators cover the
 * whole frame; component and text layers draw a smaller centered rect, so
 * their outline/gizmo/hit-test should wrap only that rect. Display/hit
 * bounds only — transform semantics still operate on the full unit square.
 */
export type ContentExtent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const FULL_CONTENT_EXTENT: ContentExtent = Object.freeze({
  minX: 0,
  minY: 0,
  maxX: 1,
  maxY: 1,
});

export const TRANSFORM_PARAM_NAMES = {
  positionX: "layerPositionX",
  positionY: "layerPositionY",
  scale: "layerScale",
  rotation: "layerRotation",
  anchorX: "layerAnchorX",
  anchorY: "layerAnchorY",
} as const;

/** The transform's pivot in comp UV space (anchor plus position offset). */
export function transformCenter(v: LayerTransformValues): Vec2 {
  return { x: v.anchorX + v.positionX, y: v.anchorY + v.positionY };
}

/** Forward map: layer UV → comp UV (inverse of the shader's sampling transform). */
export function layerToCompUv(luv: Vec2, v: LayerTransformValues, aspect: number): Vec2 {
  const s = Math.max(v.scale / 100, 1e-4);
  let dx = (luv.x - v.anchorX) * aspect * s;
  const dy = (luv.y - v.anchorY) * s;

  const a = (v.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  // Inverse of the shader's mat2(c, s, -s, c).
  const rx = c * dx + sn * dy;
  const ry = -sn * dx + c * dy;

  dx = rx / aspect;
  const center = transformCenter(v);
  return { x: dx + center.x, y: ry + center.y };
}

/**
 * The transformed corners of the layer's content rect, in comp UV
 * (bl, br, tr, tl). Defaults to the full unit square; pass a content
 * extent to wrap only the pixels the layer actually draws.
 */
export function layerCornersInCompUv(
  v: LayerTransformValues,
  aspect: number,
  extent: ContentExtent = FULL_CONTENT_EXTENT,
): Vec2[] {
  return [
    { x: extent.minX, y: extent.minY },
    { x: extent.maxX, y: extent.minY },
    { x: extent.maxX, y: extent.maxY },
    { x: extent.minX, y: extent.maxY },
  ].map((luv) => layerToCompUv(luv, v, aspect));
}

export type LayerBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
};

/** Axis-aligned bounds of the layer's transformed content rect, in comp UV. */
export function layerBoundsInCompUv(
  v: LayerTransformValues,
  aspect: number,
  extent: ContentExtent = FULL_CONTENT_EXTENT,
): LayerBounds {
  const corners = layerCornersInCompUv(v, aspect, extent);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/**
 * Rotate a comp UV point around a center by `degrees` (positive = clockwise
 * on screen), aspect-corrected — matches the layer rotation semantics.
 */
export function rotateAroundInCompUv(
  point: Vec2,
  center: Vec2,
  degrees: number,
  aspect: number,
): Vec2 {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const dx = (point.x - center.x) * aspect;
  const dy = point.y - center.y;
  // Forward rotation, same convention as layerToCompUv.
  const rx = c * dx + sn * dy;
  const ry = -sn * dx + c * dy;
  return { x: center.x + rx / aspect, y: center.y + ry };
}

/** Union of several bounds. */
export function unionBounds(all: LayerBounds[]): LayerBounds | null {
  if (all.length === 0) return null;
  const minX = Math.min(...all.map((b) => b.minX));
  const maxX = Math.max(...all.map((b) => b.maxX));
  const minY = Math.min(...all.map((b) => b.minY));
  const maxY = Math.max(...all.map((b) => b.maxY));
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/** Comp UV → CSS pixel position inside a stage of the given size. */
export function compUvToScreen(uv: Vec2, width: number, height: number): Vec2 {
  return { x: uv.x * width, y: (1 - uv.y) * height };
}

/** CSS pixel position → comp UV. */
export function screenToCompUv(p: Vec2, width: number, height: number): Vec2 {
  return { x: p.x / width, y: 1 - p.y / height };
}

/** Inverse map: comp UV → layer UV (mirrors the shader's sampling transform). */
export function compToLayerUv(uv: Vec2, v: LayerTransformValues, aspect: number): Vec2 {
  const center = transformCenter(v);
  let dx = (uv.x - center.x) * aspect;
  const dy = uv.y - center.y;

  const a = (v.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  // The shader's mat2(c, s, -s, c).
  const rx = c * dx - sn * dy;
  const ry = sn * dx + c * dy;

  const s = Math.max(v.scale / 100, 1e-4);
  dx = rx / s / aspect;
  return { x: dx + v.anchorX, y: ry / s + v.anchorY };
}

/** True when a comp UV point falls inside the layer's transformed content rect. */
export function isPointInLayer(
  uv: Vec2,
  v: LayerTransformValues,
  aspect: number,
  extent: ContentExtent = FULL_CONTENT_EXTENT,
): boolean {
  const luv = compToLayerUv(uv, v, aspect);
  return (
    luv.x >= extent.minX && luv.x <= extent.maxX && luv.y >= extent.minY && luv.y <= extent.maxY
  );
}

/** Aspect-corrected offset of a comp UV point from the transform center. */
function centeredAspect(uv: Vec2, v: LayerTransformValues, aspect: number): Vec2 {
  const center = transformCenter(v);
  return { x: (uv.x - center.x) * aspect, y: uv.y - center.y };
}

/** Distance of a comp UV point from the transform center in aspect space. */
export function distanceFromCenter(uv: Vec2, v: LayerTransformValues, aspect: number): number {
  const p = centeredAspect(uv, v, aspect);
  return Math.hypot(p.x, p.y);
}

/**
 * Screen-clockwise angle (degrees) of a comp UV point around the transform
 * center. Consistent with `rotation` being clockwise-positive on screen.
 */
export function angleAroundCenter(uv: Vec2, v: LayerTransformValues, aspect: number): number {
  const p = centeredAspect(uv, v, aspect);
  return (Math.atan2(-p.y, p.x) * 180) / Math.PI;
}

export function snapValue(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6));
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalize an angle delta to the shortest signed distance (-180, 180]. */
export function shortestAngleDelta(delta: number): number {
  let d = delta % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
