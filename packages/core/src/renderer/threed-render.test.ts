import { describe, expect, it } from "bun:test";
import { compilePasses } from "../compiler/compile-passes";
import { buildLayerValues } from "../compiler/build-layer-values";
import type { LayerInstance, RenderPass } from "../types/editor";
import { createHeadlessGlContext, loadHeadlessGl } from "./headless-gl";
import { createNodeGradientData } from "./stbn-node";
import { destroyGlContext, renderPasses, type RenderPassContext } from "./render-passes";

// stackgl's `gl` is a NAN/V8 native module that Bun on Linux cannot dlopen —
// skip there (same policy as component-render.test.ts). The GL path is
// verified on Linux by scripts/threed-smoke.mjs under Node + xvfb.
const GL_LOADABLE = !("bun" in process.versions) || process.platform !== "linux";

function solid(id: string, color: string, overrides: Partial<LayerInstance> = {}): LayerInstance {
  const values = { ...buildLayerValues("solid"), u_color: color, ...(overrides.values ?? {}) };
  return { id, type: "solid", enabled: true, ...overrides, values };
}

function samplePixel(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): [number, number, number] {
  const i = (y * width + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

function renderLayers(
  gl: WebGL2RenderingContext,
  layers: LayerInstance[],
  width: number,
  height: number,
): Uint8Array {
  const passes = compilePasses(layers, null);
  const ctx: RenderPassContext = {
    gl,
    width,
    height,
    time: 0,
    scaleUniform: 1,
    gradientTextures: new Map(),
    stbnTexture: null,
    createGradientData: createNodeGradientData,
    findLayer: (pass: RenderPass) =>
      layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
    getModulatedValue: null,
  };
  const { pixels } = renderPasses(passes, ctx, { readPixels: true, disposeResources: true });
  return pixels!;
}

describe.skipIf(!GL_LOADABLE)("3D group rendering", () => {
  it("depth order beats stack order inside a 3D group", async () => {
    const width = 128;
    const height = 128;
    const createGL = await loadHeadlessGl();
    const gl = createHeadlessGlContext(createGL, width, height);

    try {
      // UI top → bottom: blue over red. Both shrunk so both are visible.
      // Red gets higher Z (closer to camera) — in 3D it must cover blue.
      const make = (is3D: boolean) => [
        solid("blue", "#0000ff", { is3D, values: { layerScale: 60 } }),
        solid("red", "#ff0000", { is3D, values: { layerScale: 60, layerPositionZ: is3D ? 0.4 : 0 } }),
      ];

      const flat = renderLayers(gl, make(false), width, height);
      const [fr, fg, fb] = samplePixel(flat, width, 64, 64);
      expect(fb).toBeGreaterThan(200); // 2D: blue (top of stack) wins
      expect(fr).toBeLessThan(60);

      const deep = renderLayers(gl, make(true), width, height);
      const [dr, , db] = samplePixel(deep, width, 64, 64);
      expect(dr).toBeGreaterThan(200); // 3D: red (higher z) wins
      expect(db).toBeLessThan(60);
    } finally {
      destroyGlContext(gl);
    }
  });

  it("a 3D layer at rest matches the 2D composite path", async () => {
    const width = 160;
    const height = 120;
    const createGL = await loadHeadlessGl();
    const gl = createHeadlessGlContext(createGL, width, height);

    try {
      const values = {
        layerScale: 55,
        layerPositionX: 0.1,
        layerPositionY: -0.05,
        layerRotation: 30,
        layerOpacity: 80,
      };
      const flat = renderLayers(gl, [solid("a", "#22cc88", { values: { ...values } })], width, height);
      const deep = renderLayers(
        gl,
        [solid("a", "#22cc88", { is3D: true, values: { ...values } })],
        width,
        height,
      );

      // Sample a coarse grid; allow small AA differences along edges.
      let maxDelta = 0;
      let differing = 0;
      for (let y = 4; y < height; y += 8) {
        for (let x = 4; x < width; x += 8) {
          const a = samplePixel(flat, width, x, y);
          const b = samplePixel(deep, width, x, y);
          const delta = Math.max(
            Math.abs(a[0] - b[0]),
            Math.abs(a[1] - b[1]),
            Math.abs(a[2] - b[2]),
          );
          maxDelta = Math.max(maxDelta, delta);
          if (delta > 8) differing++;
        }
      }
      // Identity projection: interior pixels must match; only edge texels may
      // differ by AA rounding.
      expect(differing).toBeLessThanOrEqual(2);
      expect(maxDelta).toBeLessThanOrEqual(64);
    } finally {
      destroyGlContext(gl);
    }
  });
});