import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";

/**
 * Vertical FOV of the implicit scene camera used by 3D layer groups when no
 * camera layer drives them.
 */
export const SCENE_FOV_DEG = 45;

type GetLayer = (id: string) => Pick<LayerInstance, "type" | "values"> | undefined;

function readParam(
  getLayer: GetLayer,
  modFn: ModulationFn | null | undefined,
  id: string,
  name: string,
  fallback: number,
): number {
  const raw = getLayer(id)?.values?.[name];
  const base = typeof raw === "number" ? raw : fallback;
  return modFn ? modFn(id, name, base) : base;
}

/** Camera view driving a 3D group (plate-rotation convention, like camera-stage). */
export type SceneView = {
  tilt: number;
  yaw: number;
  roll: number;
  zoom: number;
  fov: number;
};

export const IDENTITY_VIEW: SceneView = { tilt: 0, yaw: 0, roll: 0, zoom: 1, fov: SCENE_FOV_DEG };

/** Resolve the driving camera's live view params (keyframes/LFO via modFn). */
export function resolveSceneView(
  cameraId: string | null | undefined,
  getLayer: GetLayer,
  modFn: ModulationFn | null | undefined,
): SceneView {
  if (!cameraId || !getLayer(cameraId)) return IDENTITY_VIEW;
  return {
    tilt: readParam(getLayer, modFn, cameraId, "tilt", 0),
    yaw: readParam(getLayer, modFn, cameraId, "yaw", 0),
    roll: readParam(getLayer, modFn, cameraId, "roll", 0),
    zoom: readParam(getLayer, modFn, cameraId, "zoom", 1),
    fov: readParam(getLayer, modFn, cameraId, "fov", SCENE_FOV_DEG),
  };
}

/**
 * Z of a member's anchor in view space (before the -distCam push). Matches the
 * shader: S = ((anchor+posXY)*2-1 aspect-corrected, posZ*2) rotated by the
 * camera's plate rotation (rz * rx * ry).
 */
function viewSpaceZ(
  getLayer: GetLayer,
  modFn: ModulationFn | null | undefined,
  id: string,
  view: SceneView,
  aspect: number,
): number {
  const anchorX = readParam(getLayer, modFn, id, "layerAnchorX", 0.5);
  const anchorY = readParam(getLayer, modFn, id, "layerAnchorY", 0.5);
  const posX = readParam(getLayer, modFn, id, "layerPositionX", 0);
  const posY = readParam(getLayer, modFn, id, "layerPositionY", 0);
  const posZ = readParam(getLayer, modFn, id, "layerPositionZ", 0);

  const sx = ((anchorX + posX) * 2 - 1) * aspect;
  const sy = (anchorY + posY) * 2 - 1;
  const sz = posZ * 2;

  const tx = (view.tilt * Math.PI) / 180;
  const ty = (view.yaw * Math.PI) / 180;
  const cx = Math.cos(tx), sxn = Math.sin(tx);
  const cy = Math.cos(ty), syn = Math.sin(ty);
  // rot = rz * rx * ry (camera-stage order); roll (rz) cannot change Z, skip it.
  // ry row 3: z' = -sin(y)·x + cos(y)·z ; rx row 3: z'' = sin(x)·y + cos(x)·z'
  const zAfterY = -syn * sx + cy * sz;
  const zAfterX = sxn * sy + cx * zAfterY;
  return zAfterX;
}

/**
 * Painter's order for a 3D group: farthest member first (ascending view-space
 * Z — members sit at negative Z, higher Z is closer to the camera). Ties keep
 * stack order (bottom first), so coplanar layers behave exactly like the 2D
 * stack. Evaluated per frame: keyframes/LFOs flow through `modFn`.
 */
export function orderThreeDMembers(
  memberIds: readonly string[],
  getLayer: GetLayer,
  modFn: ModulationFn | null | undefined,
  view: SceneView = IDENTITY_VIEW,
  aspect = 1,
): string[] {
  return memberIds
    .map((id, index) => ({
      id,
      index,
      z: viewSpaceZ(getLayer, modFn, id, view, aspect),
    }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map((m) => m.id);
}

/**
 * Re-point each 3D composite slot at the member it should draw this frame.
 * Slot ids, targets, and topology stay fixed — only `sourceLayerId` (live
 * uniform lookup) and `colorSourceLayerId` (content texture) change, so the
 * pass graph signature and FBO cache survive depth swaps mid-animation.
 */
export function assignThreeDSlots(
  passes: RenderPass[],
  findLayer: ((pass: RenderPass) => LayerInstance | undefined) | undefined,
  modFn: ModulationFn | null | undefined,
  aspect = 1,
): RenderPass[] {
  if (!passes.some((p) => p.threeDGroup)) return passes;

  const orders = new Map<string, string[]>();
  const getLayer: GetLayer = (id) =>
    findLayer?.({
      layerId: id,
      layerType: "layerComposite3d",
      uniforms: {},
      inputLayerId: null,
      sourceLayerId: id,
      isOutput: false,
    });

  return passes.map((pass) => {
    const group = pass.threeDGroup;
    if (!group) return pass;

    let order = orders.get(group.key);
    if (!order) {
      const view = resolveSceneView(pass.cameraSourceLayerId, getLayer, modFn);
      order = orderThreeDMembers(group.memberIds, getLayer, modFn, view, aspect);
      orders.set(group.key, order);
    }

    const member = order[group.slot];
    if (!member || member === pass.sourceLayerId) return pass;
    const isObject = getLayer(member)?.type === "object3d";
    return {
      ...pass,
      sourceLayerId: member,
      colorSourceLayerId: isObject ? null : member,
    };
  });
}