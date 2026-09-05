import { describe, expect, it } from "bun:test";
import { bakeLfoAssignments } from "./bake-lfo";
import { createAnimatedModulationFn } from "./create-modulation-fn";
import { ModulationEngine } from "../modulation/engine";
import { compilePasses } from "../compiler/compile-passes";
import { buildLayerValues } from "../compiler/build-layer-values";
import { cloneMeshPoints, MESH_BLOOM_POINTS, meshParamName } from "../compiler/mesh-uniforms";
import type { CompositionConfig } from "../types/composition";
import type { LFOPlaybackMode, LFOSource } from "../types/editor";

const SINE_POINTS = [
  { x: 0, y: 0.5, curve: -0.4 },
  { x: 0.25, y: 1, curve: -0.4 },
  { x: 0.5, y: 0.5, curve: 0.4 },
  { x: 0.75, y: 0, curve: 0.4 },
  { x: 1, y: 0.5, curve: 0 },
];

function lfo(overrides: Partial<LFOSource> = {}): LFOSource {
  return {
    id: "lfo-1",
    label: "Drift",
    color: "#6CB4EE",
    points: SINE_POINTS.map((p) => ({ ...p })),
    waveShape: "sine",
    rate: 0.5,
    phase: 0,
    mode: "loop" as LFOPlaybackMode,
    ...overrides,
  };
}

function configWith(overrides: Partial<CompositionConfig> = {}): CompositionConfig {
  return {
    version: 1,
    layers: [
      {
        id: "distortion-1",
        type: "distortion",
        enabled: true,
        values: { ...buildLayerValues("distortion"), amplitude: 0.4 },
      },
    ],
    lfos: [lfo()],
    assignments: [
      { sourceId: "lfo-1", layerId: "distortion-1", paramName: "amplitude", depth: 0.3 },
    ],
    settings: { duration: 4, fps: 60, width: 1920, height: 1080 },
    ...overrides,
  };
}

/** What the renderer would see at `time` for the given config. */
function valueAt(config: CompositionConfig, layerId: string, paramName: string, time: number, base: number) {
  const engine = new ModulationEngine();
  engine.setLfos(config.lfos);
  engine.setAssignments(config.assignments);
  engine.sampleAt(time);
  return createAnimatedModulationFn(time, config.tracks ?? [], engine)(layerId, paramName, base);
}

