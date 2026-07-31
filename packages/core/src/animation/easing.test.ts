import { describe, expect, it } from "bun:test";
import {
  cubicBezierProgress,
  evaluateCubicBezier,
  EASING_PRESETS,
  findEasingPreset,
  matchEasingPreset,
} from "./easing";
import { evaluateKeyframes, setKeyframesEasing } from "./property-tracks";
import type { PropertyTrack } from "../types/animation";

describe("cubicBezierProgress", () => {
  it("hits the endpoints exactly", () => {
    expect(cubicBezierProgress(0.16, 1, 0.3, 1, 0)).toBe(0);
    expect(cubicBezierProgress(0.16, 1, 0.3, 1, 1)).toBe(1);
  });

  it("matches linear for the identity curve", () => {
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(cubicBezierProgress(0.25, 0.25, 0.75, 0.75, u)).toBeCloseTo(u, 5);
    }
  });

  it("matches the CSS ease curve at known samples", () => {
    // cubic-bezier(0.25, 0.1, 0.25, 1) — the CSS `ease` keyword.
    expect(cubicBezierProgress(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3);
  });

  it("is monotonic in x for valid control points", () => {
    let prev = -1;
    for (let i = 0; i <= 40; i++) {
      const y = cubicBezierProgress(0.7, 0, 0.84, 0, i / 40);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it("overshoots for back-out style curves", () => {
    const preset = findEasingPreset("backOut")!;
    const mid = evaluateCubicBezier(preset.curve, 0.55);
    expect(mid).toBeGreaterThan(1); // overshoot past the target
    expect(evaluateCubicBezier(preset.curve, 1)).toBe(1);
  });
});

describe("presets", () => {
  it("all evaluate to 0 at 0 and 1 at 1", () => {
    for (const preset of EASING_PRESETS) {
      expect(evaluateCubicBezier(preset.curve, 0)).toBeCloseTo(0, 6);
      expect(evaluateCubicBezier(preset.curve, 1)).toBeCloseTo(1, 6);
    }
  });

  it("matchEasingPreset round-trips", () => {
    for (const preset of EASING_PRESETS) {
      expect(matchEasingPreset([...preset.curve] as typeof preset.curve)).toBe(preset.id);
    }
    expect(matchEasingPreset([0.1, 0.2, 0.3, 0.4])).toBeUndefined();
    expect(matchEasingPreset(undefined)).toBeUndefined();
  });
});

describe("keyframes with curves", () => {
  const keys = [
    { time: 0, value: 0, ease: "linear" as const },
    { time: 2, value: 100 },
  ];

  it("evaluates a custom curve when present", () => {
    const curved = [{ ...keys[0]!, curve: [0.16, 1, 0.3, 1] as [number, number, number, number] }, keys[1]!];
    const linearMid = evaluateKeyframes(keys, 1, 0);
    const easedMid = evaluateKeyframes(curved, 1, 0);
    expect(linearMid).toBeCloseTo(50);
    expect(easedMid).toBeGreaterThan(90); // expoOut front-loads the motion
  });

  it("legacy named eases are untouched", () => {
    const eased = [{ ...keys[0]!, ease: "easeIn" as const }, keys[1]!];
    expect(evaluateKeyframes(eased, 1, 0)).toBeCloseTo(25); // x*x at 0.5
  });
});

describe("setKeyframesEasing", () => {
  const tracks: PropertyTrack[] = [
    {
      layerId: "l1",
      paramName: "p",
      enabled: true,
      keys: [
        { time: 0, value: 0, ease: "linear" },
        { time: 1, value: 1, ease: "easeIn" },
      ],
    },
  ];

  it("applies a bezier curve and clears the named ease", () => {
    const next = setKeyframesEasing(tracks, [{ layerId: "l1", paramName: "p", time: 0 }], [0.16, 1, 0.3, 1]);
    const key = next[0]!.keys[0]!;
    expect(key.curve).toEqual([0.16, 1, 0.3, 1]);
    expect(key.ease).toBeUndefined();
    // untouched key keeps its ease, original array not mutated
    expect(next[0]!.keys[1]!.ease).toBe("easeIn");
    expect(tracks[0]!.keys[0]!.curve).toBeUndefined();
  });

  it("applies a named ease and clears the curve", () => {
    const withCurve = setKeyframesEasing(tracks, [{ layerId: "l1", paramName: "p", time: 0 }], [0.16, 1, 0.3, 1]);
    const back = setKeyframesEasing(withCurve, [{ layerId: "l1", paramName: "p", time: 0 }], "hold");
    const key = back[0]!.keys[0]!;
    expect(key.ease).toBe("hold");
    expect(key.curve).toBeUndefined();
  });

  it("ignores refs that do not resolve", () => {
    const next = setKeyframesEasing(tracks, [{ layerId: "nope", paramName: "p", time: 0 }], "hold");
    expect(next[0]!.keys[0]!.ease).toBe("linear");
  });
});
