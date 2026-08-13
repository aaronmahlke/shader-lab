import { describe, expect, it } from "bun:test";
import { compilePasses } from "../compiler/compile-passes";
import { buildLayerValues } from "../compiler/build-layer-values";
import type { MediaSource } from "./component-source";
import { createHeadlessGlContext, loadHeadlessGl } from "./headless-gl";
import { createNodeGradientData } from "./stbn-node";
import {
  destroyGlContext,
  renderPasses,
  type MediaTextureEntry,
  type RenderPassContext,
} from "./render-passes";

const ORANGE: [number, number, number] = [230, 120, 30];
const TEAL: [number, number, number] = [20, 180, 170];
const RED: [number, number, number] = [220, 40, 40];
const GREEN: [number, number, number] = [40, 200, 60];
const BLUE: [number, number, number] = [40, 80, 220];
const YELLOW: [number, number, number] = [230, 210, 50];

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

/** Quadrant-colored RGBA frame (top-down rows): TL | TR over BL | BR. */
function quadrantFrame(
  width: number,
  height: number,
  tl: [number, number, number],
  tr: [number, number, number],
  bl: [number, number, number],
  br: [number, number, number],
) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const top = y < height / 2;
      const left = x < width / 2;
      const rgb = top ? (left ? tl : tr) : left ? bl : br;
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function mediaLayer(
  id: string,
  type: "image" | "video",
  crops: Partial<Record<"cropLeft" | "cropRight" | "cropTop" | "cropBottom", number>> = {},
) {
  return {
    id,
    type,
    enabled: true,
    values: { ...buildLayerValues(type), ...crops },
  };
}

// stackgl's `gl` is a NAN/V8 native module. Bun's V8 compat layer on Linux is
// missing symbols it needs (e.g. v8::FunctionTemplate::InstanceTemplate), and
// the failed dlopen aborts the whole test process, so we skip instead of crash.
// The headless GL path is covered on Linux by scripts/headless-smoke.mjs (Node).
const GL_LOADABLE = !("bun" in process.versions) || process.platform !== "linux";

describe.skipIf(!GL_LOADABLE)("media layer rendering", () => {
  it("renders transparent without a source and reuses version-cached uploads", async () => {
    const width = 256;
    const height = 192;
    const layers = [mediaLayer("image-1", "image")];

    const createGL = await loadHeadlessGl();
    const gl = createHeadlessGlContext(createGL, width, height);

    try {
      const mediaSources = new Map<string, MediaSource>();
      const mediaTextures = new Map<string, MediaTextureEntry>();
      const ctx: RenderPassContext = {
        gl,
        width,
        height,
        time: 0,
        scaleUniform: 1,
        gradientTextures: new Map<string, WebGLTexture>(),
        stbnTexture: null,
        createGradientData: createNodeGradientData,
        mediaSources,
        mediaTextures,
        contentScale: 1,
        findLayer: (pass) => layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
      };

      // No source pushed: the layer must contribute nothing (headless-safe).
      const empty = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;
      expect(colorDistance(samplePixel(empty, width, height, 128, 96), [0, 0, 0])).toBeLessThan(2);

      // Push a 150×90 NPOT frame; drawn centered at its display size (contentScale 1).
      const displayWidth = 150;
      const displayHeight = 90;
      mediaSources.set("image-1", {
        source: solidFrame(displayWidth, displayHeight, ORANGE),
        width: displayWidth,
        height: displayHeight,
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

      // A new frame with an unchanged version must reuse the cached upload.
      mediaSources.set("image-1", {
        source: solidFrame(displayWidth, displayHeight, TEAL),
        width: displayWidth,
        height: displayHeight,
        version: 1,
      });
      const cachedRender = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;
      expect(colorDistance(samplePixel(cachedRender, width, height, 128, 96), ORANGE)).toBeLessThan(8);

      // Bumping the version re-uploads the new frame.
      mediaSources.set("image-1", {
        source: solidFrame(displayWidth, displayHeight, TEAL),
        width: displayWidth,
        height: displayHeight,
        version: 2,
      });
      const bumped = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;
      expect(colorDistance(samplePixel(bumped, width, height, 128, 96), TEAL)).toBeLessThan(8);

      for (const entry of mediaTextures.values()) gl.deleteTexture(entry.texture);
    } finally {
      destroyGlContext(gl);
    }
  });

  it("crop shifts the sampled content window (y-flip safe)", async () => {
    const width = 256;
    const height = 192;
    // 160×120 quadrant frame drawn centered: each quadrant is 80×60 buffer px.
    const displayWidth = 160;
    const displayHeight = 120;
    const frame = () => quadrantFrame(displayWidth, displayHeight, RED, GREEN, BLUE, YELLOW);

    const createGL = await loadHeadlessGl();
    const gl = createHeadlessGlContext(createGL, width, height);

    try {
      const render = (
        type: "image" | "video",
        crops: Partial<Record<"cropLeft" | "cropRight" | "cropTop" | "cropBottom", number>>,
      ) => {
        const layers = [mediaLayer("media-1", type, crops)];
        const mediaSources = new Map<string, MediaSource>([
          [
            "media-1",
            { source: frame(), width: displayWidth, height: displayHeight, version: 1 },
          ],
        ]);
        const mediaTextures = new Map<string, MediaTextureEntry>();
        const ctx: RenderPassContext = {
          gl,
          width,
          height,
          time: 0,
          scaleUniform: 1,
          gradientTextures: new Map<string, WebGLTexture>(),
          stbnTexture: null,
          createGradientData: createNodeGradientData,
          mediaSources,
          mediaTextures,
          contentScale: 1,
          findLayer: (pass) => layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
        };
        const pixels = renderPasses(compilePasses(layers), ctx, {
          readPixels: true,
          disposeResources: true,
        }).pixels!;
        for (const entry of mediaTextures.values()) gl.deleteTexture(entry.texture);
        return pixels;
      };

      // Uncropped baseline: rect spans x [48,208], y [36,156] from the top.
      const uncropped = render("image", {});
      expect(colorDistance(samplePixel(uncropped, width, height, 88, 66), RED)).toBeLessThan(8);
      expect(colorDistance(samplePixel(uncropped, width, height, 168, 66), GREEN)).toBeLessThan(8);
      expect(colorDistance(samplePixel(uncropped, width, height, 88, 126), BLUE)).toBeLessThan(8);
      expect(colorDistance(samplePixel(uncropped, width, height, 168, 126), YELLOW)).toBeLessThan(8);

      // Cropping left+top keeps the window [0.45..1]²: the displayed rect's
      // center now samples u=v=0.725 — the bottom-right quadrant.
      const cropped = render("image", { cropLeft: 0.45, cropTop: 0.45 });
      expect(colorDistance(samplePixel(cropped, width, height, 128, 96), YELLOW)).toBeLessThan(8);

      // cropTop alone must trim the media's visual TOP (the y-flip trap): the
      // 66px-tall rect spans y [63,129]; its center reads v=0.725 (bottom
      // half, BLUE on the left) while just below its top edge a sliver of the
      // top half survives (v=0.475, RED on the left).
      const topCropped = render("video", { cropTop: 0.45 });
      expect(colorDistance(samplePixel(topCropped, width, height, 88, 96), BLUE)).toBeLessThan(8);
      expect(colorDistance(samplePixel(topCropped, width, height, 88, 66), RED)).toBeLessThan(8);
      // Above the shrunken rect stays transparent.
      expect(colorDistance(samplePixel(topCropped, width, height, 88, 50), [0, 0, 0])).toBeLessThan(2);
    } finally {
      destroyGlContext(gl);
    }
  });
});