describe("bakeLfoAssignments", () => {
  it("reproduces the modulated value at every frame", () => {
    const config = configWith();
    const { config: baked } = bakeLfoAssignments(config);

    const swing = 0.3;
    for (let frame = 0; frame <= 240; frame++) {
      const time = frame / 60;
      const before = valueAt(config, "distortion-1", "amplitude", time, 0.4);
      const after = valueAt(baked, "distortion-1", "amplitude", time, 0.4);
      expect(Math.abs(after - before)).toBeLessThan(0.01 * swing + 1e-9);
    }
  });

  it("thins samples down to an editable number of keys", () => {
    const { baked } = bakeLfoAssignments(configWith());
    expect(baked[0]!.samples).toBe(241);
    expect(baked[0]!.keys).toBeLessThan(40);
    expect(baked[0]!.keys).toBeGreaterThan(2);
  });

  it("is exact at zero tolerance", () => {
    const config = configWith();
    const { config: baked } = bakeLfoAssignments(config, { tolerance: 0 });

    for (let frame = 0; frame <= 240; frame++) {
      const time = frame / 60;
      expect(valueAt(baked, "distortion-1", "amplitude", time, 0.4)).toBe(
        valueAt(config, "distortion-1", "amplitude", time, 0.4),
      );
    }
  });

  it("trades keys for accuracy as tolerance grows", () => {
    const loose = bakeLfoAssignments(configWith(), { tolerance: 0.05 });
    const tight = bakeLfoAssignments(configWith(), { tolerance: 0.001 });
    expect(loose.baked[0]!.keys).toBeLessThan(tight.baked[0]!.keys);
  });

  it("removes the baked assignment and leaves the LFO source", () => {
    const { config: baked } = bakeLfoAssignments(configWith());
    expect(baked.assignments).toEqual([]);
    expect(baked.lfos.map((l) => l.id)).toEqual(["lfo-1"]);
  });

  it("only bakes the assignments the filter selects", () => {
    const config = configWith({
      lfos: [lfo(), lfo({ id: "lfo-2", rate: 0.2 })],
      assignments: [
        { sourceId: "lfo-1", layerId: "distortion-1", paramName: "amplitude", depth: 0.3 },
        { sourceId: "lfo-2", layerId: "distortion-1", paramName: "freq", depth: 1.5 },
      ],
    });
    const { config: baked, skipped } = bakeLfoAssignments(config, {
      filter: (a) => a.paramName === "amplitude",
    });

    expect(baked.assignments.map((a) => a.paramName)).toEqual(["freq"]);
    expect(baked.tracks!.map((t) => t.paramName)).toEqual(["amplitude"]);
    expect(skipped).toEqual([]);
  });

  it("samples at the requested rate and duration", () => {
    const { baked } = bakeLfoAssignments(configWith(), { fps: 12, duration: 2 });
    expect(baked[0]!.samples).toBe(25);
  });

  it("samples through the end of a fractional duration", () => {
    const { config: baked } = bakeLfoAssignments(configWith(), { fps: 10, duration: 2.34 });
    expect(baked.tracks![0]!.keys.at(-1)!.time).toBeCloseTo(2.34, 6);
  });

  it("writes one key when the modulated value never moves", () => {
    const config = configWith({ lfos: [lfo({ rate: 0 })] });
    const { config: baked, baked: summary } = bakeLfoAssignments(config);
    expect(summary[0]!.keys).toBe(1);
    expect(baked.tracks![0]!.keys[0]!.time).toBe(0);
  });

  it("respects params where a zero base disables the effect", () => {
    const config = configWith({
      layers: [
        {
          id: "distortion-1",
          type: "distortion",
          enabled: true,
          values: { ...buildLayerValues("distortion"), amplitude: 0 },
        },
      ],
    });
    const { config: baked } = bakeLfoAssignments(config);
    expect(baked.tracks![0]!.keys).toEqual([{ time: 0, value: 0, ease: "linear" }]);
  });

  it("bakes mesh point params from their point values", () => {
    const points = cloneMeshPoints(MESH_BLOOM_POINTS);
    const paramName = meshParamName(3, "x");
    const config = configWith({
      layers: [
        {
          id: "mesh-1",
          type: "mesh",
          enabled: true,
          values: { ...buildLayerValues("mesh"), u_meshPoints: points },
        },
      ],
      assignments: [{ sourceId: "lfo-1", layerId: "mesh-1", paramName, depth: 0.06 }],
    });

    const { config: baked, baked: summary } = bakeLfoAssignments(config);
    expect(summary[0]!.keys).toBeGreaterThan(2);

    for (let frame = 0; frame <= 240; frame += 7) {
      const time = frame / 60;
      const base = points[3]!.x;
      const before = valueAt(config, "mesh-1", paramName, time, base);
      const after = valueAt(baked, "mesh-1", paramName, time, base);
      expect(Math.abs(after - before)).toBeLessThan(0.01 * 0.06 + 1e-9);
    }
  });

  it("keeps the corners of a pingpong wave within tolerance", () => {
    const config = configWith({ lfos: [lfo({ mode: "pingpong", rate: 0.75 })] });
    const { config: baked } = bakeLfoAssignments(config);

    for (let frame = 0; frame <= 240; frame++) {
      const time = frame / 60;
      const before = valueAt(config, "distortion-1", "amplitude", time, 0.4);
      const after = valueAt(baked, "distortion-1", "amplitude", time, 0.4);
      expect(Math.abs(after - before)).toBeLessThan(0.01 * 0.3 + 1e-9);
    }
  });

  it("does not clobber existing keyframes unless asked", () => {
    const config = configWith({
      tracks: [
        {
          layerId: "distortion-1",
          paramName: "amplitude",
          enabled: true,
          keys: [{ time: 0, value: 0.1, ease: "linear" }],
        },
      ],
    });

    const kept = bakeLfoAssignments(config);
    expect(kept.baked).toEqual([]);
    expect(kept.skipped).toEqual([
      { layerId: "distortion-1", paramName: "amplitude", reason: "existing-keyframes" },
    ]);
    expect(kept.config).toBe(config);

    const forced = bakeLfoAssignments(config, { overwrite: true });
    expect(forced.baked[0]!.keys).toBeGreaterThan(1);
    expect(forced.config.tracks!.length).toBe(1);
  });

  it("skips a stopwatch-on track that has no keys yet", () => {
    const config = configWith({
      tracks: [
        { layerId: "distortion-1", paramName: "amplitude", enabled: true, keys: [] },
      ],
    });

    const { baked, skipped } = bakeLfoAssignments(config);
    expect(baked).toEqual([]);
    expect(skipped[0]!.reason).toBe("existing-keyframes");
  });

  it("bakes over a disabled track", () => {
    const config = configWith({
      tracks: [
        {
          layerId: "distortion-1",
          paramName: "amplitude",
          enabled: false,
          keys: [{ time: 0, value: 0.1, ease: "linear" }],
        },
      ],
    });

    const { config: result, baked } = bakeLfoAssignments(config);
    expect(baked[0]!.keys).toBeGreaterThan(1);
    expect(result.tracks!.length).toBe(1);
    expect(result.tracks![0]!.enabled).toBe(true);
  });

  it("produces the same pass uniforms as the live LFO config", () => {
    const config = configWith();
    const { config: baked } = bakeLfoAssignments(config);

    for (const time of [0, 0.37, 1.25, 2.8, 4]) {
      const live = new ModulationEngine();
      live.setLfos(config.lfos);
      live.setAssignments(config.assignments);
      live.sampleAt(time);

      const frozen = new ModulationEngine();
      frozen.setLfos(baked.lfos);
      frozen.setAssignments(baked.assignments);
      frozen.sampleAt(time);

      const livePasses = compilePasses(
        config.layers,
        createAnimatedModulationFn(time, config.tracks ?? [], live),
      );
      const bakedPasses = compilePasses(
        baked.layers,
        createAnimatedModulationFn(time, baked.tracks ?? [], frozen),
      );

      expect(bakedPasses.length).toBe(livePasses.length);
      for (let i = 0; i < livePasses.length; i++) {
        const a = livePasses[i]!.uniforms.amplitude as number | undefined;
        const b = bakedPasses[i]!.uniforms.amplitude as number | undefined;
        if (typeof a === "number") expect(Math.abs(b! - a)).toBeLessThan(0.01 * 0.3 + 1e-9);
      }
    }
  });

  it("reports assignments it cannot resolve", () => {
    const config = configWith({
      assignments: [
        { sourceId: "lfo-1", layerId: "ghost-1", paramName: "amplitude", depth: 0.3 },
        { sourceId: "lfo-9", layerId: "distortion-1", paramName: "amplitude", depth: 0.3 },
        { sourceId: "lfo-1", layerId: "distortion-1", paramName: "nope", depth: 0.3 },
      ],
    });
    const { baked, skipped } = bakeLfoAssignments(config);

    expect(baked).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "missing-layer",
      "missing-source",
      "unknown-param",
    ]);
  });
});
