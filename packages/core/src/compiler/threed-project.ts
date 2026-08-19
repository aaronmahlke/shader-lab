import type { LayerInstance } from "../types/editor";
import type { SceneView } from "../renderer/threed-order";
import { find3DRuns } from "./threed";

/**
 * Screen-space projection of 3D layers — the exact math of
 * layer-composite-3d.frag, in TS, so gizmos and canvas picking can match the
 * render. All coordinates are GL-style UV (0..1, y up); hosts flip y for DOM.
 */

export type Vec3 = [number, number, number];
export type ProjectedPoint = {
  /** GL uv (0..1, y up); may lie outside the frame. */
  x: number;
  y: number;
  /** View-space depth (distance along -Z); larger = farther. */
  depth: number;
};

export type ThreeDTransform = {
  posX: number;
  posY: number;
  posZ: number;
  /** Percent, 100 = identity. */
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  anchorX: number;
  anchorY: number;
};

type Mat3 = [number, number, number, number, number, number, number, number, number];

const deg = Math.PI / 180;

/** Row-major mat3 multiply: a * b. */
function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  return r;
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function rx(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function ry(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rz(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Scene camera rotation — camera-stage's plateRotation (rz * rx * ry). */
export function cameraMatrix(view: SceneView): Mat3 {
  return mul(rz(view.roll * deg), mul(rx(view.tilt * deg), ry(view.yaw * deg)));
}

/** Layer rotation — matches the shader (Z negated for the 2D clockwise convention). */
function layerMatrix(t: ThreeDTransform): Mat3 {
  return mul(rz(-t.rotZ * deg), mul(rx(t.rotX * deg), ry(t.rotY * deg)));
}

function camDistance(view: SceneView): number {
  const tanHalf = Math.tan((view.fov * deg) / 2);
  return 1 / tanHalf / Math.max(view.zoom, 1e-3);
}

/** Project a world-space point (camera at origin, looking down -Z). */
function projectWorld(p: Vec3, view: SceneView, aspect: number): ProjectedPoint | null {
  if (p[2] >= -1e-4) return null; // behind the camera
  const tanHalf = Math.tan((view.fov * deg) / 2);
  const ndcX = p[0] / -p[2] / (tanHalf * aspect);
  const ndcY = p[1] / -p[2] / tanHalf;
  return { x: ndcX * 0.5 + 0.5, y: ndcY * 0.5 + 0.5, depth: -p[2] };
}

/** Project a stack-space point (x right, y up, z toward camera; frame is 2 units tall). */
export function projectStagePoint(
  s: Vec3,
  view: SceneView,
  aspect: number,
): ProjectedPoint | null {
  const world = apply(cameraMatrix(view), s);
  return projectWorld([world[0], world[1], world[2] - camDistance(view)], view, aspect);
}

/** Stack-space position of a layer point given in layer UV (0..1). */
function stagePointForLayerUv(
  t: ThreeDTransform,
  u: number,
  v: number,
  aspect: number,
): Vec3 {
  const s = Math.max(t.scale / 100, 1e-4);
  const centerU = t.anchorX + t.posX;
  const centerV = t.anchorY + t.posY;
  const anchor: Vec3 = [(centerU * 2 - 1) * aspect, centerV * 2 - 1, t.posZ * 2];
  const local: Vec3 = [(u - t.anchorX) * 2 * aspect * s, (v - t.anchorY) * 2 * s, 0];
  const rotated = apply(layerMatrix(t), local);
  return [anchor[0] + rotated[0], anchor[1] + rotated[1], anchor[2] + rotated[2]];
}

/**
 * The layer quad's corners on screen, in GL uv, corner order
 * (0,0) (1,0) (1,1) (0,1). Null when any corner lands behind the camera.
 */
export function projectLayerQuad(
  t: ThreeDTransform,
  view: SceneView,
  aspect: number,
): ProjectedPoint[] | null {
  const cam = cameraMatrix(view);
  const dist = camDistance(view);
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const out: ProjectedPoint[] = [];
  for (const [u, v] of corners) {
    const stage = stagePointForLayerUv(t, u, v, aspect);
    const world = apply(cam, stage);
    const p = projectWorld([world[0], world[1], world[2] - dist], view, aspect);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** Point-in-projected-quad test (uv space; quad from projectLayerQuad). */
export function pointInProjectedQuad(
  x: number,
  y: number,
  quad: ProjectedPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i]!;
    const b = quad[j]!;
    const intersects =
      a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Read a layer's 3D transform from evaluated values (universal names). */
export function threeDTransformFromValues(
  values: Record<string, unknown>,
  read: (name: string, fallback: number) => number = (name, fallback) => {
    const raw = values[name];
    return typeof raw === "number" ? raw : fallback;
  },
): ThreeDTransform {
  return {
    posX: read("layerPositionX", 0),
    posY: read("layerPositionY", 0),
    posZ: read("layerPositionZ", 0),
    scale: read("layerScale", 100),
    rotX: read("layerRotationX", 0),
    rotY: read("layerRotationY", 0),
    rotZ: read("layerRotation", 0),
    anchorX: read("layerAnchorX", 0.5),
    anchorY: read("layerAnchorY", 0.5),
  };
}

/**
 * Screen quad of an object3d's bounding box: project the 8 corners and return
 * the screen-space AABB as a quad (same corner order as projectLayerQuad).
 */
export function projectObjectBounds(
  t: ThreeDTransform,
  size: { x: number; y: number; z: number },
  view: SceneView,
  aspect: number,
): ProjectedPoint[] | null {
  const cam = cameraMatrix(view);
  const layer = layerMatrix(t);
  const dist = camDistance(view);
  const s = Math.max(t.scale / 100, 1e-4);
  const centerU = t.anchorX + t.posX;
  const centerV = t.anchorY + t.posY;
  const anchor: Vec3 = [(centerU * 2 - 1) * aspect, centerV * 2 - 1, t.posZ * 2];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, depth = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const local: Vec3 = [sx * size.x * s, sy * size.y * s, sz * size.z * s];
        const rotated = apply(layer, local);
        const stage: Vec3 = [anchor[0] + rotated[0], anchor[1] + rotated[1], anchor[2] + rotated[2]];
        const world = apply(cam, stage);
        const p = projectWorld([world[0], world[1], world[2] - dist], view, aspect);
        if (!p) return null;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        depth += p.depth / 8;
      }
    }
  }
  return [
    { x: minX, y: minY, depth },
    { x: maxX, y: minY, depth },
    { x: maxX, y: maxY, depth },
    { x: minX, y: maxY, depth },
  ];
}

/**
 * The drive-3D camera piloting `layerId`'s 3D group, or null (implicit view).
 * Mirrors the compiler: nearest camera above the group; a non-driving camera
 * blocks the search because it flattens the stack below it.
 */
export function drivingCameraIdFor(
  layers: readonly Pick<LayerInstance, "id" | "type" | "is3D" | "enabled" | "values">[],
  layerId: string,
): string | null {
  // UI order is top → bottom; work bottom → top like the compiler.
  const enabled = [...layers].reverse().filter((l) => l.enabled);
  const runs = find3DRuns(enabled);
  const run = runs.find((r) => r.layerIds.includes(layerId));
  if (!run) return null;
  for (let i = run.end; i < enabled.length; i++) {
    const layer = enabled[i]!;
    if (layer.type !== "camera") continue;
    return layer.values.drive3d === true ? layer.id : null;
  }
  return null;
}