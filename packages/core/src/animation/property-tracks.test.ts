import { describe, expect, it } from "bun:test";
import {
  evaluateKeyframes,
  evaluatePropertyTrack,
  moveKeyframe,
  removeKeyframeAt,
  setTrackEnabled,
  upsertKeyframe,
  isPropertyTrackActive,
  buildKeyframePasteItems,
  pasteKeyframesAtTime,
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

describe("removeKeyframeAt", () => {
  it("removes the track when the last keyframe is deleted", () => {
    let tracks = upsertKeyframe([], "l1", "x", 1, 5);
    tracks = removeKeyframeAt(tracks, "l1", "x", 1);
    expect(tracks.length).toBe(0);
  });

  it("keeps the track when other keyframes remain", () => {
    let tracks = upsertKeyframe([], "l1", "x", 1, 5);
    tracks = upsertKeyframe(tracks, "l1", "x", 3, 8);
    tracks = removeKeyframeAt(tracks, "l1", "x", 1);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.keys.map((k) => k.time)).toEqual([3]);
  });
});

describe("isPropertyTrackActive", () => {
  it("is false for missing, empty, or disabled tracks", () => {
    expect(isPropertyTrackActive(undefined)).toBe(false);
    expect(
      isPropertyTrackActive({ layerId: "l", paramName: "x", enabled: true, keys: [] }),
    ).toBe(false);
  });

  it("is true when the track has keyframes", () => {
    expect(
      isPropertyTrackActive({
        layerId: "l",
        paramName: "x",
        enabled: true,
        keys: [{ time: 0, value: 1, ease: "linear" }],
      }),
    ).toBe(true);
  });
});

describe("pasteKeyframesAtTime", () => {
  it("pastes keys at the playhead while preserving relative spacing", () => {
    const items = [
      { layerId: "l1", paramName: "x", time: 1, value: 5, ease: "easeOut" as const },
      { layerId: "l1", paramName: "x", time: 2, value: 8, ease: "linear" as const },
    ];
    const { tracks, pasted } = pasteKeyframesAtTime([], items, 1, 4);
    expect(tracks[0]!.keys.map((k) => k.time)).toEqual([4, 5]);
    expect(tracks[0]!.keys[0]!.value).toBe(5);
    expect(tracks[0]!.keys[0]!.ease).toBe("easeOut");
    expect(pasted).toEqual([
      { layerId: "l1", paramName: "x", time: 4 },
      { layerId: "l1", paramName: "x", time: 5 },
    ]);
  });

  it("replaces an existing key at the target time", () => {
    let tracks = upsertKeyframe([], "l1", "x", 4, 99);
    const items = [{ layerId: "l1", paramName: "x", time: 1, value: 5 }];
    const { tracks: next } = pasteKeyframesAtTime(tracks, items, 1, 4);
    expect(next[0]!.keys).toHaveLength(1);
    expect(next[0]!.keys[0]!.value).toBe(5);
  });
});

describe("buildKeyframePasteItems", () => {
  it("copies value and easing from tracks", () => {
    let tracks = upsertKeyframe([], "l1", "x", 1, 5);
    tracks = tracks.map((t) =>
      t.layerId === "l1" && t.paramName === "x"
        ? { ...t, keys: [{ time: 1, value: 5, ease: "easeIn" as const }] }
        : t,
    );
    const items = buildKeyframePasteItems(tracks, [{ layerId: "l1", paramName: "x", time: 1 }]);
    expect(items).toEqual([
      { layerId: "l1", paramName: "x", time: 1, value: 5, ease: "easeIn" },
    ]);
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
