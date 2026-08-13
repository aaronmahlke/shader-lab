import type { CompositionConfig } from "./types/composition";
import { ModulationEngine, createModulationFn } from "./modulation/engine";
import { compilePasses, buildLayerUniforms } from "./compiler/compile-passes";
import type { ModulationFn } from "./compiler/compile-passes";
import { CompositionRenderer } from "./renderer/composition-renderer";
import type { CompositionRendererOptions } from "./renderer/composition-renderer";
import { buildLayerValues } from "./compiler/build-layer-values";
import LAYER_TEMPLATES from "./compiler/layer-templates";

export type CompositionHandle = {
  play(): void;
  pause(): void;
  destroy(): void;
  updateConfig(config: CompositionConfig): void;
  getCanvas(): HTMLCanvasElement;
  renderFrame(time: number): void;
};

export function createComposition(
  canvas: HTMLCanvasElement,
  config: CompositionConfig,
  options: CompositionRendererOptions & { autoplay?: boolean } = {},
): CompositionHandle {
  const engine = new ModulationEngine();
  engine.setLfos(config.lfos);
  engine.setAssignments(config.assignments);

  let currentConfig = config;
  let animationId: number | null = null;
  let running = false;
  let startTime = 0;

  const renderer = new CompositionRenderer(canvas, {
    ...options,
    findLayer: (pass) =>
      currentConfig.layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
    getModulatedValue: engine.getModulatedValue,
  });

  function tick() {
    const time = (performance.now() - startTime) / 1000;
    engine.sampleAt(time);
    const passes = compilePasses(currentConfig.layers, engine.getModulatedValue);
    renderer.renderFrame(time, passes);
    if (running) animationId = requestAnimationFrame(tick);
  }

  return {
    play() {
      if (running) return;
      running = true;
      startTime = performance.now();
      tick();
    },
    pause() {
      running = false;
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    },
    destroy() {
      this.pause();
      renderer.dispose();
    },
    updateConfig(newConfig: CompositionConfig) {
      currentConfig = newConfig;
      engine.setLfos(newConfig.lfos);
      engine.setAssignments(newConfig.assignments);
    },
    getCanvas() {
      return renderer.getCanvas();
    },
    renderFrame(time: number) {
      engine.sampleAt(time);
      const passes = compilePasses(currentConfig.layers, engine.getModulatedValue);
      renderer.renderFrame(time, passes);
    },
  };
}

export { normalizeCompositeLayer, normalizeCompositeLayers, normalizeComposition, offsetDuplicatedWave } from "./compiler/normalize-composite-layers";
export {
  evaluateKeyframes,
  evaluatePropertyTrack,
  findPropertyTrack,
  hasKeyframeAt,
  isPropertyTrackActive,
  removeKeyframeAt,
  setTrackEnabled,
  trackId,
  upsertKeyframe,
  moveKeyframe,
  offsetKeyframes,
  buildKeyframePasteItems,
  pasteKeyframesAtTime,
} from "./animation/property-tracks";
export type { KeyframePasteItem } from "./animation/property-tracks";
export { setKeyframesEasing } from "./animation/property-tracks";
export {
  cubicBezierProgress,
  evaluateCubicBezier,
  EASING_PRESETS,
  findEasingPreset,
  matchEasingPreset,
} from "./animation/easing";
export type { EasingPreset } from "./animation/easing";
export { isKeyframeableUniform } from "./animation/keyframeable";
export { createAnimatedModulationFn } from "./animation/create-modulation-fn";
export { DEFAULT_COMPOSITION_SETTINGS } from "./types/animation";
export type {
  CompositionSettings,
  CubicBezierEase,
  Keyframe,
  KeyframeEasing,
  PropertyTrack,
} from "./types/animation";
export {
  ModulationEngine,
  createModulationFn,
  compilePasses,
  buildLayerUniforms,
  CompositionRenderer,
  buildLayerValues,
  LAYER_TEMPLATES,
};

export {
  BAND_GRADIENT_ABOVE,
  BAND_GRADIENT_BELOW,
  WAVE_GRADIENT_BLACK,
  WAVE_GRADIENT_BLACK2,
  WAVE_GRADIENT_BLUE,
  WAVE_GRADIENT_BLUE2,
  WAVE_GRADIENT_LIME,
  WAVE_GRADIENT_PALE,
} from "./compiler/composite-defaults";
export {
  GRAINY_DITHER_MESH_POINTS,
  MESH_BLOOM_POINTS,
} from "./compiler/mesh-uniforms";
export {
  cloneMeshPoints,
  meshParamName,
  expandMeshUniforms,
} from "./compiler/mesh-uniforms";
export type { MeshPointField } from "./compiler/mesh-uniforms";
export { MESH_MAX_POINTS } from "./types/mesh";
export type { MeshPoint } from "./types/mesh";

export type { ModulationFn, CompositionRendererOptions, CompositionConfig };

export type {
  LayerInstance,
  LayerTiming,
  LayerType,
  LayerTemplate,
  RenderPass,
  LFOSource,
  ModulationAssignment,
  WavePoint,
  LFOWaveShape,
  LFOPlaybackMode,
} from "./types/editor";

export {
  UNIVERSAL_LAYER_UNIFORMS,
  TRANSFORM_UNIFORMS,
  OPACITY_UNIFORM,
  universalUniformsFor,
  findLayerParamDef,
  isUniversalParamName,
  buildUniversalUniforms,
  layerOpacityValue,
  layerTimingFactor,
  isIdentityTransform,
} from "./compiler/universal-uniforms";
export { compositePassId } from "./compiler/compile-passes";

export type { GradientStop } from "./types";

export {
  componentNameFromValues,
  componentStageWidthFromValues,
  mediaSrcFromValues,
  videoLoopFromValues,
  videoTrimStartFromValues,
} from "./renderer/component-source";
export type {
  ComponentSource,
  ComponentSourceFrame,
  ComponentSourceInput,
  MediaSource,
  MediaSourceFrame,
} from "./renderer/component-source";

export { applyModulation } from "./modulation/modulation";
export {
  evaluateLfoWave,
  evaluateWavePoints,
  getLfoWaveShape,
  normalizeLfo,
  inferLfoWaveShape,
} from "./modulation/lfo-wave";
export { STBN_TEXTURE_PATH, stbnFrameIndex } from "./modulation/stbn";

