import { describe, expect, it } from "bun:test";
import type { PropertyTrack } from "../types/animation";
import type { LayerInstance } from "../types/editor";
import { ModulationEngine } from "./engine";
import { cloneContentPassId, cloneId, expandCloners, resolveLayerById } from "./cloners";
import { createAnimatedModulationFn } from "../animation/create-modulation-fn";
import { compilePasses } from "../compiler/compile-passes";
import { assignThreeDSlots } from "../renderer/threed-order";
import { buildLayerValues } from "../compiler/build-layer-values";

const shape = (id: string, values: Record<string, unknown> = {}): LayerInstance => ({
  id,
  type: "shape",
  enabled: true,
  values: { ...buildLayerValues("shape"), ...values },
});

const cloner = (id: string, values: Record<string, unknown> = {}, extra: Partial<LayerInstance> = {}): LayerInstance => ({
  id,
  type: "cloner",
  enabled: true,
  values: { ...buildLayerValues("cloner"), sources: ["src"], countX: 3, countY: 2, spacingX: 0.2, spacingY: 0.1, ...values },
  ...extra,
});

/** Square comp so X offsets read directly in frame-height units. */
function setup(layers: LayerInstance[], time = 0, tracks: PropertyTrack[] = []) {
  const engine = new ModulationEngine();
  engine.setConfig({ layers, lfos: [], assignments: [], tracks, settings: { duration: 5, fps: 60, width: 1000, height: 1000 } });
  engine.sampleAt(time);
  return createAnimatedModulationFn(time, tracks, engine);
}

describe("expandCloners", () => {
  it("replaces the cloner with copies in its stack slot and hides the source", () => {
    const layers = [shape("top"), cloner("c"), shape("src"), shape("bottom")];
    const { renderLayers } = expandCloners(layers);
    expect(renderLayers.map((l) => l.id)).toEqual([
      "top",
      ...Array.from({ length: 6 }, (_, i) => cloneId("c", i)),
      "bottom",
    ]);
    const copy = renderLayers[1]!;
    expect(copy.type).toBe("shape");
    expect(copy.is3D).toBe(true);
    expect(copy.values).toBe(layers[2]!.values); // shared, so edits are live
  });

  it("cycles several sources in order, or randomly with a seed", () => {
    const layers = [cloner("c", { sources: ["a", "b"], countX: 4, countY: 1 }), shape("a"), shape("b")];
    expect(expandCloners(layers).renderLayers.map((l) => l.clone!.sourceId)).toEqual(["a", "b", "a", "b"]);
    const random = [cloner("c", { sources: ["a", "b"], countX: 40, countY: 1, order: 1, seed: 3 }), shape("a"), shape("b")];
    const picks = expandCloners(random).renderLayers.map((l) => l.clone!.sourceId);
    expect(new Set(picks)).toEqual(new Set(["a", "b"]));
    expect(expandCloners([...random]).renderLayers.map((l) => l.clone!.sourceId)).toEqual(picks); // deterministic
  });

  it("ignores missing sources and renders nothing without any", () => {
    expect(expandCloners([cloner("c", { sources: ["nope"] })]).renderLayers).toEqual([]);
  });

  it("re-expands when the layout changes on the same array", () => {
    const layers = [cloner("c"), shape("src")];
    expect(expandCloners(layers).renderLayers.length).toBe(6);
    layers[0]!.values.countX = 5;
    expect(expandCloners(layers).renderLayers.length).toBe(10);
  });

  it("resolves copies by id", () => {
    const layers = [cloner("c"), shape("src")];
    expect(resolveLayerById(layers, cloneId("c", 4))?.clone?.index).toBe(4);
    expect(resolveLayerById(layers, "src")?.id).toBe("src");
  });
});

