import { describe, expect, it } from "bun:test";
import {
  clampBarMoveIn,
  clampGroupBarMoveDelta,
  fitPxPerSecond,
  minBarInside,
  parseCompositionDuration,
} from "./timeline-window";

describe("minBarInside", () => {
  it("uses 250ms for short bars", () => {
    expect(minBarInside(2)).toBeCloseTo(0.25);
  });

  it("uses 5% of the bar when that is larger", () => {
    expect(minBarInside(10)).toBeCloseTo(0.5);
  });

  it("never exceeds the bar itself", () => {
    expect(minBarInside(0.1)).toBeCloseTo(0.1);
  });
});

describe("clampBarMoveIn", () => {
  it("allows dragging past the composition end, keeping the minimum inside", () => {
    // 2s bar in a 5s comp: in may reach 5 - 0.25 = 4.75.
    expect(clampBarMoveIn(10, 2, 5)).toBeCloseTo(4.75);
  });

  it("allows dragging past 0, keeping the minimum inside", () => {
    // 2s bar: out must stay >= 0.25, so in >= -1.75.
    expect(clampBarMoveIn(-10, 2, 5)).toBeCloseTo(-1.75);
  });

  it("keeps ordinary moves untouched", () => {
    expect(clampBarMoveIn(1.5, 2, 5)).toBeCloseTo(1.5);
  });

  it("keeps tiny bars fully inside", () => {
    // 0.1s bar: minInside caps at the bar length, so in stays in [0, duration - length].
    expect(clampBarMoveIn(9, 0.1, 5)).toBeCloseTo(4.9);
    expect(clampBarMoveIn(-9, 0.1, 5)).toBeCloseTo(0);
  });
});

describe("clampGroupBarMoveDelta", () => {
  it("matches clampBarMoveIn for a single bar", () => {
    // 2s bar at in=1 in a 5s comp: in may reach 4.75, so delta caps at 3.75.
    expect(clampGroupBarMoveDelta(10, [{ in: 1, out: 3 }], 5)).toBeCloseTo(3.75);
    expect(clampGroupBarMoveDelta(-10, [{ in: 1, out: 3 }], 5)).toBeCloseTo(-2.75);
    expect(clampGroupBarMoveDelta(1, [{ in: 1, out: 3 }], 5)).toBeCloseTo(1);
  });

  it("stops the whole group when one bar hits its limit", () => {
    const windows = [
      { in: 0, out: 2 },
      { in: 3, out: 5 },
    ];
    // Right: the later bar caps first (in <= 4.75, delta <= 1.75).
    expect(clampGroupBarMoveDelta(10, windows, 5)).toBeCloseTo(1.75);
    // Left: the earlier bar caps first (in >= -1.75, delta >= -1.75).
    expect(clampGroupBarMoveDelta(-10, windows, 5)).toBeCloseTo(-1.75);
  });

  it("keeps relative offsets by never clamping bars individually", () => {
    const windows = [
      { in: 0, out: 1 },
      { in: 4, out: 5 },
    ];
    const delta = clampGroupBarMoveDelta(3, windows, 5);
    // One shared delta: both bars move by the same amount.
    expect(delta).toBeCloseTo(0.75);
  });

  it("leaves the delta unchanged with no windows", () => {
    expect(clampGroupBarMoveDelta(5, [], 5)).toBeCloseTo(5);
  });

  it("returns 0 when the constraints conflict", () => {
    // After shrinking a comp, one overhanging bar must move right and the
    // other left to satisfy the minimum-inside rule; do not move at all.
    const pinned = [
      { in: -10, out: 0.5 },
      { in: 0.5, out: 11 },
    ];
    expect(clampGroupBarMoveDelta(3, pinned, 1)).toBeCloseTo(0);
  });
});

describe("fitPxPerSecond", () => {
  it("fills the available width exactly", () => {
    expect(fitPxPerSecond(500, 5, 16, 640)).toBeCloseTo(100);
  });

  it("respects the zoom bounds", () => {
    expect(fitPxPerSecond(10, 5, 16, 640)).toBe(16);
    expect(fitPxPerSecond(10000, 5, 16, 640)).toBe(640);
  });

  it("returns null for unusable inputs", () => {
    expect(fitPxPerSecond(0, 5, 16, 640)).toBeNull();
    expect(fitPxPerSecond(500, 0, 16, 640)).toBeNull();
    expect(fitPxPerSecond(Number.NaN, 5, 16, 640)).toBeNull();
  });
});

describe("parseCompositionDuration", () => {
  it("parses plain and decimal seconds", () => {
    expect(parseCompositionDuration("8")).toBe(8);
    expect(parseCompositionDuration("7.5")).toBe(7.5);
    expect(parseCompositionDuration("7,5")).toBe(7.5);
  });

  it("clamps to the sane range", () => {
    expect(parseCompositionDuration("0.2")).toBe(1);
    expect(parseCompositionDuration("9999")).toBe(300);
  });

  it("rejects garbage", () => {
    expect(parseCompositionDuration("abc")).toBeNull();
    expect(parseCompositionDuration("")).toBeNull();
  });
});
