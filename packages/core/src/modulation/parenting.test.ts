import { describe, expect, it } from "bun:test";
import type { PropertyTrack } from "../types/animation";
import type { LayerInstance } from "../types/editor";
import { ModulationEngine } from "./engine";
import { canParent, composeTransforms, localFromWorld, type WorldTransform } from "./parenting";
import { createAnimatedModulationFn } from "../animation/create-modulation-fn";
import { buildLayerValues } from "../compiler/build-layer-values";
import { cloneId } from "./cloners";

const layer = (id: string, values: Record<string, unknown> = {}, extra: Partial<LayerInstance> = {}): LayerInstance => ({
  id,
  type: "shape",
  enabled: true,
  is3D: true,
  values: { ...buildLayerValues("shape"), ...values },
  ...extra,
});

/** Square comp so X reads directly in frame-height units. */
function setup(layers: LayerInstance[], time = 0, tracks: PropertyTrack[] = [], measure?: (t: string, f: string) => number) {
  const engine = new ModulationEngine();
  engine.setConfig({ layers, lfos: [], assignments: [], tracks, settings: { duration: 5, fps: 60, width: 1000, height: 1000 } });
  if (measure) engine.setTextMeasure(measure);
  engine.sampleAt(time);
  return createAnimatedModulationFn(time, tracks, engine);
}

const T = (over: Partial<WorldTransform> = {}): WorldTransform => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 100, ...over });

describe("compose / localFromWorld", () => {
  it("round-trips through any parent transform", () => {
    const parent = T({ x: 0.2, y: -0.1, z: 0.3, rx: 20, ry: -35, rz: 50, scale: 150 });
    const local = T({ x: 0.1, y: 0.05, z: -0.2, rx: 5, ry: 10, rz: -15, scale: 80 });
    const back = localFromWorld(parent, composeTransforms(parent, local));
    for (const k of Object.keys(local) as (keyof WorldTransform)[]) expect(back[k]).toBeCloseTo(local[k], 9);
  });

  it("rotates the child's offset with the parent (Z rotation is clockwise like the renderer)", () => {
    const world = composeTransforms(T({ rz: 90 }), T({ x: 0.1 }));
    expect(world.x).toBeCloseTo(0, 9);
    expect(world.y).toBeCloseTo(-0.1, 9);
  });
});

describe("parenting in the modulation fn", () => {
  it("moves a child with its parent and offsets by its own position", () => {
    const tracks: PropertyTrack[] = [
      { layerId: "p", paramName: "layerPositionX", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 0.4 }] },
    ];
    const layers = [layer("p"), layer("c", { layerPositionX: 0.1 }, { parent: "p" })];
    expect(setup(layers, 1, tracks)("c", "layerPositionX", 0.1)).toBeCloseTo(0.5, 9);
    expect(setup(layers, 0, tracks)("c", "layerPositionX", 0.1)).toBeCloseTo(0.1, 9);
  });

  it("inherits rotation and scale (orbiting around the parent)", () => {
    const layers = [layer("p", { layerRotation: 90, layerScale: 200 }), layer("c", { layerPositionX: 0.1 }, { parent: "p" })];
    const fn = setup(layers);
    expect(fn("c", "layerPositionX", 0.1)).toBeCloseTo(0, 9);
    expect(fn("c", "layerPositionY", 0)).toBeCloseTo(-0.2, 9);
    expect(fn("c", "layerRotation", 0)).toBeCloseTo(90, 9);
    expect(fn("c", "layerScale", 100)).toBeCloseTo(200, 9);
    expect(fn("c", "layerOpacity", 100)).toBe(100); // opacity isn't inherited
  });

  it("chains grandparents and ignores cycles", () => {
    const chain = [layer("a", { layerPositionY: 0.1 }), layer("b", { layerPositionY: 0.1 }, { parent: "a" }), layer("c", { layerPositionY: 0.1 }, { parent: "b" })];
    expect(setup(chain)("c", "layerPositionY", 0.1)).toBeCloseTo(0.3, 9);
    const loop = [layer("a", {}, { parent: "b" }), layer("b", {}, { parent: "a" })];
    expect(Number.isFinite(setup(loop)("a", "layerPositionX", 0))).toBe(true);
    expect(canParent(chain, "a", "c")).toBe(false);
    expect(canParent(chain, "c", "a")).toBe(true);
  });

  it("lets an effector follow a parent (orb drives the effector)", () => {
    const tracks: PropertyTrack[] = [
      { layerId: "orb", paramName: "layerPositionX", enabled: true, keys: [{ time: 0, value: -0.5 }, { time: 1, value: 0.5 }] },
    ];
    const effector: LayerInstance = {
      id: "e",
      type: "effector",
      enabled: true,
      parent: "orb",
      values: { ...buildLayerValues("effector"), radius: 0.1, innerRadius: 0.1, offsetZ: 0.3 },
    };
    const layers = [layer("orb"), effector, layer("left", { layerPositionX: -0.5 }), layer("right", { layerPositionX: 0.5 })];
    expect(setup(layers, 0, tracks)("left", "layerPositionZ", 0)).toBeCloseTo(0.3, 9);
    expect(setup(layers, 1, tracks)("right", "layerPositionZ", 0)).toBeCloseTo(0.3, 9);
    expect(setup(layers, 1, tracks)("left", "layerPositionZ", 0)).toBe(0);
  });

  it("moves cloner copies with a parented cloner", () => {
    const cloner: LayerInstance = {
      id: "cl",
      type: "cloner",
      enabled: true,
      parent: "p",
      values: { ...buildLayerValues("cloner"), sources: ["src"], countX: 1, countY: 1 },
    };
    const fn = setup([layer("p", { layerPositionY: 0.25 }), cloner, layer("src")]);
    expect(fn(cloneId("cl", 0), "layerPositionY", 0)).toBeCloseTo(0.25, 9);
  });
});

