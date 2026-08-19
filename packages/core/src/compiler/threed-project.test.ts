import { describe, expect, it } from "bun:test";
import {
  projectLayerQuad,
  projectStagePoint,
  pointInProjectedQuad,
  projectObjectBounds,
  drivingCameraIdFor,
  threeDTransformFromValues,
} from "./threed-project";
import { IDENTITY_VIEW } from "../renderer/threed-order";
import type { LayerInstance } from "../types/editor";

const identityT = threeDTransformFromValues({});

describe("projectLayerQuad", () => {
  it("identity transform + identity view = the full frame", () => {
    const quad = projectLayerQuad(identityT, IDENTITY_VIEW, 16 / 9)!;
    expect(quad[0]!.x).toBeCloseTo(0, 5);
    expect(quad[0]!.y).toBeCloseTo(0, 5);
    expect(quad[2]!.x).toBeCloseTo(1, 5);
    expect(quad[2]!.y).toBeCloseTo(1, 5);
  });

  it("matches the 2D rect for scale + position at z=0", () => {
    const t = { ...identityT, scale: 50, posX: 0.1, posY: -0.05 };
    const quad = projectLayerQuad(t, IDENTITY_VIEW, 1)!;
    // center uv = (0.6, 0.45), half extent 0.25
    expect(quad[0]!.x).toBeCloseTo(0.35, 5);
    expect(quad[0]!.y).toBeCloseTo(0.2, 5);
    expect(quad[2]!.x).toBeCloseTo(0.85, 5);
    expect(quad[2]!.y).toBeCloseTo(0.7, 5);
  });

  it("positive z grows the quad (closer to camera)", () => {
    const near = projectLayerQuad({ ...identityT, scale: 50, posZ: 0.4 }, IDENTITY_VIEW, 1)!;
    const flat = projectLayerQuad({ ...identityT, scale: 50 }, IDENTITY_VIEW, 1)!;
    const width = (q: typeof near) => q[1]!.x - q[0]!.x;
    expect(width(near)).toBeGreaterThan(width(flat));
  });

  it("yaw foreshortens one side", () => {
    const quad = projectLayerQuad({ ...identityT, scale: 60, rotY: 40 }, IDENTITY_VIEW, 1)!;
    const leftHeight = Math.abs(quad[3]!.y - quad[0]!.y);
    const rightHeight = Math.abs(quad[2]!.y - quad[1]!.y);
    expect(Math.abs(leftHeight - rightHeight)).toBeGreaterThan(0.01);
  });

  it("returns null when the layer goes behind the camera", () => {
    expect(projectLayerQuad({ ...identityT, posZ: 2 }, IDENTITY_VIEW, 1)).toBeNull();
  });
});

describe("pointInProjectedQuad", () => {
  it("hits inside, misses outside", () => {
    const quad = projectLayerQuad({ ...identityT, scale: 50 }, IDENTITY_VIEW, 1)!;
    expect(pointInProjectedQuad(0.5, 0.5, quad)).toBe(true);
    expect(pointInProjectedQuad(0.1, 0.1, quad)).toBe(false);
  });
});

describe("projectStagePoint", () => {
  it("frame center at z=0 projects to uv center", () => {
    const p = projectStagePoint([0, 0, 0], IDENTITY_VIEW, 1)!;
    expect(p.x).toBeCloseTo(0.5, 5);
    expect(p.y).toBeCloseTo(0.5, 5);
  });
});

describe("projectObjectBounds", () => {
  it("returns a screen box containing the projected corners", () => {
    const quad = projectObjectBounds(
      identityT,
      { x: 0.25, y: 0.25, z: 0.25 },
      IDENTITY_VIEW,
      1,
    )!;
    expect(quad[0]!.x).toBeLessThan(0.5);
    expect(quad[2]!.x).toBeGreaterThan(0.5);
    expect(quad[0]!.x).toBeLessThan(quad[2]!.x);
  });
});

describe("drivingCameraIdFor", () => {
  const layer = (id: string, type: LayerInstance["type"], values: Record<string, unknown> = {}, is3D = false): LayerInstance =>
    ({ id, type, enabled: true, is3D, values });

  it("finds the nearest driving camera above the group", () => {
    const layers = [
      layer("cam", "camera", { drive3d: true }),
      layer("a", "solid", {}, true),
    ];
    expect(drivingCameraIdFor(layers, "a")).toBe("cam");
  });

  it("a non-driving camera blocks; non-members return null", () => {
    const layers = [
      layer("cam2", "camera", { drive3d: true }),
      layer("cam1", "camera", { drive3d: false }),
      layer("a", "solid", {}, true),
      layer("flat", "solid"),
    ];
    expect(drivingCameraIdFor(layers, "a")).toBe(null);
    expect(drivingCameraIdFor(layers, "flat")).toBe(null);
  });
});
