import { describe, expect, it } from "bun:test";
import type { PropertyTrack } from "../types/animation";
import type { EnvelopeSource, LayerInstance, LFOSource, ModulationAssignment } from "../types/editor";
import { ModulationEngine, linkTrackLayerId, sourceTrackLayerId } from "./engine";
import { evaluateEnvelope } from "./envelope";
import { evaluateSineWave } from "./lfo-wave";
import { createAnimatedModulationFn } from "../animation/create-modulation-fn";
import { integrateKeyframes } from "../animation/property-tracks";

const lfo = (over: Partial<LFOSource> = {}): LFOSource => ({
  id: "lfo1",
  label: "LFO",
  color: "#f00",
  points: [],
  waveShape: "sine",
  rate: 1,
  phase: 0,
  mode: "loop",
  ...over,
});

const env = (over: Partial<EnvelopeSource> = {}): EnvelopeSource => ({
  id: "env1",
  label: "Env",
  color: "#0f0",
  attack: 1,
  decay: 1,
  sustain: 0.5,
  gate: 3,
  release: 1,
  ...over,
});

const link = (over: Partial<ModulationAssignment> = {}): ModulationAssignment => ({
  sourceId: "lfo1",
  layerId: "a",
  paramName: "speed",
  depth: 2,
  ...over,
});

const layer = (id: string, inPoint?: number): LayerInstance => ({
  id,
  type: "solid",
  enabled: true,
  values: {},
  timing: inPoint === undefined ? undefined : { in: inPoint },
});

function engineWith(config: {
  lfos?: LFOSource[];
  envelopes?: EnvelopeSource[];
  assignments: ModulationAssignment[];
  tracks?: PropertyTrack[];
  layers?: LayerInstance[];
}): ModulationEngine {
  const engine = new ModulationEngine();
  engine.setConfig({ layers: [], lfos: [], ...config });
  return engine;
}

const at = (engine: ModulationEngine, time: number, base = 10, param = "speed", layerId = "a") => {
  engine.sampleAt(time);
  return engine.getModulatedValue(layerId, param, base);
};

describe("ModulationEngine — LFO links", () => {
  it("matches the legacy base + wave × depth for a single link", () => {
    const engine = engineWith({ lfos: [lfo({ rate: 0.5, phase: 90 })], assignments: [link()] });
    for (const t of [0, 0.3, 1.1, 2.7]) {
      const expected = 10 + evaluateSineWave((t * 0.5 + 0.25) % 1) * 2;
      expect(at(engine, t)).toBeCloseTo(expected, 9);
    }
  });

  it("stacks every link on the same property", () => {
    const engine = engineWith({
      lfos: [lfo(), lfo({ id: "lfo2", phase: 180 })],
      assignments: [link(), link({ sourceId: "lfo2", depth: -1 })],
    });
    const t = 0.1;
    const expected = 10 + evaluateSineWave(0.1) * 2 - evaluateSineWave(0.6);
    expect(at(engine, t)).toBeCloseTo(expected, 9);
  });

  it("skips disabled links", () => {
    const engine = engineWith({ lfos: [lfo()], assignments: [link({ enabled: false })] });
    expect(at(engine, 0.25)).toBe(10);
  });

  it("keyframes enabled on and off", () => {
    const l = link();
    const engine = engineWith({
      lfos: [lfo()],
      assignments: [l],
      tracks: [{
        layerId: linkTrackLayerId(l),
        paramName: "enabled",
        enabled: true,
        keys: [{ time: 0, value: 1, ease: "hold" }, { time: 1, value: 0, ease: "hold" }],
      }],
    });
    expect(at(engine, 0.25)).toBeCloseTo(12, 9);
    expect(at(engine, 1.25)).toBe(10);
  });

  it("keyframes depth", () => {
    const l = link();
    const engine = engineWith({
      lfos: [lfo()],
      assignments: [l],
      tracks: [{
        layerId: linkTrackLayerId(l),
        paramName: "depth",
        enabled: true,
        keys: [{ time: 0, value: 0 }, { time: 2, value: 4 }],
      }],
    });
    // t = 1.25: wave at peak (sin 2π·0.25 = 1), depth halfway → 2.5
    expect(at(engine, 1.25)).toBeCloseTo(10 + 2.5, 9);
  });

  it("keeps a zero base off for zero-base params", () => {
    const engine = engineWith({ lfos: [lfo()], assignments: [link({ paramName: "amplitude" })] });
    expect(at(engine, 0.25, 0, "amplitude")).toBe(0);
  });

  it("restarts layer-time links at the layer in-point", () => {
    const engine = engineWith({
      lfos: [lfo({ rate: 0.5 })],
      assignments: [link({ timeBase: "layer" })],
      layers: [layer("a", 0.5)],
    });
    expect(at(engine, 1.0)).toBeCloseTo(10 + evaluateSineWave(0.25) * 2, 9);
  });
});

