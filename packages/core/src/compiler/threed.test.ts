import { describe, expect, it } from "bun:test";
import { find3DRuns, threeDGroupMemberIds } from "./threed";
import {
  buildUniversalUniforms,
  isLayer3D,
  supports3D,
  universalUniformsFor,
} from "./universal-uniforms";
import type { LayerInstance } from "../types/editor";

function layer(
  id: string,
  type: LayerInstance["type"],
  overrides: Partial<LayerInstance> = {},
): LayerInstance {
  return { id, type, enabled: true, values: {}, ...overrides };
}

describe("3D switch", () => {
  it("only generators support the 3D switch", () => {
    expect(supports3D({ type: "solid" })).toBe(true);
    expect(supports3D({ type: "gradient" })).toBe(true);
    expect(supports3D({ type: "vignette" })).toBe(false);
    expect(supports3D({ type: "distortion" })).toBe(false);
    expect(supports3D({ type: "camera" })).toBe(false);
  });

  it("isLayer3D requires both the flag and generator category", () => {
    expect(isLayer3D({ type: "solid", is3D: true })).toBe(true);
    expect(isLayer3D({ type: "solid" })).toBe(false);
    expect(isLayer3D({ type: "vignette", is3D: true })).toBe(false);
  });

  it("universalUniformsFor adds Z/X/Y only when the switch is on", () => {
    const names2d = universalUniformsFor({ type: "solid" }).map((d) => d.name);
    expect(names2d).not.toContain("layerPositionZ");
    expect(names2d).not.toContain("layerRotationX");

    const names3d = universalUniformsFor({ type: "solid", is3D: true }).map((d) => d.name);
    expect(names3d).toContain("layerPositionZ");
    expect(names3d).toContain("layerRotationX");
    expect(names3d).toContain("layerRotationY");
    // Z position sits right after X/Y in the AE-style display order.
    expect(names3d.indexOf("layerPositionZ")).toBe(names3d.indexOf("layerPositionY") + 1);
    // Base rotation is relabeled to make room for X/Y rotation.
    const rotation = universalUniformsFor({ type: "solid", is3D: true }).find(
      (d) => d.name === "layerRotation",
    );
    expect(rotation?.label).toBe("Rotation Z");
  });

  it("buildUniversalUniforms always evaluates 3D values (2D shader ignores them)", () => {
    const l = layer("a", "solid", { values: { layerPositionZ: 0.5, layerRotationX: 45 } });
    const uniforms = buildUniversalUniforms(l, null);
    expect(uniforms.layerPositionZ).toBe(0.5);
    expect(uniforms.layerRotationX).toBe(45);
    expect(uniforms.layerRotationY).toBe(0);
  });
});

describe("find3DRuns", () => {
  it("groups contiguous 3D generators and splits on 2D walls", () => {
    const layers = [
      layer("a", "solid", { is3D: true }),
      layer("b", "gradient", { is3D: true }),
      layer("wall", "solid"),
      layer("c", "noise", { is3D: true }),
    ];
    const runs = find3DRuns(layers);
    expect(runs.length).toBe(2);
    expect(runs[0]!.layerIds).toEqual(["a", "b"]);
    expect(runs[1]!.layerIds).toEqual(["c"]);
  });

  it("disabled layers are neutral: they neither join nor break a run", () => {
    const layers = [
      layer("a", "solid", { is3D: true }),
      layer("off", "solid", { enabled: false }),
      layer("b", "gradient", { is3D: true }),
    ];
    const runs = find3DRuns(layers);
    expect(runs.length).toBe(1);
    expect(runs[0]!.layerIds).toEqual(["a", "b"]);
  });

  it("effects and cameras break runs (they are not 3D members)", () => {
    const layers = [
      layer("a", "solid", { is3D: true }),
      layer("lens", "camera"),
      layer("b", "gradient", { is3D: true }),
    ];
    expect(find3DRuns(layers).length).toBe(2);
  });

  it("a lone 3D layer forms a run of one", () => {
    const runs = find3DRuns([layer("a", "solid", { is3D: true })]);
    expect(runs.length).toBe(1);
    expect(runs[0]!.layerIds).toEqual(["a"]);
  });

  it("threeDGroupMemberIds collects every run member", () => {
    const ids = threeDGroupMemberIds([
      layer("a", "solid", { is3D: true }),
      layer("wall", "solid"),
      layer("b", "noise", { is3D: true }),
    ]);
    expect(ids).toEqual(new Set(["a", "b"]));
  });
});