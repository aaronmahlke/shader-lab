import { describe, expect, it } from "bun:test";
import { motionBlurSampleTimes } from "./motion-blur";
import { normalizeComposition } from "../compiler/normalize-composite-layers";

describe("motionBlurSampleTimes", () => {
  it("is just the frame time when turned off", () => {
    expect(motionBlurSampleTimes(1, { fps: 60, motionBlur: false })).toEqual([1]);
  });

  it("is on by default (AE-style)", () => {
    expect(motionBlurSampleTimes(1, { fps: 60 }).length).toBe(8);
  });

  it("spreads samples evenly across a centered shutter window", () => {
    const times = motionBlurSampleTimes(1, { fps: 50, motionBlur: true, shutterAngle: 180, motionBlurSamples: 4 });
    // 180° at 50 fps = 10 ms window → centers at ±1.25 ms and ±3.75 ms
    expect(times.length).toBe(4);
    expect(times[0]).toBeCloseTo(1 - 0.00375, 9);
    expect(times[3]).toBeCloseTo(1 + 0.00375, 9);
    expect(times.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1, 9);
  });

  it("caps samples (cheap preview) and handles a closed shutter", () => {
    expect(motionBlurSampleTimes(0, { fps: 60, motionBlur: true, motionBlurSamples: 16 }, 3).length).toBe(3);
    expect(motionBlurSampleTimes(0, { fps: 60, motionBlur: true, shutterAngle: 0 })).toEqual([0]);
  });

  it("survives normalization (settings keep motion blur fields)", () => {
    const config = { version: 1 as const, layers: [], lfos: [], assignments: [], settings: { duration: 3, fps: 30, width: 100, height: 100, motionBlur: true, shutterAngle: 270 } };
    normalizeComposition(config);
    expect(config.settings.motionBlur).toBe(true);
    expect(config.settings.shutterAngle).toBe(270);
  });
});
