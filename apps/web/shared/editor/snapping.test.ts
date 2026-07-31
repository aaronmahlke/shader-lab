import { describe, expect, it } from "bun:test";
import { collectSnapTargets, findSnap } from "./snapping";
import { layerBoundsInCompUv, type LayerTransformValues } from "./layer-transform";
import type { LayerInstance } from "@shader-lab/core";

const IDENTITY: LayerTransformValues = {
  positionX: 0,
  positionY: 0,
  scale: 100,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
};

describe("layerBoundsInCompUv", () => {
  it("gives the unit square at identity", () => {
    const b = layerBoundsInCompUv(IDENTITY, 16 / 9);
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(1);
    expect(b.centerX).toBeCloseTo(0.5);
    expect(b.centerY).toBeCloseTo(0.5);
  });

  it("tracks scale and position", () => {
    const b = layerBoundsInCompUv({ ...IDENTITY, scale: 50, positionX: 0.1 }, 1);
    expect(b.minX).toBeCloseTo(0.35);
    expect(b.maxX).toBeCloseTo(0.85);
    expect(b.minY).toBeCloseTo(0.25);
  });

  it("expands for rotated layers (AABB)", () => {
    const b = layerBoundsInCompUv({ ...IDENTITY, scale: 50, rotation: 45 }, 1);
    expect(b.maxX - b.minX).toBeCloseTo(Math.SQRT2 / 2, 3);
  });
});

describe("findSnap", () => {
  it("picks the closest target within the threshold", () => {
    const hit = findSnap([0.48, 0.98], [0.5, 1], 0.03);
    expect(hit).not.toBeNull();
    expect(hit!.delta).toBeCloseTo(0.02);
    expect(hit!.target).toBe(0.5);
  });

  it("returns null when everything is out of range", () => {
    expect(findSnap([0.3], [0.5, 1], 0.05)).toBeNull();
  });

  it("prefers the smallest correction", () => {
    const hit = findSnap([0.495, 0.09], [0.5, 0.1], 0.02);
    expect(hit!.target).toBe(0.5);
  });
});

describe("collectSnapTargets", () => {
  const solid = (id: string, values: Record<string, unknown>): LayerInstance => ({
    id,
    type: "solid",
    enabled: true,
    values,
  });

  const getTransform = (layer: LayerInstance): LayerTransformValues => ({
    positionX: (layer.values.layerPositionX as number) ?? 0,
    positionY: (layer.values.layerPositionY as number) ?? 0,
    scale: (layer.values.layerScale as number) ?? 100,
    rotation: (layer.values.layerRotation as number) ?? 0,
    anchorX: 0.5,
    anchorY: 0.5,
  });

  it("includes frame lines and other layers, excludes the dragged one", () => {
    const layers = [
      solid("dragging", { layerScale: 50 }),
      solid("other", { layerScale: 50, layerPositionX: 0.2 }),
    ];
    const targets = collectSnapTargets(layers, "dragging", 1, getTransform);
    expect(targets.x).toContain(0.5); // frame center
    expect(targets.x.some((v) => Math.abs(v - 0.45) < 1e-9)).toBe(true); // other minX
    expect(targets.x.some((v) => Math.abs(v - 0.7) < 1e-9)).toBe(true); // other centerX
    // dragging layer's own bounds (0.25/0.75) only exist via frame/other coincidences
    expect(targets.x.filter((v) => Math.abs(v - 0.25) < 1e-9)).toHaveLength(0);
  });

  it("skips disabled layers", () => {
    const layers = [solid("other", { layerScale: 50 })];
    layers[0]!.enabled = false;
    const targets = collectSnapTargets(layers, null, 1, getTransform);
    expect(targets.x).toEqual([0, 0.5, 1]);
  });
});
