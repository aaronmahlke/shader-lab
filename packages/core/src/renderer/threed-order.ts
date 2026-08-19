import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";

/**
 * Vertical FOV of the implicit scene camera used by 3D layer groups.
 * A camera layer will drive this per group once cameras learn to
 * pilot 3D groups (scene3d follow-up).
 */
export const SCENE_FOV_DEG = 45;

/**
 * Painter's order for a 3D group: farthest member first (ascending Z — layers
 * sit at negative Z, positive layerPositionZ moves toward the camera). Ties
 * keep stack order (bottom first), so coplanar layers behave exactly like the
 * 2D stack. Evaluated per frame: keyframes/LFOs flow through `modFn`.
 */
export function orderThreeDMembers(
  memberIds: readonly string[],
  getLayer: (id: string) => Pick<LayerInstance, "values"> | undefined,
  modFn: ModulationFn | null | undefined,
): string[] {
  return memberIds
    .map((id, index) => {
      const raw = getLayer(id)?.values?.layerPositionZ;
      const base = typeof raw === "number" ? raw : 0;
      const z = modFn ? modFn(id, "layerPositionZ", base) : base;
      return { id, index, z };
    })
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
): RenderPass[] {
  if (!passes.some((p) => p.threeDGroup)) return passes;

  const orders = new Map<string, string[]>();
  const getLayer = (id: string) =>
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
      order = orderThreeDMembers(group.memberIds, getLayer, modFn);
      orders.set(group.key, order);
    }

    const member = order[group.slot];
    if (!member || member === pass.sourceLayerId) return pass;
    return { ...pass, sourceLayerId: member, colorSourceLayerId: member };
  });
}