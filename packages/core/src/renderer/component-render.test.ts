import { describe, expect, it } from "bun:test";
import { compilePasses } from "../compiler/compile-passes";
import { buildLayerValues } from "../compiler/build-layer-values";
import type { ComponentSource } from "./component-source";
import { createHeadlessGlContext, loadHeadlessGl } from "./headless-gl";
import { createNodeGradientData } from "./stbn-node";
import {
  destroyGlContext,
  renderPasses,
  type ComponentTextureEntry,
  type RenderPassContext,
} from "./render-passes";

const ORANGE: [number, number, number] = [230, 120, 30];

function samplePixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  yFromTop: number,
): [number, number, number] {
  const y = height - 1 - yFromTop;
  const i = (y * width + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Solid-color RGBA frame, deliberately NPOT to exercise WebGL2 mipmap upload. */
function solidFrame(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function componentLayer(id: string) {
  return {
    id,
    type: "component" as const,
    enabled: true,
    values: buildLayerValues("component"),
  };
}

describe("component layer rendering", () => {
  it("renders transparent without a source and the pushed frame with one", async () => {
    const width = 256;
    const height = 192;
    const layers = [componentLayer("component-1")];

    const createGL = await loadHeadlessGl();
    const gl = createHeadlessGlContext(createGL, width, height);

    try {
      const componentSources = new Map<string, ComponentSource>();
      const componentTextures = new Map<string, ComponentTextureEntry>();
      const ctx: RenderPassContext = {
        gl,
        width,
        height,
        time: 0,
        scaleUniform: 1,
        gradientTextures: new Map<string, WebGLTexture>(),
        stbnTexture: null,
        createGradientData: createNodeGradientData,
        componentSources,
        componentTextures,
        contentScale: 1,
        findLayer: (pass) => layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
      };

      // No source pushed: the layer must contribute nothing (headless-safe).
      const empty = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;
      expect(colorDistance(samplePixel(empty, width, height, 128, 96), [0, 0, 0])).toBeLessThan(2);

      // Push a 150×90 NPOT frame; drawn centered at css size (contentScale 1).
      const cssWidth = 150;
      const cssHeight = 90;
      componentSources.set("component-1", {
        frame: solidFrame(cssWidth, cssHeight, ORANGE),
        cssWidth,
        cssHeight,
        version: 1,
      });

      const withSource = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;

      const center = samplePixel(withSource, width, height, 128, 96);
      expect(colorDistance(center, ORANGE)).toBeLessThan(8);

      // Outside the centered content rect stays untouched.
      const corner = samplePixel(withSource, width, height, 10, 10);
      expect(colorDistance(corner, [0, 0, 0])).toBeLessThan(2);

      // A re-render with the same version must reuse the cached upload.
      const again = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;
      expect(colorDistance(samplePixel(again, width, height, 128, 96), ORANGE)).toBeLessThan(8);

      for (const entry of componentTextures.values()) gl.deleteTexture(entry.texture);
    } finally {
      destroyGlContext(gl);
    }
  });
});
