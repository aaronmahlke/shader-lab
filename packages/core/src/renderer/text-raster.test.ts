import { describe, expect, it } from "bun:test";
import { charProgress, drawTextSpec, isTextAnimated, textCacheKey, textSpecFromValues } from "./text-raster";
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

describe("text animators", () => {
  const base = textSpecFromValues(buildLayerValues("text"));

  it("defaults resolve to the static fast path", () => {
    expect(base.animProgress).toBe(1);
    expect(isTextAnimated(base)).toBe(false);
  });

  it("charProgress staggers characters across the window", () => {
    // stagger 0: all chars share the same progress
    expect(charProgress(0.5, 0, 4, 0)).toBeCloseTo(charProgress(0.5, 3, 4, 0));
    // stagger 0.5: first char finishes before the last starts moving much
    expect(charProgress(0.5, 0, 10, 0.5)).toBe(1);
    expect(charProgress(0.5, 9, 10, 0.5)).toBe(0);
    // fully in at progress 1 regardless
    expect(charProgress(1, 9, 10, 0.9)).toBe(1);
  });

  it("draws per character when animating, per line when not", () => {
    const calls: string[] = [];
    const ctx = {
      font: "", fillStyle: "", textAlign: "", textBaseline: "", globalAlpha: 1, letterSpacing: "",
      clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
      measureText: () => ({ width: 10 }),
      fillText(text: string) { calls.push(text); },
    };
    const spec = { ...base, content: "ab cd" };
    drawTextSpec(ctx, spec, 400, 300, 1);
    expect(calls).toEqual(["ab cd"]); // fast path: one line

    calls.length = 0;
    drawTextSpec(ctx, { ...spec, animProgress: 0.9 }, 400, 300, 1);
    expect(calls).toEqual(["a", "b", "c", "d"]); // per char, space skipped
  });

  it("hides characters entirely at progress 0 with full stagger window", () => {
    const calls: string[] = [];
    const ctx = {
      font: "", fillStyle: "", textAlign: "", textBaseline: "", globalAlpha: 1, letterSpacing: "",
      clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
      measureText: () => ({ width: 10 }),
      fillText(text: string) { calls.push(text); },
    };
    drawTextSpec(ctx, { ...base, content: "abc", animProgress: 0 }, 400, 300, 1);
    expect(calls).toEqual([]); // every char at t=0 -> nothing drawn
  });
});