describe("ModulationEngine — keyframed LFO params", () => {
  const rateTrack = (keys: PropertyTrack["keys"]): PropertyTrack => ({
    layerId: sourceTrackLayerId("lfo1"),
    paramName: "rate",
    enabled: true,
    keys,
  });

  it("a constant rate track equals the static rate", () => {
    const keyed = engineWith({ lfos: [lfo({ rate: 3 })], assignments: [link()], tracks: [rateTrack([{ time: 0, value: 0.7 }])] });
    const fixed = engineWith({ lfos: [lfo({ rate: 0.7 })], assignments: [link()] });
    for (const t of [0.13, 1.9, 4.2]) expect(at(keyed, t)).toBeCloseTo(at(fixed, t), 9);
  });

  it("accumulates phase so a rate change never jumps", () => {
    // Rate steps 1 Hz → 2.5 Hz at t = 1 (hold). Naive t·rate jumps by 1.5 cycles there.
    const engine = engineWith({
      lfos: [lfo()],
      assignments: [link({ depth: 1 })],
      tracks: [rateTrack([{ time: 0, value: 1, ease: "hold" }, { time: 1, value: 2.5 }])],
    });
    // ∫ rate: 1 cycle by t = 1, then 2.5/s → 1.25 cycles at t = 1.1 (naive: 2.75).
    expect(at(engine, 1.1, 0)).toBeCloseTo(evaluateSineWave(0.25), 6);
    const before = at(engine, 0.999, 0);
    const after = at(engine, 1.001, 0);
    expect(Math.abs(after - before)).toBeLessThan(0.03);
  });

  it("keyframes phase", () => {
    const engine = engineWith({
      lfos: [lfo({ rate: 0 })],
      assignments: [link({ depth: 1 })],
      tracks: [{ layerId: sourceTrackLayerId("lfo1"), paramName: "phase", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 90 }] }],
    });
    expect(at(engine, 1, 0)).toBeCloseTo(evaluateSineWave(0.25), 9);
  });
});

describe("keyframes + modulators", () => {
  it("modulators ride on top of keyframes instead of being replaced", () => {
    const tracks: PropertyTrack[] = [
      { layerId: "a", paramName: "speed", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 100 }] },
    ];
    const engine = engineWith({ lfos: [lfo()], assignments: [link()], tracks });
    const fn = createAnimatedModulationFn(0.25, tracks, engine);
    expect(fn("a", "speed", 10)).toBeCloseTo(25 + 2, 9);
  });

  it("samples the engine at the requested time", () => {
    const engine = engineWith({ lfos: [lfo()], assignments: [link()] });
    engine.sampleAt(0);
    const fn = createAnimatedModulationFn(0.25, [], engine);
    expect(fn("a", "speed", 10)).toBeCloseTo(12, 9);
  });
});

