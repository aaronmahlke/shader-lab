import { describe, expect, it } from "bun:test";
import { compilePasses } from "./compile-passes";
import { ModulationEngine } from "../modulation/engine";
import { buildLayerValues } from "./build-layer-values";
import { migrateDiffuseValues, normalizeCompositeLayer } from "./normalize-composite-layers";
import { cloneMeshPoints, MESH_BLOOM_POINTS } from "./mesh-uniforms";
import type { CompositionConfig } from "../types/composition";

const sampleConfig: CompositionConfig = {
  version: 1,
  layers: [
    {
      id: "gradient-1",
      type: "gradient",
      enabled: true,
      values: buildLayerValues("gradient"),
    },
  ],
  lfos: [],
  assignments: [],
};

describe("compilePasses", () => {
  it("compiles a single gradient layer", () => {
    const passes = compilePasses(sampleConfig.layers);
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.at(-1)?.isOutput).toBe(true);
  });

  it("compiles mesh layer with point uniforms", () => {
    const layers = [
      {
        id: "mesh-1",
        type: "mesh" as const,
        enabled: true,
        values: {
          ...buildLayerValues("mesh"),
          u_meshPoints: cloneMeshPoints(MESH_BLOOM_POINTS),
        },
      },
    ];
    const passes = compilePasses(layers);
    const meshPass = passes.find((p) => p.layerType === "mesh");
    expect(meshPass?.uniforms.u_pointCount).toBe(6);
    expect(meshPass?.uniforms.u_pos0).toEqual([0.08, 0.9]);
  });

  it("compiles diffuse effect pass on top of composite stack", () => {
    const layers = [
      {
        id: "diffuse-1",
        type: "diffuse" as const,
        enabled: true,
        values: buildLayerValues("diffuse"),
      },
      {
        id: "wave-1",
        type: "waveFill" as const,
        enabled: true,
        values: buildLayerValues("waveFill"),
      },
      {
        id: "band-1",
        type: "bandFill" as const,
        enabled: true,
        values: buildLayerValues("bandFill"),
      },
    ];
    const passes = compilePasses(layers);
    expect(passes.some((p) => p.layerType === "diffuse")).toBe(true);
    expect(passes.some((p) => p.layerId === "wave-1:stipple")).toBe(false);
    expect(passes.find((p) => p.layerId === "wave-1")?.layerType).toBe("waveFill");
    expect(passes.find((p) => p.layerId === "band-1")?.layerType).toBe("bandFill");
  });
});

describe("normalizeCompositeLayer", () => {
  it("backfills empty mesh points", () => {
    const layer = {
      id: "mesh-1",
      type: "mesh" as const,
      enabled: true,
      values: { u_meshPoints: [] },
    };
    normalizeCompositeLayer(layer);
    expect((layer.values.u_meshPoints as unknown[]).length).toBeGreaterThan(0);
  });

  it("migrates legacy hybridDissolve layers to diffuse", () => {
    const layer = {
      id: "hybrid-1",
      type: "hybridDissolve" as const,
      enabled: true,
      values: {
        grainMix: 0.41,
        dissolveSpeed: 0.5,
        seed: 12,
      },
    };
    normalizeCompositeLayer(layer);
    expect(layer.type).toBe("diffuse");
    expect(layer.values.amount).toBe(14);
    expect(layer.values.grainHard).toBe(1);
    expect(layer.values.animate).toBe(true);
  });

  it("migrates legacy diffuse uniform scale to scatter params", () => {
    const values = {
      amount: 0.18,
      blend: 0.55,
      grain: 0.42,
      direction: 180,
      speed: 0.35,
      seed: 0,
    };
    migrateDiffuseValues(values);
    expect(values.amount).toBe(18);
    expect(values.grainHard).toBe(0.42);
    expect(values.direction).toBe(50);
    expect(values.animate).toBe(true);
    expect(values.blend).toBeUndefined();
    expect(values.grain).toBeUndefined();
    expect(values.speed).toBeUndefined();
    expect(values.seed).toBeUndefined();
  });
});

describe("ModulationEngine", () => {
  it("returns base value when no assignment exists", () => {
    const engine = new ModulationEngine();
    engine.setLfos([]);
    engine.setAssignments([]);
    engine.sampleAt(0);
    expect(engine.getModulatedValue("layer-1", "speed", 0.5)).toBe(0.5);
  });
});
