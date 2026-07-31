import { describe, expect, it } from "bun:test";
import {
  angleAroundCenter,
  compToLayerUv,
  compUvToScreen,
  isPointInLayer,
  layerCornersInCompUv,
  layerToCompUv,
  screenToCompUv,
  shortestAngleDelta,
  transformCenter,
  type LayerTransformValues,
} from "./layer-transform";

const IDENTITY: LayerTransformValues = {
  positionX: 0,
  positionY: 0,
  scale: 100,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
};

function v(overrides: Partial<LayerTransformValues>): LayerTransformValues {
  return { ...IDENTITY, ...overrides };
}

describe("layerToCompUv", () => {
  it("is the identity at default transform", () => {
    for (const luv of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.25, y: 0.75 }]) {
      const uv = layerToCompUv(luv, IDENTITY, 16 / 9);
      expect(uv.x).toBeCloseTo(luv.x);
      expect(uv.y).toBeCloseTo(luv.y);
    }
  });

  it("applies position as a direct offset", () => {
    const uv = layerToCompUv({ x: 0.5, y: 0.5 }, v({ positionX: 0.25, positionY: -0.1 }), 1);
    expect(uv.x).toBeCloseTo(0.75);
    expect(uv.y).toBeCloseTo(0.4);
  });

  it("scales about the anchor", () => {
    const corners = layerCornersInCompUv(v({ scale: 50 }), 1);
    expect(corners[0]!.x).toBeCloseTo(0.25); // bl
    expect(corners[0]!.y).toBeCloseTo(0.25);
    expect(corners[2]!.x).toBeCloseTo(0.75); // tr
    expect(corners[2]!.y).toBeCloseTo(0.75);
  });

  it("rotates clockwise on screen for positive angles (square aspect)", () => {
    // Content bottom-left should land at the top-left after +90° (clockwise).
    const uv = layerToCompUv({ x: 0, y: 0 }, v({ rotation: 90 }), 1);
    expect(uv.x).toBeCloseTo(0);
    expect(uv.y).toBeCloseTo(1);
  });

  it("keeps rotated points at the same aspect-corrected radius", () => {
    const aspect = 2;
    const before = layerToCompUv({ x: 1, y: 0.5 }, IDENTITY, aspect);
    const after = layerToCompUv({ x: 1, y: 0.5 }, v({ rotation: 37 }), aspect);
    const r = (uv: { x: number; y: number }) =>
      Math.hypot((uv.x - 0.5) * aspect, uv.y - 0.5);
    expect(r(after)).toBeCloseTo(r(before));
  });

  it("rotates about the offset center when position is set", () => {
    const values = v({ positionX: 0.2, rotation: 180 });
    const center = transformCenter(values);
    expect(center.x).toBeCloseTo(0.7);
    const uv = layerToCompUv({ x: 0.5, y: 0.5 }, values, 1);
    expect(uv.x).toBeCloseTo(0.7); // anchor stays at the center
    expect(uv.y).toBeCloseTo(0.5);
  });
});

describe("compToLayerUv", () => {
  it("round-trips with the forward map under arbitrary transforms", () => {
    const values = v({ positionX: 0.2, positionY: -0.1, scale: 65, rotation: 33, anchorX: 0.4 });
    const aspect = 1.9;
    for (const luv of [{ x: 0.1, y: 0.9 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }]) {
      const uv = layerToCompUv(luv, values, aspect);
      const back = compToLayerUv(uv, values, aspect);
      expect(back.x).toBeCloseTo(luv.x);
      expect(back.y).toBeCloseTo(luv.y);
    }
  });

  it("hit-tests transformed bounds", () => {
    const values = v({ scale: 50 });
    expect(isPointInLayer({ x: 0.5, y: 0.5 }, values, 1)).toBe(true);
    expect(isPointInLayer({ x: 0.1, y: 0.1 }, values, 1)).toBe(false);
  });
});

describe("screen mapping", () => {
  it("round-trips and flips y", () => {
    const p = compUvToScreen({ x: 0.25, y: 0.9 }, 800, 400);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(40); // near the top
    const uv = screenToCompUv(p, 800, 400);
    expect(uv.x).toBeCloseTo(0.25);
    expect(uv.y).toBeCloseTo(0.9);
  });
});

describe("angleAroundCenter", () => {
  it("is 0 to the right and +90 below on screen (clockwise-positive)", () => {
    expect(angleAroundCenter({ x: 1, y: 0.5 }, IDENTITY, 1)).toBeCloseTo(0);
    // Below the center on screen = smaller GL y.
    expect(angleAroundCenter({ x: 0.5, y: 0 }, IDENTITY, 1)).toBeCloseTo(90);
    expect(angleAroundCenter({ x: 0.5, y: 1 }, IDENTITY, 1)).toBeCloseTo(-90);
  });
});

describe("shortestAngleDelta", () => {
  it("wraps to the shortest signed distance", () => {
    expect(shortestAngleDelta(350)).toBeCloseTo(-10);
    expect(shortestAngleDelta(-350)).toBeCloseTo(10);
    expect(shortestAngleDelta(180)).toBeCloseTo(180);
    expect(shortestAngleDelta(10)).toBeCloseTo(10);
  });
});
