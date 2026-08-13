import { describe, expect, it } from "bun:test";
import { compilePasses, compositePassId } from "./compile-passes";
import { buildLayerValues } from "./build-layer-values";
import { normalizeUniversalLayerProps } from "./normalize-composite-layers";
import {
  buildUniversalUniforms,
  layerTimingFactor,
  universalUniformsFor,
  findLayerParamDef,
  isUniversalParamName,
  UNIVERSAL_LAYER_UNIFORMS,
} from "./universal-uniforms";
import type { LayerInstance } from "../types/editor";

function makeLayer(type: LayerInstance["type"], id: string, extra?: Partial<LayerInstance>): LayerInstance {
  return { id, type, enabled: true, values: buildLayerValues(type), ...extra };
}

describe("universal layer uniforms", () => {
  it("seeds universal defaults in new layer values", () => {
    const values = buildLayerValues("gradient");
    expect(values.layerOpacity).toBe(100);
    expect(values.layerPositionX).toBe(0);
    expect(values.layerScale).toBe(100);
    expect(values.layerAnchorX).toBe(0.5);
  });

  it("gives generators the full transform set and effects opacity only", () => {
    expect(universalUniformsFor({ type: "gradient" }).map((d) => d.name)).toContain("layerRotation");
    expect(universalUniformsFor({ type: "waveFill" }).map((d) => d.name)).toContain("layerPositionX");
    expect(universalUniformsFor({ type: "vignette" }).map((d) => d.name)).toEqual(["layerOpacity"]);
    expect(universalUniformsFor({ type: "distortion" }).map((d) => d.name)).toEqual(["layerOpacity"]);
  });

  it("finds universal and template defs by param name", () => {
    expect(findLayerParamDef({ type: "gradient" }, "layerOpacity")?.label).toBe("Opacity");
    expect(findLayerParamDef({ type: "gradient" }, "angle")?.label).toBeDefined();
    expect(findLayerParamDef({ type: "gradient" }, "nope")).toBeUndefined();
    expect(isUniversalParamName("layerScale")).toBe(true);
    expect(isUniversalParamName("angle")).toBe(false);
  });

  it("evaluates universal uniforms through the modulation fn (keyframes/LFO)", () => {
    const layer = makeLayer("solid", "solid-1");
    layer.values.layerOpacity = 80;
    const modFn = (layerId: string, paramName: string, base: number) =>
      paramName === "layerOpacity" ? base / 2 : base;
    const uniforms = buildUniversalUniforms(layer, modFn);
    expect(uniforms.layerOpacity).toBe(40);
    expect(uniforms.layerScale).toBe(100);
  });
});

describe("layerTimingFactor", () => {
  it("is 1 without timing and inside the window, 0 outside", () => {
    const layer = makeLayer("solid", "solid-1");
    expect(layerTimingFactor(layer, 2)).toBe(1);

    layer.timing = { in: 1, out: 3 };
    expect(layerTimingFactor(layer, 0.5)).toBe(0);
    expect(layerTimingFactor(layer, 1)).toBe(1);
    expect(layerTimingFactor(layer, 2.9)).toBe(1);
    expect(layerTimingFactor(layer, 3)).toBe(0);
  });

  it("treats missing bounds as open", () => {
    const layer = makeLayer("solid", "solid-1", { timing: { in: 1 } });
    expect(layerTimingFactor(layer, 0)).toBe(0);
    expect(layerTimingFactor(layer, 100)).toBe(1);
  });
});

