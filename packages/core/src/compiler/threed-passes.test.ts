import { describe, expect, it } from "bun:test";
import { compilePasses, threeDSlotPassId } from "./compile-passes";
import { assignThreeDSlots, orderThreeDMembers } from "../renderer/threed-order";
import type { LayerInstance, RenderPass } from "../types/editor";

function layer(
  id: string,
  type: LayerInstance["type"],
  overrides: Partial<LayerInstance> = {},
): LayerInstance {
  return { id, type, enabled: true, values: {}, ...overrides };
}

describe("compilePasses 3D groups", () => {
  it("emits content passes then a slot chain for a contiguous 3D run", () => {
    // UI order top → bottom: b over a. Compiler walks bottom → top.
    const layers = [
      layer("b", "gradient", { is3D: true }),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    const ids = passes.map((p) => p.layerId);

    // Content passes (bottom-first) then slots then final blit.
    expect(ids).toEqual([
      "a",
      "b",
      threeDSlotPassId("a", 0),
      threeDSlotPassId("a", 1),
      "blit-out",
    ]);

    const slot0 = passes[2]!;
    const slot1 = passes[3]!;
    expect(slot0.layerType).toBe("layerComposite3d");
    expect(slot0.inputLayerId).toBe(null); // bottom of the stack
    expect(slot0.colorSourceLayerId).toBe("a");
    expect(slot0.threeDGroup).toEqual({ key: "a", memberIds: ["a", "b"], slot: 0, lightIds: [] });
    expect(slot1.inputLayerId).toBe(threeDSlotPassId("a", 0));
    expect(slot1.threeDGroup?.slot).toBe(1);

    // Content passes have no input (pure content, like 2D generators).
    expect(passes[0]!.inputLayerId).toBe(null);
    expect(passes[1]!.inputLayerId).toBe(null);
  });

  it("2D walls split 3D runs into separate groups", () => {
    // top → bottom: c(3D), wall(2D), b(3D), a(3D)
    const layers = [
      layer("c", "noise", { is3D: true }),
      layer("wall", "solid"),
      layer("b", "gradient", { is3D: true }),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    const slotPasses = passes.filter((p) => p.layerType === "layerComposite3d");
    expect(slotPasses.length).toBe(3);

    const groupKeys = new Set(slotPasses.map((p) => p.threeDGroup!.key));
    expect(groupKeys.size).toBe(2); // two separate groups

    // The wall composites between the groups, on top of group one's last slot.
    const wallComposite = passes.find((p) => p.layerId === "composite-wall")!;
    expect(wallComposite.inputLayerId).toBe(threeDSlotPassId("a", 1));
  });

  it("a lone 3D layer renders through the 3D path", () => {
    const passes = compilePasses([layer("a", "solid", { is3D: true })], null);
    expect(passes.some((p) => p.layerType === "layerComposite3d")).toBe(true);
    expect(passes.some((p) => p.layerType === "layerComposite")).toBe(false);
  });

  it("a 3D group below an effect feeds the effect chain", () => {
    // top → bottom: vignette(effect), b(3D), a(3D)
    const layers = [
      layer("v", "vignette"),
      layer("b", "gradient", { is3D: true }),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    const vignette = passes.find((p) => p.layerId === "v")!;
    expect(vignette.inputLayerId).toBe(threeDSlotPassId("a", 1));
  });
});

describe("orderThreeDMembers", () => {
  const layersById = new Map<string, LayerInstance>([
    ["a", layer("a", "solid", { values: { layerPositionZ: 0.5 } })],
    ["b", layer("b", "solid", { values: { layerPositionZ: -0.5 } })],
    ["c", layer("c", "solid", { values: {} })], // z = 0
  ]);
  const getLayer = (id: string) => layersById.get(id);

  it("sorts farthest (lowest z) first", () => {
    expect(orderThreeDMembers(["a", "b", "c"], getLayer, null)).toEqual(["b", "c", "a"]);
  });

  it("keeps stack order on ties", () => {
    expect(orderThreeDMembers(["c", "b", "a"], (id) => ({ values: {} }), null)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("keyframed/LFO z flows through the modulation fn", () => {
    const modFn = (layerId: string, param: string, base: number) =>
      param === "layerPositionZ" && layerId === "b" ? 2 : base;
    // b jumps to the front (highest z) via modulation.
    expect(orderThreeDMembers(["a", "b", "c"], getLayer, modFn)).toEqual(["c", "a", "b"]);
  });
});

describe("assignThreeDSlots", () => {
  it("re-points slots at depth-sorted members without touching topology", () => {
    const layers = [
      layer("front", "gradient", { is3D: true, values: { layerPositionZ: -0.4 } }),
      layer("back", "solid", { is3D: true, values: { layerPositionZ: 0.4 } }),
    ];
    // Stack: front over back — but back has HIGHER z, so it must draw last.
    const passes = compilePasses(layers, null);
    const findLayer = (pass: RenderPass) =>
      layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId));

    const assigned = assignThreeDSlots(passes, findLayer, null);
    const slots = assigned.filter((p) => p.layerType === "layerComposite3d");

    expect(slots[0]!.colorSourceLayerId).toBe("front"); // z=-0.4 → farthest, draws first
    expect(slots[1]!.colorSourceLayerId).toBe("back"); // z=+0.4 → nearest, draws last
    // Topology untouched: ids and inputs are the stable slot chain.
    expect(slots[0]!.layerId).toBe(threeDSlotPassId("back", 0));
    expect(slots[1]!.inputLayerId).toBe(threeDSlotPassId("back", 0));
  });

  it("returns the exact array when no 3D groups exist", () => {
    const passes = compilePasses([layer("a", "solid")], null);
    expect(assignThreeDSlots(passes, undefined, null)).toBe(passes);
  });
});