describe("copy transforms", () => {
  it("lay out on a centered grid around the cloner", () => {
    const fn = setup([cloner("c", { layerPositionX: 0.1 }), shape("src")]);
    // 3×2 grid: x cells −1,0,1 × 0.2 ; y rows +0.5,−0.5 × 0.1 (top row first)
    expect(fn(cloneId("c", 0), "layerPositionX", 0)).toBeCloseTo(0.1 - 0.2, 9);
    expect(fn(cloneId("c", 2), "layerPositionX", 0)).toBeCloseTo(0.1 + 0.2, 9);
    expect(fn(cloneId("c", 0), "layerPositionY", 0)).toBeCloseTo(0.05, 9);
    expect(fn(cloneId("c", 3), "layerPositionY", 0)).toBeCloseTo(-0.05, 9);
  });

  it("follow the cloner's keyframes and animated spacing", () => {
    const tracks: PropertyTrack[] = [
      { layerId: "c", paramName: "spacingX", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 0.4 }] },
      { layerId: "c", paramName: "layerPositionZ", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 0.3 }] },
    ];
    const layers = [cloner("c"), shape("src")];
    expect(setup(layers, 0, tracks)(cloneId("c", 2), "layerPositionX", 0)).toBeCloseTo(0, 9);
    const fn = setup(layers, 1, tracks);
    expect(fn(cloneId("c", 2), "layerPositionX", 0)).toBeCloseTo(0.4, 9);
    expect(fn(cloneId("c", 2), "layerPositionZ", 0)).toBeCloseTo(0.3, 9);
  });

  it("stagger: copy n plays the cloner's and source's keys rank × stagger later", () => {
    const tracks: PropertyTrack[] = [
      { layerId: "c", paramName: "layerRotationY", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 180 }] },
      { layerId: "src", paramName: "layerOpacity", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 100 }] },
    ];
    const layers = [cloner("c", { countX: 4, countY: 1, stagger: 0.25 }), shape("src")];
    const fn = setup(layers, 0.5, tracks);
    // linear keys: copy 0 at t=0.5 → 90°, copy 1 at 0.25 → 45°, copy 2 at 0 → 0°
    expect(fn(cloneId("c", 0), "layerRotationY", 0)).toBeCloseTo(90, 6);
    expect(fn(cloneId("c", 1), "layerRotationY", 0)).toBeCloseTo(45, 6);
    expect(fn(cloneId("c", 2), "layerRotationY", 0)).toBeCloseTo(0, 6);
    // Opacity is a clone transform param (from the cloner), so source opacity keys don't apply;
    // a source content param would follow the same delayed time.
    const reverse = [cloner("c", { countX: 4, countY: 1, stagger: 0.25, staggerOrder: 1 }), shape("src")];
    expect(setup(reverse, 0.75, tracks)(cloneId("c", 3), "layerRotationY", 0)).toBeCloseTo(135, 6);
    expect(setup(reverse, 0.75, tracks)(cloneId("c", 0), "layerRotationY", 0)).toBeCloseTo(0, 6);
    // From center (3 wide): middle first, edges one step later
    const center = [cloner("c", { countX: 3, countY: 1, stagger: 0.5, staggerOrder: 2 }), shape("src")];
    const fc = setup(center, 0.5, tracks);
    expect(fc(cloneId("c", 1), "layerRotationY", 0)).toBeCloseTo(90, 6);
    expect(fc(cloneId("c", 0), "layerRotationY", 0)).toBeCloseTo(0, 6);
    expect(fc(cloneId("c", 2), "layerRotationY", 0)).toBeCloseTo(0, 6);
  });

  it("use the comp aspect so grid spacing is square on screen", () => {
    const engine = new ModulationEngine();
    const layers = [cloner("c"), shape("src")];
    engine.setConfig({ layers, lfos: [], assignments: [], tracks: [], settings: { duration: 5, fps: 60, width: 2000, height: 1000 } });
    engine.sampleAt(0);
    expect(createAnimatedModulationFn(0, [], engine)(cloneId("c", 2), "layerPositionX", 0)).toBeCloseTo(0.1, 9);
  });

  it("lay out on a ring (floor plane)", () => {
    const fn = setup([cloner("c", { layout: 1, radialCount: 4, radialRadius: 0.5, radialPlane: 1 }), shape("src")]);
    expect(fn(cloneId("c", 0), "layerPositionX", 0)).toBeCloseTo(0.5, 9);
    expect(fn(cloneId("c", 1), "layerPositionZ", 0)).toBeCloseTo(0.5, 9);
    expect(fn(cloneId("c", 1), "layerPositionY", 0)).toBeCloseTo(0, 9);
  });

  it("add copy rotation and take scale/opacity from the cloner", () => {
    const fn = setup([cloner("c", { cloneRotateX: 90, layerScale: 50, layerOpacity: 40 }), shape("src", { layerScale: 300 })]);
    expect(fn(cloneId("c", 0), "layerRotationX", 0)).toBeCloseTo(90, 9);
    expect(fn(cloneId("c", 0), "layerScale", 300)).toBeCloseTo(50, 9);
    expect(fn(cloneId("c", 0), "layerOpacity", 100)).toBeCloseTo(40, 9);
  });

  it("take content params (and their keyframes) from the source", () => {
    const tracks: PropertyTrack[] = [
      { layerId: "src", paramName: "shapeWidth", enabled: true, keys: [{ time: 0, value: 0.1 }, { time: 1, value: 0.3 }] },
    ];
    const fn = setup([cloner("c"), shape("src")], 0.5, tracks);
    expect(fn(cloneId("c", 1), "shapeWidth", 0.5)).toBeCloseTo(0.2, 9);
  });

  it("get pushed by effectors one by one", () => {
    const effector: LayerInstance = {
      id: "e",
      type: "effector",
      enabled: true,
      values: { ...buildLayerValues("effector"), layerPositionX: 0.2, radius: 0.05, innerRadius: 0.04, offsetZ: 0.3 },
    };
    const fn = setup([effector, cloner("c", { countY: 1 }), shape("src")]);
    expect(fn(cloneId("c", 0), "layerPositionZ", 0)).toBeCloseTo(0, 9);
    expect(fn(cloneId("c", 2), "layerPositionZ", 0)).toBeCloseTo(0.3, 9);
  });
});

