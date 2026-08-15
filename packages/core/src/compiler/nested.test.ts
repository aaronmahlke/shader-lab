import { describe, expect, it } from "bun:test";
import { compilePasses, compositePassId, NESTED_SEP } from "./compile-passes";
import { createNestedResolvers } from "./nested";
import type { CompositionConfig } from "../types/composition";
import type { LayerInstance, RenderPass } from "../types/editor";

function layer(
  id: string,
  type: LayerInstance["type"],
  overrides: Partial<LayerInstance> = {},
): LayerInstance {
  return { id, type, enabled: true, values: {}, ...overrides };
}

function comp(layers: LayerInstance[], extra: Partial<CompositionConfig> = {}): CompositionConfig {
  return { version: 1, layers, lfos: [], assignments: [], ...extra };
}

const compRef = (id: string, ref: string, overrides: Partial<LayerInstance> = {}) =>
  layer(id, "composition", { ...overrides, values: { compRefId: ref, ...(overrides.values ?? {}) } });

describe("nested composition compilation", () => {
  const nestedComp = comp([layer("inner", "solid")]);
  const registry: Record<string, CompositionConfig> = { compB: nestedComp };
  const resolveComposition = (id: string) => registry[id] ?? null;

  it("expands a composition layer into prefixed passes + a normalizing blit", () => {
    const passes = compilePasses([compRef("host", "compB")], null, { resolveComposition });
    const ids = passes.map((p) => p.layerId);

    expect(ids).toEqual([
      `host${NESTED_SEP}inner`,
      `host${NESTED_SEP}${compositePassId("inner")}`,
      "host", // blit normalizes the nested result into the host's FBO
      compositePassId("host"),
      "blit-out",
    ]);

    const nestedComposite = passes[1]!;
    expect(nestedComposite.sourceLayerId).toBe(`host${NESTED_SEP}inner`);
    expect(nestedComposite.colorSourceLayerId).toBe(`host${NESTED_SEP}inner`);

    const blit = passes[2]!;
    expect(blit.layerType).toBe("blit");
    expect(blit.inputLayerId).toBe(`host${NESTED_SEP}${compositePassId("inner")}`);

    // The host composite treats the blit FBO as regular generator content.
    const hostComposite = passes[3]!;
    expect(hostComposite.colorSourceLayerId).toBe("host");
  });

  it("nested composites preserve alpha; the root comp flattens", () => {
    const passes = compilePasses(
      [compRef("host", "compB"), layer("bg", "solid")],
      null,
      { resolveComposition },
    );
    const nestedComposite = passes.find(
      (p) => p.layerId === `host${NESTED_SEP}${compositePassId("inner")}`,
    )!;
    expect(nestedComposite.preserveAlpha).toBe(true);
    const rootComposite = passes.find((p) => p.layerId === compositePassId("bg"))!;
    expect(rootComposite.preserveAlpha ?? false).toBe(false);
    const hostComposite = passes.find((p) => p.layerId === compositePassId("host"))!;
    expect(hostComposite.preserveAlpha ?? false).toBe(false);
  });

  it("an unresolved reference renders nothing (layer drops out)", () => {
    const passes = compilePasses(
      [compRef("host", "missing"), layer("bg", "solid")],
      null,
      { resolveComposition },
    );
    expect(passes.some((p) => p.layerId.includes(NESTED_SEP))).toBe(false);
    expect(passes.some((p) => p.layerId === compositePassId("host"))).toBe(false);
    expect(passes.some((p) => p.layerId === "bg")).toBe(true);
  });

  it("direct self-nesting is refused via rootCompositionId", () => {
    const selfRegistry = { compA: comp([compRef("h2", "compA"), layer("s", "solid")]) };
    const passes = compilePasses([compRef("h1", "compA")], null, {
      resolveComposition: (id) => selfRegistry[id as keyof typeof selfRegistry] ?? null,
      rootCompositionId: "compA",
    });
    expect(passes.length).toBe(0);
  });

  it("mutual cycles stop at the repeated comp", () => {
    const cyc: Record<string, CompositionConfig> = {};
    cyc.a = comp([compRef("ha", "b"), layer("sa", "solid")]);
    cyc.b = comp([compRef("hb", "a"), layer("sb", "solid")]);
    const passes = compilePasses([compRef("root", "a")], null, {
      resolveComposition: (id) => cyc[id] ?? null,
    });
    // root -> a -> b resolves; b's reference back to a is dropped.
    const ids = passes.map((p) => p.layerId).join("|");
    expect(ids).toContain(`root${NESTED_SEP}sa`);
    expect(ids).toContain(`root${NESTED_SEP}ha${NESTED_SEP}sb`);
    expect(ids).not.toContain(`${NESTED_SEP}hb${NESTED_SEP}`);
  });

  it("a 3D composition layer joins a 3D group with its blit as content", () => {
    const passes = compilePasses(
      [compRef("host", "compB", { is3D: true }), layer("bg", "solid", { is3D: true })],
      null,
      { resolveComposition },
    );
    const slot = passes.find(
      (p) => p.layerType === "layerComposite3d" && p.sourceLayerId === "host",
    )!;
    expect(slot).toBeDefined();
    expect(slot.colorSourceLayerId).toBe("host");
    expect(passes.some((p) => p.layerId === "host" && p.layerType === "blit")).toBe(true);
  });
});

