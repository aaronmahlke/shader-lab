import { describe, expect, it } from "bun:test";
import { compilePasses, compositePassId } from "./compile-passes";
import { buildLayerValues } from "./build-layer-values";

describe("shape layer", () => {
  it("seeds defaults including universal transforms", () => {
    const values = buildLayerValues("shape");
    expect(values.shape).toBe(0);
    expect(values.shapeWidth).toBe(0.5);
    expect(values.layerOpacity).toBe(100);
  });

  it("compiles as a generator with a composite pass", () => {
    const layer = { id: "shape-1", type: "shape" as const, enabled: true, values: buildLayerValues("shape") };
    const passes = compilePasses([layer]);
    const content = passes.find((p) => p.layerId === "shape-1");
    const composite = passes.find((p) => p.layerId === compositePassId("shape-1"));
    expect(content?.layerType).toBe("shape");
    expect(content?.inputLayerId).toBeNull();
    expect(composite?.sourceLayerId).toBe("shape-1");
  });
});