describe("cloner pass graph", () => {
  it("renders each source once and composites every copy from it", () => {
    const layers = [cloner("c", { sources: ["a", "b"], countX: 4, countY: 1 }), shape("a"), shape("b")];
    const passes = compilePasses(layers, null);
    const contentA = cloneContentPassId("c", "a");
    const contentB = cloneContentPassId("c", "b");
    expect(passes.filter((p) => p.layerId === contentA).length).toBe(1);
    expect(passes.filter((p) => p.layerId === contentB).length).toBe(1);
    const slots = passes.filter((p) => p.layerType === "layerComposite3d");
    expect(slots.length).toBe(4);
    // Slots run bottom → top of the stack (copy 3 first).
    expect(slots.map((p) => p.colorSourceLayerId)).toEqual([contentB, contentA, contentB, contentA]);
    // Neither source renders on its own.
    expect(passes.some((p) => p.layerId === "a" || p.layerId === "b")).toBe(false);
  });

  it("keeps copies on their shared content after depth sorting", () => {
    const layers = [cloner("c", { sources: ["a", "b"], countX: 2, countY: 1, countZ: 2, spacingZ: 0.5 }), shape("a"), shape("b")];
    const fn = setup(layers);
    const passes = assignThreeDSlots(
      compilePasses(layers, fn),
      (pass) => resolveLayerById(layers, pass.sourceLayerId ?? pass.layerId),
      fn,
      1,
    );
    for (const slot of passes.filter((p) => p.layerType === "layerComposite3d")) {
      const member = resolveLayerById(layers, slot.sourceLayerId!)!;
      expect(slot.colorSourceLayerId).toBe(cloneContentPassId("c", member.clone!.sourceId));
    }
  });
});