describe("attach to text end", () => {
  it("rides along with typing", () => {
    const text: LayerInstance = {
      id: "t",
      type: "text",
      enabled: true,
      values: {
        ...buildLayerValues("text"),
        content: "abcd",
        textAlign: "left",
        fontSize: 100,
        tracking: 0,
        animStyle: 1,
      },
    };
    const cursor = layer("cur", {}, { parent: "t", parentPoint: "textEnd" });
    const tracks: PropertyTrack[] = [
      { layerId: "t", paramName: "animProgress", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
    ];
    const measure = () => 50; // every glyph 50px in a 1000px comp
    const pad = Math.round(100 * 0.25);
    const at = (time: number) => setup([text, cursor], time, tracks, measure)("cur", "layerPositionX", 0);
    // x (width fraction from center) = (end px / 1000) − 0.5
    expect(at(0)).toBeCloseTo(pad / 1000 - 0.5, 9);
    expect(at(0.5)).toBeCloseTo((pad + 100) / 1000 - 0.5, 9);
    expect(at(1)).toBeCloseTo((pad + 200) / 1000 - 0.5, 9);
    expect(setup([text, cursor], 1, tracks, measure)("cur", "layerPositionY", 0)).toBeCloseTo(0, 9);
  });
});

describe("pointer press feedback", () => {
  it("shrinks the pointer's cursor graphic while pressed, eased over 0.1 s", async () => {
    const { ModulationEngine } = await import("./engine");
    const { createAnimatedModulationFn } = await import("../animation/create-modulation-fn");
    const { buildLayerValues } = await import("../compiler/build-layer-values");
    const layers: LayerInstance[] = [
      { id: "cur", type: "image", enabled: true, parent: "ptr", values: { ...buildLayerValues("image"), layerScale: 10 } },
      { id: "ptr", type: "pointer", enabled: true, values: buildLayerValues("pointer") },
    ];
    const tracks = [{ layerId: "ptr", paramName: "press", enabled: true, keys: [{ time: 0, value: 0, ease: "hold" as const }, { time: 1, value: 1, ease: "hold" as const }] }];
    const at = (t: number) => {
      const engine = new ModulationEngine();
      engine.setConfig({ layers, lfos: [], assignments: [], tracks, settings: { duration: 5, fps: 60, width: 1000, height: 1000 } });
      engine.sampleAt(t);
      return createAnimatedModulationFn(t, tracks, engine)("cur", "layerScale", 10);
    };
    expect(at(0.5)).toBeCloseTo(10, 6);
    expect(at(1.5)).toBeCloseTo(8.5, 6);
    const mid = at(1.05);
    expect(mid).toBeLessThan(10);
    expect(mid).toBeGreaterThan(8.5);
  });
});
