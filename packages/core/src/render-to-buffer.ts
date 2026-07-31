import type { CompositionConfig } from "./types/composition";
import { compilePasses } from "./compiler/compile-passes";
import { createAnimatedModulationFn } from "./animation/create-modulation-fn";
import { ModulationEngine } from "./modulation/engine";
import { destroyGlContext, renderPasses } from "./renderer/render-passes";
import { createHeadlessGlContext, loadHeadlessGl } from "./renderer/headless-gl";
import {
  createNodeGradientData,
  createNodeTextImage,
  createStbnGlTexture,
  pixelsToPngBuffer,
} from "./renderer/stbn-node";

export type RenderCompositionOptions = {
  width?: number;
  height?: number;
  time?: number;
  stbnPath?: string;
};

export async function renderCompositionToBuffer(
  config: CompositionConfig,
  options: RenderCompositionOptions = {},
): Promise<Buffer | null> {
  const width = options.width ?? 400;
  const height = options.height ?? 300;
  const time = options.time ?? 2.0;

  let createGL: Awaited<ReturnType<typeof loadHeadlessGl>>;
  try {
    createGL = await loadHeadlessGl();
  } catch (e) {
    console.error("Failed to import gl:", e);
    return null;
  }

  const engine = new ModulationEngine();
  engine.setLfos(config.lfos);
  engine.setAssignments(config.assignments);
  engine.sampleAt(time);
  const modFn = createAnimatedModulationFn(time, config.tracks ?? [], engine);
  const passes = compilePasses(config.layers, modFn);
  if (passes.length === 0) return null;

  let gl: WebGL2RenderingContext;
  try {
    gl = createHeadlessGlContext(createGL, width, height);
  } catch (e) {
    console.error("WebGL2 context required:", e);
    return null;
  }

  try {
    const gradientTextures = new Map<string, WebGLTexture>();
    const stbnTexture = await createStbnGlTexture(gl, options.stbnPath);

    const { pixels } = renderPasses(
      passes,
      {
        gl,
        width,
        height,
        time,
        scaleUniform: 1.0,
        gradientTextures,
        stbnTexture,
        createGradientData: createNodeGradientData,
        textTextures: new Map(),
        createTextImage: createNodeTextImage,
        contentScale: height / (config.settings?.height ?? height),
        findLayer: (pass) =>
          config.layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
        getModulatedValue: modFn,
      },
      { readPixels: true, disposeResources: true },
    );

    if (!pixels) return null;
    return pixelsToPngBuffer(pixels, width, height);
  } catch (e) {
    console.error("Composition render failed:", e);
    return null;
  } finally {
    destroyGlContext(gl);
  }
}