describe("envelopes", () => {
  const shape = env();

  it("runs attack → decay → sustain → release", () => {
    expect(evaluateEnvelope(shape, [0], -0.1)).toBe(0);
    expect(evaluateEnvelope(shape, [0], 0.5)).toBeCloseTo(0.5, 9);  // attack
    expect(evaluateEnvelope(shape, [0], 1)).toBeCloseTo(1, 9);      // peak
    expect(evaluateEnvelope(shape, [0], 1.5)).toBeCloseTo(0.75, 9); // decay
    expect(evaluateEnvelope(shape, [0], 2.5)).toBeCloseTo(0.5, 9);  // sustain
    expect(evaluateEnvelope(shape, [0], 3.5)).toBeCloseTo(0.25, 9); // release
    expect(evaluateEnvelope(shape, [0], 5)).toBe(0);
  });

  it("releases from mid-attack when the gate closes early", () => {
    const short = env({ gate: 0.5 });
    expect(evaluateEnvelope(short, [0], 0.5)).toBeCloseTo(0.5, 9);
    expect(evaluateEnvelope(short, [0], 1)).toBeCloseTo(0.25, 9);
  });

  it("retriggers legato from the current level", () => {
    // Second trigger at t = 3.5, mid-release at 0.25 → attack 0.25 → 1 over 1 s.
    expect(evaluateEnvelope(shape, [0, 3.5], 3.5)).toBeCloseTo(0.25, 9);
    expect(evaluateEnvelope(shape, [0, 3.5], 4)).toBeCloseTo(0.625, 9);
  });

  it("handles zero-length stages", () => {
    const instant = env({ attack: 0, decay: 0, release: 0 });
    expect(evaluateEnvelope(instant, [0], 0)).toBeCloseTo(0.5, 9);
    expect(evaluateEnvelope(instant, [0], 3)).toBe(0);
  });

  it("drives links like an LFO, triggered on the layer in-point", () => {
    const engine = engineWith({
      envelopes: [env()],
      assignments: [link({ sourceId: "env1", depth: 4, timeBase: "layer" })],
      layers: [layer("a", 2)],
    });
    expect(at(engine, 1)).toBe(10);
    expect(at(engine, 2.5)).toBeCloseTo(12, 9);
    expect(engine.getLfoValues().env1).toBeCloseTo(0.5, 9); // comp time 2.5 → sustain
  });

  it("keyframes envelope params", () => {
    const engine = engineWith({
      envelopes: [env()],
      assignments: [link({ sourceId: "env1", depth: 1 })],
      tracks: [{ layerId: sourceTrackLayerId("env1"), paramName: "sustain", enabled: true, keys: [{ time: 0, value: 0.2 }] }],
    });
    expect(at(engine, 2.5, 0)).toBeCloseTo(0.2, 9);
  });
});

describe("integrateKeyframes", () => {
  it("integrates linear, held and extrapolated spans", () => {
    const keys = [{ time: 1, value: 2 }, { time: 3, value: 4, ease: "hold" as const }, { time: 4, value: 0 }];
    expect(integrateKeyframes(keys, 0, 1, 0)).toBeCloseTo(2, 9);   // before first key: constant 2
    expect(integrateKeyframes(keys, 1, 3, 0)).toBeCloseTo(6, 9);   // linear 2 → 4
    expect(integrateKeyframes(keys, 3, 4, 0)).toBeCloseTo(4, 9);   // hold at 4
    expect(integrateKeyframes(keys, 4, 6, 0)).toBeCloseTo(0, 9);   // after last: 0
    expect(integrateKeyframes(keys, 2, 0, 0)).toBeCloseTo(-4.5, 9); // signed
  });

  it("integrates eased segments", () => {
    const keys = [{ time: 0, value: 0, ease: "easeIn" as const }, { time: 1, value: 3 }];
    expect(integrateKeyframes(keys, 0, 1, 0)).toBeCloseTo(1, 6); // ∫ 3x² = 1
  });
});
