import { describe, expect, it } from "bun:test";
import {
  collectBarSnapTargets,
  snapBarMoveDelta,
  snapEdgeTime,
} from "./timeline-snapping";

describe("collectBarSnapTargets", () => {
  const windows = [
    { id: "a", in: 0.5, out: 2 },
    { id: "b", in: 3, out: 4.5 },
  ];

  it("includes comp bounds, playhead, and other layers' edges", () => {
    const targets = collectBarSnapTargets(windows, new Set(["a"]), 5, 1.25);
    expect(targets).toEqual([0, 5, 1.25, 3, 4.5]);
  });

  it("excludes every dragged layer", () => {
    const targets = collectBarSnapTargets(windows, new Set(["a", "b"]), 5, 1.25);
    expect(targets).toEqual([0, 5, 1.25]);
  });
});

describe("snapBarMoveDelta", () => {
  const windows = [
    { in: 0, out: 1 },
    { in: 2, out: 3 },
  ];

  it("snaps the group when any moved edge is in range", () => {
    // Delta 0.96 puts the second bar's out at 3.96; target 4 is 0.04 away.
    const snap = snapBarMoveDelta(0.96, windows, [4], 0.1);
    expect(snap.delta).toBeCloseTo(1);
    expect(snap.guide).toBe(4);
  });

  it("picks the smallest correction across all edges and targets", () => {
    // First bar's in lands at 0.5 (0.03 from 0.53); out lands at 1.5 (0.05 from 1.45).
    const snap = snapBarMoveDelta(0.5, windows, [0.53, 1.45], 0.1);
    expect(snap.delta).toBeCloseTo(0.53);
    expect(snap.guide).toBe(0.53);
  });

  it("returns the delta untouched when nothing is in range", () => {
    const snap = snapBarMoveDelta(0.5, windows, [10], 0.1);
    expect(snap.delta).toBeCloseTo(0.5);
    expect(snap.guide).toBeNull();
  });
});

describe("snapEdgeTime", () => {
  it("locks the edge onto the nearest target in range", () => {
    const snap = snapEdgeTime(1.94, [2, 1.8], 0.1);
    expect(snap.time).toBe(2);
    expect(snap.guide).toBe(2);
  });

  it("passes the time through when out of range", () => {
    const snap = snapEdgeTime(1, [2], 0.1);
    expect(snap.time).toBe(1);
    expect(snap.guide).toBeNull();
  });
});
