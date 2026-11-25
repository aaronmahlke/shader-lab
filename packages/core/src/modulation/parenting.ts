import type { LayerInstance } from "../types/editor";

/**
 * Parenting (AE pick-whip): a child's transform is relative to its parent's.
 *
 *   world.position = parent.position + R(parent) · (child.position × parent.scale)
 *   world.rotation = parent.rotation + child.rotation   (Euler add)
 *   world.scale    = parent.scale × child.scale
 *
 * R matches the 3D renderer: Rz(−rotZ) · Rx(rotX) · Ry(rotY). Positions are
 * converted to frame-height units (x × aspect) so rotation is undistorted.
 * Opacity is not inherited (same as AE). Chains resolve recursively; cycles
 * and missing parents fall back to the layer's own transform.
 */

export const PARENT_PARAMS = new Set([
  "layerPositionX",
  "layerPositionY",
  "layerPositionZ",
  "layerRotationX",
  "layerRotationY",
  "layerRotation",
  "layerScale",
]);

/** Position in frame-height units (x already × aspect), rotations in degrees, scale in %. */
export type WorldTransform = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
};

type Vec3 = [number, number, number];
const DEG = Math.PI / 180;

function rotate(v: Vec3, rx: number, ry: number, rz: number): Vec3 {
  // Ry
  const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
  let x = v[0] * cy + v[2] * sy;
  let y = v[1];
  let z = -v[0] * sy + v[2] * cy;
  // Rx
  const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
  const y2 = y * cx - z * sx;
  const z2 = y * sx + z * cx;
  y = y2;
  z = z2;
  // Rz(−rz)
  const cz = Math.cos(-rz * DEG), sz = Math.sin(-rz * DEG);
  const x3 = x * cz - y * sz;
  const y3 = x * sz + y * cz;
  return [x3, y3, z];
}

/** Inverse of `rotate` (transpose: undo Rz, then Rx, then Ry). */
function unrotate(v: Vec3, rx: number, ry: number, rz: number): Vec3 {
  const cz = Math.cos(rz * DEG), sz = Math.sin(rz * DEG);
  let x = v[0] * cz - v[1] * sz;
  let y = v[0] * sz + v[1] * cz;
  let z = v[2];
  const cx = Math.cos(-rx * DEG), sx = Math.sin(-rx * DEG);
  const y2 = y * cx - z * sx;
  const z2 = y * sx + z * cx;
  y = y2;
  z = z2;
  const cy = Math.cos(-ry * DEG), sy = Math.sin(-ry * DEG);
  const x3 = x * cy + z * sy;
  const z3 = -x * sy + z * cy;
  return [x3, y, z3];
}

export function composeTransforms(parent: WorldTransform, local: WorldTransform): WorldTransform {
  const s = parent.scale / 100;
  const offset = rotate([local.x * s, local.y * s, local.z * s], parent.rx, parent.ry, parent.rz);
  return {
    x: parent.x + offset[0],
    y: parent.y + offset[1],
    z: parent.z + offset[2],
    rx: parent.rx + local.rx,
    ry: parent.ry + local.ry,
    rz: parent.rz + local.rz,
    scale: parent.scale * (local.scale / 100),
  };
}

/** The local transform that, under `parent`, lands exactly on `world` (used when parenting keeps a layer in place). */
export function localFromWorld(parent: WorldTransform, world: WorldTransform): WorldTransform {
  const s = Math.max(parent.scale / 100, 1e-6);
  const d = unrotate([world.x - parent.x, world.y - parent.y, world.z - parent.z], parent.rx, parent.ry, parent.rz);
  return {
    x: d[0] / s,
    y: d[1] / s,
    z: d[2] / s,
    rx: world.rx - parent.rx,
    ry: world.ry - parent.ry,
    rz: world.rz - parent.rz,
    scale: (world.scale / Math.max(parent.scale, 1e-6)) * 100,
  };
}

/** Reads a layer's own (local) transform param. */
export type LocalReader = (layer: LayerInstance, paramName: string) => number;

export function localTransform(layer: LayerInstance, read: LocalReader, aspect: number): WorldTransform {
  return {
    x: read(layer, "layerPositionX") * aspect,
    y: read(layer, "layerPositionY"),
    z: read(layer, "layerPositionZ"),
    rx: read(layer, "layerRotationX"),
    ry: read(layer, "layerRotationY"),
    rz: read(layer, "layerRotation"),
    scale: read(layer, "layerScale"),
  };
}

/** World transform of a layer through its parent chain (cached per frame by the caller). */
/** Local offset (frame-height units) of a named attach point on `parent`, or null. */
export type PointOffset = (parent: LayerInstance, point: string) => { x: number; y: number } | null;

export function resolveWorldTransform(
  layer: LayerInstance,
  getLayer: (id: string) => LayerInstance | undefined,
  read: LocalReader,
  aspect: number,
  cache: Map<string, WorldTransform>,
  pointOffset?: PointOffset,
  visiting: Set<string> = new Set(),
): WorldTransform {
  const hit = cache.get(layer.id);
  if (hit) return hit;
  const local = localTransform(layer, read, aspect);
  const parent = layer.parent && layer.parent !== layer.id ? getLayer(layer.parent) : undefined;
  let world = local;
  if (parent && !visiting.has(layer.id)) {
    visiting.add(layer.id);
    if (!visiting.has(parent.id)) {
      let pivot = resolveWorldTransform(parent, getLayer, read, aspect, cache, pointOffset, visiting);
      // Attached to a point on the parent (e.g. text end): pivot there instead of the anchor.
      const offset = layer.parentPoint && pointOffset ? pointOffset(parent, layer.parentPoint) : null;
      if (offset) {
        pivot = composeTransforms(pivot, { x: offset.x, y: offset.y, z: 0, rx: 0, ry: 0, rz: 0, scale: 100 });
      }
      world = composeTransforms(pivot, local);
    }
    visiting.delete(layer.id);
  }
  cache.set(layer.id, world);
  return world;
}

/** One transform param out of a world transform (x back to width fractions). */
export function worldParam(world: WorldTransform, paramName: string, aspect: number): number {
  switch (paramName) {
    case "layerPositionX":
      return world.x / aspect;
    case "layerPositionY":
      return world.y;
    case "layerPositionZ":
      return world.z;
    case "layerRotationX":
      return world.rx;
    case "layerRotationY":
      return world.ry;
    case "layerRotation":
      return world.rz;
    case "layerScale":
      return world.scale;
    default:
      return 0;
  }
}

/** True when `parentId` can be this layer's parent (exists, not itself, no cycle). */
export function canParent(layers: readonly LayerInstance[], childId: string, parentId: string): boolean {
  if (childId === parentId) return false;
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cur = byId.get(parentId);
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === childId) return false;
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return byId.has(parentId);
}
