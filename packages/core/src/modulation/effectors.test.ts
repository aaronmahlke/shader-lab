import { describe, expect, it } from "bun:test";
import type { PropertyTrack } from "../types/animation";
import type { LayerInstance } from "../types/editor";
import { ModulationEngine } from "./engine";
import { effectorFalloff } from "./effectors";
import { createAnimatedModulationFn } from "../animation/create-modulation-fn";
import { compilePasses } from "../compiler/compile-passes";
import { find3DRuns } from "../compiler/threed";
import { buildLayerValues } from "../compiler/build-layer-values";

const solid = (id: string, values: Record<string, unknown> = {}, is3D = true): LayerInstance => ({
  id,
  type: "solid",
  enabled: true,
  is3D,
  values: { ...buildLayerValues("solid"), ...values },
});

const effector = (id: string, values: Record<string, unknown> = {}, extra: Partial<LayerInstance> = {}): LayerInstance => ({
  id,
  type: "effector",
  enabled: true,
  values: {
    ...buildLayerValues("effector"),
    radius: 0.4,
    innerRadius: 0.1,
    falloff: 0,
    offsetZ: 0.2,
    ...values,
  },
  ...extra,
});

/** Square comp (aspect 1) so X distances read directly. */
function modFn(layers: LayerInstance[], time = 0, tracks: PropertyTrack[] = []) {
  const engine = new ModulationEngine();
  engine.setConfig({
    layers,
    lfos: [],
    assignments: [],
    tracks,
    settings: { duration: 5, fps: 60, width: 1000, height: 1000 },
  });
  engine.sampleAt(time);
  const fn = createAnimatedModulationFn(time, tracks, engine);
  return (layerId: string, param: string, base: number) => fn(layerId, param, base);
}

describe("effectorFalloff", () => {
  it("is full inside, zero outside, linear or smooth between", () => {
    expect(effectorFalloff(0.05, 0.4, 0.1, false)).toBe(1);
    expect(effectorFalloff(0.5, 0.4, 0.1, false)).toBe(0);
    expect(effectorFalloff(0.25, 0.4, 0.1, false)).toBeCloseTo(0.5, 9);
    expect(effectorFalloff(0.25, 0.4, 0.1, true)).toBeCloseTo(0.5, 9);
    expect(effectorFalloff(0.175, 0.4, 0.1, true)).toBeCloseTo(0.84375, 9); // t = .75 → smoothstep
  });
});

describe("effectors", () => {
  it("pushes layers inside the radius and leaves far ones alone", () => {
    const near = solid("near", { layerPositionX: 0.05 });
    const far = solid("far", { layerPositionX: 0.9 });
    const fn = modFn([near, far, effector("e")]);
    expect(fn("near", "layerPositionZ", 0)).toBeCloseTo(0.2, 9);
    expect(fn("far", "layerPositionZ", 0)).toBe(0);
  });

  it("fades with distance between the two radii", () => {
    const mid = solid("mid", { layerPositionX: 0.25 });
    const fn = modFn([mid, effector("e")]);
    expect(fn("mid", "layerPositionZ", 0)).toBeCloseTo(0.1, 9);
  });

  it("rotates, scales and fades", () => {
    const l = solid("l");
    const fn = modFn([l, effector("e", { offsetZ: 0, rotateX: 90, rotateZ: 45, scale: 50, opacity: 20 })]);
    expect(fn("l", "layerRotationX", 10)).toBeCloseTo(100, 9);
    expect(fn("l", "layerRotation", 0)).toBeCloseTo(45, 9);
    expect(fn("l", "layerScale", 100)).toBeCloseTo(50, 9);
    expect(fn("l", "layerOpacity", 100)).toBeCloseTo(20, 9);
  });

  it("stacks several effectors", () => {
    const l = solid("l");
    const fn = modFn([l, effector("a", { offsetZ: 0.2 }), effector("b", { offsetZ: 0.1, scale: 200 })]);
    expect(fn("l", "layerPositionZ", 0)).toBeCloseTo(0.3, 9);
    expect(fn("l", "layerScale", 100)).toBeCloseTo(200, 9);
  });

  it("follows an animated effector (keyframed position)", () => {
    const left = solid("left", { layerPositionX: -0.5 });
    const right = solid("right", { layerPositionX: 0.5 });
    const tracks: PropertyTrack[] = [
      { layerId: "e", paramName: "layerPositionX", enabled: true, keys: [{ time: 0, value: -0.5 }, { time: 1, value: 0.5 }] },
    ];
    const layers = [left, right, effector("e")];
    expect(modFn(layers, 0, tracks)("left", "layerPositionZ", 0)).toBeCloseTo(0.2, 9);
    expect(modFn(layers, 0, tracks)("right", "layerPositionZ", 0)).toBe(0);
    expect(modFn(layers, 1, tracks)("left", "layerPositionZ", 0)).toBe(0);
    expect(modFn(layers, 1, tracks)("right", "layerPositionZ", 0)).toBeCloseTo(0.2, 9);
  });

  it("measures from the layer's animated position (keyframes then effector)", () => {
    const l = solid("l");
    const tracks: PropertyTrack[] = [
      { layerId: "l", paramName: "layerPositionX", enabled: true, keys: [{ time: 0, value: 0.9 }] },
    ];
    expect(modFn([l, effector("e")], 0, tracks)("l", "layerPositionZ", 0)).toBe(0);
  });

  it("respects strength, enabled and the in/out window", () => {
    const l = solid("l");
    expect(modFn([l, effector("e", { strength: 50 })])("l", "layerPositionZ", 0)).toBeCloseTo(0.1, 9);
    expect(modFn([l, effector("e", {}, { enabled: false })])("l", "layerPositionZ", 0)).toBe(0);
    const timed = effector("e", {}, { timing: { in: 1, out: 2 } });
    expect(modFn([l, timed], 0.5)("l", "layerPositionZ", 0)).toBe(0);
    expect(modFn([l, timed], 1.5)("l", "layerPositionZ", 0)).toBeCloseTo(0.2, 9);
  });

  it("never moves itself or cameras, and leaves other params alone", () => {
    const e = effector("e");
    const fn = modFn([solid("l"), e]);
    expect(fn("e", "layerPositionZ", 0)).toBe(0);
    expect(fn("l", "speed", 3)).toBe(3);
  });

  it("uses the comp aspect for X distance", () => {
    const l = solid("l", { layerPositionX: 0.2 });
    const engine = new ModulationEngine();
    const layers = [l, effector("e", { radius: 0.3, innerRadius: 0.3 })];
    engine.setConfig({ layers, lfos: [], assignments: [], tracks: [], settings: { duration: 5, fps: 60, width: 2000, height: 1000 } });
    engine.sampleAt(0);
    // 0.2 of the width = 0.4 frame heights at 2:1 → outside a 0.3 radius.
    expect(createAnimatedModulationFn(0, [], engine)("l", "layerPositionZ", 0)).toBe(0);
  });
});

describe("effector layers in the pass graph", () => {
  it("render nothing and don't split a 3D group", () => {
    const layers = [solid("a"), effector("e"), solid("b")];
    const passes = compilePasses(layers, null);
    expect(passes.some((p) => p.layerId === "e" || p.sourceLayerId === "e")).toBe(false);
    const runs = find3DRuns(layers);
    expect(runs.length).toBe(1);
    expect(runs[0]!.layerIds).toEqual(["a", "b"]);
  });
});