describe("createNestedResolvers", () => {
  const inner = layer("inner", "solid", {
    values: { layerPositionX: 0.5 },
    timing: { in: 1, out: 3 },
  });
  const nestedComp = comp([inner], {
    tracks: [
      {
        layerId: "inner",
        paramName: "layerPositionX",
        enabled: true,
        keys: [
          { time: 0, value: 0 },
          { time: 2, value: 2 },
        ],
      },
    ],
  });
  const host = compRef("host", "compB", { timing: { in: 4 } });
  const registry: Record<string, CompositionConfig> = { compB: nestedComp };

  const fakePass = (id: string): RenderPass => ({
    layerId: id,
    layerType: "layerComposite3d",
    uniforms: {},
    inputLayerId: null,
    sourceLayerId: id,
    isOutput: false,
  });

  it("resolves prefixed ids into nested layers with root-shifted timing", () => {
    const { findLayer } = createNestedResolvers({
      layers: [host],
      parentModFn: null,
      resolveComposition: (id) => registry[id] ?? null,
      time: 5,
    });
    const resolved = findLayer(fakePass(`host${NESTED_SEP}inner`))!;
    expect(resolved.values.layerPositionX).toBe(0.5);
    expect(resolved.id).toBe(`host${NESTED_SEP}inner`);
    // in 1 / out 3 in nested time + host in-point 4 → 5..7 in root time.
    expect(resolved.timing).toEqual({ in: 5, out: 7 });
  });

  it("evaluates nested keyframes at LOCAL time (root time minus host in-point)", () => {
    const { modFn } = createNestedResolvers({
      layers: [host],
      parentModFn: null,
      resolveComposition: (id) => registry[id] ?? null,
      time: 5, // local time = 5 - 4 = 1 → keyframe value 1
    });
    expect(modFn(`host${NESTED_SEP}inner`, "layerPositionX", 0.5)).toBeCloseTo(1);
  });

  it("root ids fall through to the parent modFn and layer list", () => {
    const parentModFn = (id: string, p: string, base: number) => base + 10;
    const { modFn, findLayer } = createNestedResolvers({
      layers: [host],
      parentModFn,
      resolveComposition: (id) => registry[id] ?? null,
      time: 0,
    });
    expect(modFn("host", "layerOpacity", 1)).toBe(11);
    expect(findLayer(fakePass("host"))?.id).toBe("host");
  });
});