describe("compilePasses with composite passes", () => {
  it("emits a layerComposite pass after each generator", () => {
    const layers = [makeLayer("gradient", "gradient-1")];
    const passes = compilePasses(layers);

    const content = passes.find((p) => p.layerId === "gradient-1");
    const composite = passes.find((p) => p.layerType === "layerComposite");
    expect(content?.inputLayerId).toBeNull();
    expect(composite?.layerId).toBe(compositePassId("gradient-1"));
    expect(composite?.colorSourceLayerId).toBe("gradient-1");
    expect(composite?.sourceLayerId).toBe("gradient-1");
    expect(composite?.inputLayerId).toBeNull(); // bottom layer → black

    // Final blit reads from the composite result.
    expect(passes.at(-1)?.layerType).toBe("blit");
    expect(passes.at(-1)?.inputLayerId).toBe(compositePassId("gradient-1"));
  });

  it("chains generators through their composite passes", () => {
    // UI order: top first → wave above gradient.
    const layers = [makeLayer("waveFill", "wave-1"), makeLayer("gradient", "gradient-1")];
    const passes = compilePasses(layers);

    const waveContent = passes.find((p) => p.layerId === "wave-1");
    const waveComposite = passes.find((p) => p.layerId === compositePassId("wave-1"));
    expect(waveContent?.inputLayerId).toBeNull(); // wave content no longer reads the stack
    expect(waveComposite?.inputLayerId).toBe(compositePassId("gradient-1"));
  });

  it("feeds effects from the previous composite result", () => {
    const layers = [makeLayer("vignette", "vignette-1"), makeLayer("solid", "solid-1")];
    const passes = compilePasses(layers);

    const effect = passes.find((p) => p.layerId === "vignette-1");
    expect(effect?.inputLayerId).toBe(compositePassId("solid-1"));
    expect(effect?.uniforms.layerOpacity).toBe(100);
  });

  it("builds universal uniforms into the composite pass", () => {
    const layer = makeLayer("solid", "solid-1");
    layer.values.layerPositionX = 0.25;
    layer.values.layerOpacity = 50;
    const passes = compilePasses([layer]);
    const composite = passes.find((p) => p.layerType === "layerComposite");
    expect(composite?.uniforms.layerPositionX).toBe(0.25);
    expect(composite?.uniforms.layerOpacity).toBe(50);
    expect(composite?.uniforms.layerAnchorY).toBe(0.5);
  });

  it("scales distortion amplitude by layer opacity", () => {
    const distortion = makeLayer("distortion", "distortion-1");
    distortion.values.amplitude = 0.4;
    distortion.values.layerOpacity = 50;
    const passes = compilePasses([distortion, makeLayer("solid", "solid-1")]);
    const distortionPass = passes.find((p) => p.layerId === "distortion-1");
    expect(distortionPass?.uniforms.amplitude).toBeCloseTo(0.2);
  });
});

describe("normalizeUniversalLayerProps", () => {
  it("backfills missing universal values on old documents", () => {
    const layer: LayerInstance = { id: "g", type: "gradient", enabled: true, values: {} };
    normalizeUniversalLayerProps(layer, 5);
    for (const def of UNIVERSAL_LAYER_UNIFORMS) {
      expect(layer.values[def.name]).toBe(def.default);
    }
  });

  it("sanitizes reversed timing and preserves overhang", () => {
    const layer: LayerInstance = {
      id: "g", type: "gradient", enabled: true, values: {},
      timing: { in: 4, out: -1 },
    };
    normalizeUniversalLayerProps(layer, 5);
    // swapped; the negative in survives as left overhang, out capped only by
    // the minimum-overlap rule (must stay > 0)
    expect(layer.timing).toEqual({ in: -1, out: 4 });

    const full: LayerInstance = {
      id: "g2", type: "gradient", enabled: true, values: {},
      timing: { in: 0, out: 99 },
    };
    normalizeUniversalLayerProps(full, 5);
    // in === 0 is dropped; out past the end survives as right overhang
    expect(full.timing).toEqual({ out: 99 });

    const exact: LayerInstance = {
      id: "g3", type: "gradient", enabled: true, values: {},
      timing: { in: 0, out: 5 },
    };
    normalizeUniversalLayerProps(exact, 5);
    expect(exact.timing).toBeUndefined(); // exactly-full window collapses to none
  });
});
