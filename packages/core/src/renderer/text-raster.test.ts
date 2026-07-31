import { describe, expect, it } from "bun:test";
import { drawTextSpec, textCacheKey, textSpecFromValues } from "./text-raster";
import { compilePasses, compositePassId } from "../compiler/compile-passes";
import { buildLayerValues } from "../compiler/build-layer-values";

describe("textSpecFromValues", () => {
  it("resolves defaults for missing values", () => {
    const spec = textSpecFromValues({});
    expect(spec.content).toBe("");
    expect(spec.fontSize).toBe(160);
    expect(spec.textAlign).toBe("center");
  });

  it("reads template values", () => {
    const spec = textSpecFromValues(buildLayerValues("text"));
    expect(spec.content).toBe("Hello");
    expect(spec.fontWeight).toBe(600);
    expect(spec.color).toBe("#ffffff");
  });
});

describe("textCacheKey", () => {
  it("changes when the spec or size changes", () => {
    const spec = textSpecFromValues(buildLayerValues("text"));
    const a = textCacheKey(spec, 100, 100);
    expect(textCacheKey(spec, 100, 100)).toBe(a);
    expect(textCacheKey({ ...spec, content: "Hi" }, 100, 100)).not.toBe(a);
    expect(textCacheKey(spec, 200, 100)).not.toBe(a);
  });
});

describe("text layer pass wiring", () => {
  it("compiles a content pass plus composite like any generator", () => {
    const layer = { id: "text-1", type: "text" as const, enabled: true, values: buildLayerValues("text") };
    const passes = compilePasses([layer]);
    const content = passes.find((p) => p.layerId === "text-1");
    const composite = passes.find((p) => p.layerId === compositePassId("text-1"));
    expect(content?.layerType).toBe("text");
    expect(content?.inputLayerId).toBeNull();
    expect(composite?.colorSourceLayerId).toBe("text-1");
    expect(content?.uniforms.content).toBe("Hello");
  });
});

describe("drawTextSpec", () => {
  function fakeCtx() {
    const calls: { text: string; x: number; y: number }[] = [];
    return {
      calls,
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      letterSpacing: "",
      clearRect() {},
      fillText(text: string, x: number, y: number) {
        calls.push({ text, x, y });
      },
    };
  }

  it("scales font size by contentScale and draws each line", () => {
    const ctx = fakeCtx();
    const spec = { ...textSpecFromValues(buildLayerValues("text")), content: "a\nb", fontSize: 100, lineHeight: 1.5 };
    drawTextSpec(ctx, spec, 400, 300, 0.5);
    expect(ctx.font).toContain("50px");
    expect(ctx.calls).toHaveLength(2);
    // lines centered vertically: total spread = fontPx * lineHeight = 75
    expect(ctx.calls[1]!.y - ctx.calls[0]!.y).toBeCloseTo(75);
    expect(ctx.calls[0]!.x).toBe(200); // centered
  });

  it("draws nothing for whitespace content", () => {
    const ctx = fakeCtx();
    drawTextSpec(ctx, { ...textSpecFromValues({}), content: "   " }, 100, 100, 1);
    expect(ctx.calls).toHaveLength(0);
  });

  it("left-aligns with padding", () => {
    const ctx = fakeCtx();
    const spec = { ...textSpecFromValues(buildLayerValues("text")), content: "x", fontSize: 100, textAlign: "left" as const };
    drawTextSpec(ctx, spec, 400, 300, 1);
    expect(ctx.calls[0]!.x).toBe(25); // fontPx * 0.25
  });
});
