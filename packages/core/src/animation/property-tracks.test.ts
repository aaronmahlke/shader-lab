import { describe, expect, it } from "bun:test";
import {
  evaluateKeyframes,
  evaluatePropertyTrack,
  moveKeyframe,
  setTrackEnabled,
  upsertKeyframe,
} from "./property-tracks";

describe("evaluateKeyframes", () => {
  it("holds before first and after last key", () => {
    const keys = [
      { time: 1, value: 10, ease: "linear" as const },
      { time: 3, value: 30, ease: "linear" as const },
    ];
    expect(evaluateKeyframes(keys, 0, 0)).toBe(10);
    expect(evaluateKeyframes(keys, 5, 0)).toBe(30);
  });

  it("linearly interpolates between keys", () => {
    const keys = [
      { time: 0, value: 0, ease: "linear" as const },
      { time: 2, value: 20, ease: "linear" as const },
    ];
    expect(evaluateKeyframes(keys, 1, 0)).toBe(10);
  });
});

describe("setTrackEnabled", () => {
  it("seeds a key when enabling stopwatch", () => {
    const tracks = setTrackEnabled([], "layer-1", "amount", true, 14, 0.5);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.keys).toEqual([{ time: 0.5, value: 14, ease: "linear" }]);
  });

  it("removes track when disabling stopwatch", () => {
    let tracks = setTrackEnabled([], "layer-1", "amount", true, 14, 0);
    tracks = setTrackEnabled(tracks, "layer-1", "amount", false);
    expect(tracks.length).toBe(0);
  });
});

describe("upsertKeyframe", () => {
  it("updates key at same time", () => {
    let tracks = upsertKeyframe([], "l1", "x", 1, 5);
    tracks = upsertKeyframe(tracks, "l1", "x", 1, 8);
    expect(tracks[0]!.keys).toHaveLength(1);
    expect(tracks[0]!.keys[0]!.value).toBe(8);
  });
});

describe("moveKeyframe", () => {
  it("moves a key to a new time", () => {
    let tracks = upsertKeyframe([], "l1", "x", 1, 5);
    tracks = upsertKeyframe(tracks, "l1", "x", 3, 8);
    tracks = moveKeyframe(tracks, "l1", "x", 1, 2);
    expect(tracks[0]!.keys.map((k) => k.time)).toEqual([2, 3]);
  });

  it("does not move onto an existing key", () => {
    let tracks = upsertKeyframe([], "l1", "x", 1, 5);
    tracks = upsertKeyframe(tracks, "l1", "x", 3, 8);
    const unchanged = moveKeyframe(tracks, "l1", "x", 1, 3);
    expect(unchanged[0]!.keys.map((k) => k.time)).toEqual([1, 3]);
  });
});

describe("evaluatePropertyTrack", () => {
  it("returns fallback when track disabled or empty", () => {
    expect(evaluatePropertyTrack(undefined, 1, 3)).toBe(3);
    expect(
      evaluatePropertyTrack(
        { layerId: "l", paramName: "x", enabled: true, keys: [] },
        1,
        3,
      ),
    ).toBe(3);
  });
});
