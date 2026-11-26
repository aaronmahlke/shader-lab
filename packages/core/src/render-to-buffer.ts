import type { CompositionConfig } from "./types/composition";
import { compilePasses } from "./compiler/compile-passes";
import { createNestedResolvers } from "./compiler/nested";
import { createAnimatedModulationFn } from "./animation/create-modulation-fn";
import { ModulationEngine } from "./modulation/engine";
import {
  createRenderPipelineCache,
  destroyGlContext,
  disposeRenderPipelineCache,
  renderPasses,
} from "./renderer/render-passes";
import { motionBlurSampleTimes } from "./renderer/motion-blur";
import { DEFAULT_COMPOSITION_SETTINGS } from "./types/animation";
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
  /** Referenced compositions by id (nested composition layers). */
  compositions?: Record<string, CompositionConfig>;
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
  engine.setConfig(config);
  engine.sampleAt(time);
  const modFn = createAnimatedModulationFn(time, config.tracks ?? [], engine);
  const registry = options.compositions ?? {};
  const resolveComposition = (compId: string) => registry[compId] ?? null;
  const nested = createNestedResolvers({
    layers: config.layers,
    parentModFn: modFn,
    resolveComposition,
    time,
  });
  const passes = compilePasses(config.layers, modFn, { resolveComposition });
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

    const textTextures = new Map();
    const pipelineCache = createRenderPipelineCache();
    // Motion blur (per layer, in the composites): one render at the frame
    // time with modulation fns at shutter open / close.
    const times = motionBlurSampleTimes(time, config.settings ?? DEFAULT_COMPOSITION_SETTINGS);
    const at = (t: number) => {
      const engine = new ModulationEngine();
      engine.setConfig(config);
      engine.sampleAt(t);
      return createNestedResolvers({
        layers: config.layers,
        parentModFn: createAnimatedModulationFn(t, config.tracks ?? [], engine),
        resolveComposition,
        time: t,
      });
    };
    let motionBlur: { open: ReturnType<typeof at>["modFn"]; close: ReturnType<typeof at>["modFn"] } | null = null;
    if (times.length > 1) {
      const n = times.length;
      const window = ((times[n - 1]! - times[0]!) * n) / (n - 1);
      motionBlur = { open: at(time - window / 2).modFn, close: at(time + window / 2).modFn };
    }
    const frame = at(time);
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
        textTextures,
        createTextImage: createNodeTextImage,
        contentScale: height / (config.settings?.height ?? height),
        findLayer: frame.findLayer,
        getModulatedValue: frame.modFn,
        motionBlur,
      },
      { readPixels: true, pipelineCache },
    );
    disposeRenderPipelineCache(gl, pipelineCache);
    if (!pixels) return null;
    return pixelsToPngBuffer(pixels, width, height);
  } catch (e) {
    console.error("Composition render failed:", e);
    return null;
  } finally {
    destroyGlContext(gl);
  }
}
