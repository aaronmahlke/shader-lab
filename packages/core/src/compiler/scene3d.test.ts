import { describe, expect, it } from "bun:test";
import { compilePasses } from "./compile-passes";
import { orderThreeDMembers, resolveSceneView, IDENTITY_VIEW } from "../renderer/threed-order";
import { isLayer3D, supports3D, universalUniformsFor } from "./universal-uniforms";
import LAYER_TEMPLATES from "./layer-templates";
import type { LayerInstance } from "../types/editor";

function layer(
  id: string,
  type: LayerInstance["type"],
  overrides: Partial<LayerInstance> = {},
): LayerInstance {
  return { id, type, enabled: true, values: {}, ...overrides };
}

describe("scene3d layer types", () => {
  it("object3d and light templates exist as generators", () => {
    expect(LAYER_TEMPLATES.object3d?.category).toBe("generator");
    expect(LAYER_TEMPLATES.light?.category).toBe("generator");
  });

  it("object3d and light are always 3D and hide the switch", () => {
    expect(isLayer3D({ type: "object3d" })).toBe(true);
    expect(isLayer3D({ type: "light" })).toBe(true);
    expect(supports3D({ type: "object3d" })).toBe(false);
    expect(supports3D({ type: "light" })).toBe(false);
  });

  it("object3d gets the 3D transform set in the inspector", () => {
    const names = universalUniformsFor({ type: "object3d" }).map((d) => d.name);
    expect(names).toContain("layerPositionZ");
    expect(names).toContain("layerRotationX");
  });

  it("the camera template has the drive3d switch", () => {
    const def = LAYER_TEMPLATES.camera!.uniforms.find((u) => u.name === "drive3d");
    expect(def?.type).toBe("bool");
    expect(def?.default).toBe(false);
  });
});

describe("compilePasses scene3d", () => {
  it("lights join the group without emitting passes", () => {
    // top → bottom: light, quad b, quad a — all one group
    const layers = [
      layer("sun", "light"),
      layer("b", "gradient", { is3D: true }),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    expect(passes.some((p) => p.layerId === "sun")).toBe(false);

    const slots = passes.filter((p) => p.layerType === "layerComposite3d");
    expect(slots.length).toBe(2); // only visual members get slots
    expect(slots[0]!.threeDGroup?.lightIds).toEqual(["sun"]);
    expect(slots[0]!.threeDGroup?.memberIds).toEqual(["a", "b"]);
  });

  it("a light does not break a 3D run", () => {
    const layers = [
      layer("b", "solid", { is3D: true }),
      layer("sun", "light"),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    const keys = new Set(
      passes.filter((p) => p.threeDGroup).map((p) => p.threeDGroup!.key),
    );
    expect(keys.size).toBe(1);
  });

  it("object3d members skip the content pass and ray-trace in their slot", () => {
    const layers = [layer("cube", "object3d")];
    const passes = compilePasses(layers, null);
    // No content pass with the object's layer id — only the slot + blit.
    expect(passes.some((p) => p.layerId === "cube")).toBe(false);
    const slot = passes.find((p) => p.layerType === "layerComposite3d")!;
    expect(slot.sourceLayerId).toBe("cube");
    expect(slot.colorSourceLayerId).toBe(null);
  });

  it("a run of only lights emits nothing", () => {
    const passes = compilePasses([layer("sun", "light")], null);
    expect(passes.length).toBe(0);
  });

  it("the nearest drive-3D camera above pilots the group", () => {
    const layers = [
      layer("cam", "camera", { values: { drive3d: true } }),
      layer("b", "solid", { is3D: true }),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    const slot = passes.find((p) => p.layerType === "layerComposite3d")!;
    expect(slot.cameraSourceLayerId).toBe("cam");
  });

  it("a non-driving camera blocks the search (it flattens the stack)", () => {
    const layers = [
      layer("cam2", "camera", { values: { drive3d: true } }),
      layer("cam1", "camera", { values: { drive3d: false } }),
      layer("a", "solid", { is3D: true }),
    ];
    const passes = compilePasses(layers, null);
    const slot = passes.find((p) => p.layerType === "layerComposite3d")!;
    expect(slot.cameraSourceLayerId).toBe(null);
  });
});

describe("camera-aware ordering", () => {
  const layers = new Map<string, LayerInstance>([
    ["left", layer("left", "solid", { values: { layerPositionX: -0.3 } })],
    ["right", layer("right", "solid", { values: { layerPositionX: 0.3 } })],
  ]);
  const getLayer = (id: string) => layers.get(id);

  it("identity view keeps stack order for coplanar members", () => {
    expect(orderThreeDMembers(["left", "right"], getLayer, null)).toEqual(["left", "right"]);
  });

  it("yawing the camera changes which member is nearer", () => {
    // Positive yaw rotates the stack plane: +X side swings away (z' = -sin(yaw)·x).
    const view = { ...IDENTITY_VIEW, yaw: 30 };
    expect(orderThreeDMembers(["left", "right"], getLayer, null, view, 1)).toEqual([
      "right",
      "left",
    ]);
    const viewNeg = { ...IDENTITY_VIEW, yaw: -30 };
    expect(orderThreeDMembers(["left", "right"], getLayer, null, viewNeg, 1)).toEqual([
      "left",
      "right",
    ]);
  });

  it("resolveSceneView falls back to identity without a camera", () => {
    expect(resolveSceneView(null, getLayer, null)).toEqual(IDENTITY_VIEW);
    expect(resolveSceneView("missing", getLayer, null)).toEqual(IDENTITY_VIEW);
  });

  it("resolveSceneView reads live camera params through the modulation fn", () => {
    const cam = layer("cam", "camera", { values: { tilt: 10, zoom: 1.5, fov: 30 } });
    const all = (id: string) => (id === "cam" ? cam : undefined);
    const modFn = (layerId: string, param: string, base: number) =>
      param === "yaw" ? 42 : base;
    const view = resolveSceneView("cam", all, modFn);
    expect(view.tilt).toBe(10);
    expect(view.yaw).toBe(42);
    expect(view.zoom).toBe(1.5);
    expect(view.fov).toBe(30);
  });
});