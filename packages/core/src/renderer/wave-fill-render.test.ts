import { describe, expect, it } from "bun:test";
import { compilePasses } from "../compiler/compile-passes";
import { buildLayerValues } from "../compiler/build-layer-values";
import { cloneMeshPoints, MESH_BLOOM_POINTS } from "../compiler/mesh-uniforms";
import { createHeadlessGlContext, loadHeadlessGl } from "./headless-gl";
import { createNodeGradientData } from "./stbn-node";
import { destroyGlContext, renderPasses } from "./render-passes";

const WAVE_PURPLE: [number, number, number] = [154, 139, 244];

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

describe("waveFill compositing", () => {
  it("passes through mesh above the sine curve", async () => {
    const layers = [
      {
        id: "wave-1",
        type: "waveFill" as const,
        enabled: true,
        values: {
          ...buildLayerValues("waveFill"),
          centerY: 0.5,
          amplitude: 0.2,
          cycleWidth: 1,
          cycleX: 0.5,
          edge: 0.4,
          u_gradient: [
            { position: 0, color: "#5a4fcf" },
            { position: 1, color: "#9b8cf5" },
          ],
        },
      },
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

    const width = 400;
    const height = 300;
    const createGL = await loadHeadlessGl();
    const gl = createHeadlessGlContext(createGL, width, height);

    try {
      const ctx = {
        gl,
        width,
        height,
        time: 0,
        scaleUniform: 1,
        gradientTextures: new Map<string, WebGLTexture>(),
        stbnTexture: null,
        createGradientData: createNodeGradientData,
        findLayer: (pass: { layerId: string; sourceLayerId?: string | null }) =>
          layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
      };

      const meshOnly = renderPasses(compilePasses([layers[1]!]), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;

      const composed = renderPasses(compilePasses(layers), ctx, {
        readPixels: true,
        disposeResources: true,
      }).pixels!;

      const meshTop = samplePixel(meshOnly, width, height, 200, 290);
      const top = samplePixel(composed, width, height, 200, 290);
      const bottom = samplePixel(composed, width, height, 200, 10);

      expect(colorDistance(top, meshTop)).toBeLessThan(8);
      expect(colorDistance(bottom, WAVE_PURPLE)).toBeLessThan(40);
    } finally {
      destroyGlContext(gl);
    }
  });
});
