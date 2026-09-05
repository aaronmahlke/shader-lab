import type { CompositionConfig } from "./types/composition";
import { ModulationEngine, createModulationFn } from "./modulation/engine";
import { compilePasses, buildLayerUniforms } from "./compiler/compile-passes";
import type { ModulationFn } from "./compiler/compile-passes";
import { CompositionRenderer } from "./renderer/composition-renderer";
import type { CompositionRendererOptions } from "./renderer/composition-renderer";
import { buildLayerValues } from "./compiler/build-layer-values";
import { createAnimatedModulationFn } from "./animation/create-modulation-fn";
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

  /** Keyframed params win over LFOs, same as the editor and headless export. */
  function modulationAt(time: number): ModulationFn {
    engine.sampleAt(time);
    return createAnimatedModulationFn(time, currentConfig.tracks ?? [], engine);
  }

  function draw(time: number) {
    const modFn = modulationAt(time);
    renderer.renderFrame(time, compilePasses(currentConfig.layers, modFn), modFn);
  }

  function tick() {
    const time = (performance.now() - startTime) / 1000;
    draw(time);
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
      draw(time);
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
export { bakeLfoAssignments } from "./animation/bake-lfo";
export type {
  BakedTrack,
  BakeLfoOptions,
  BakeLfoResult,
  SkippedAssignment,
  SkipReason,
} from "./animation/bake-lfo";
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
  THREED_TRANSFORM_UNIFORMS,
  OPACITY_UNIFORM,
  universalUniformsFor,
  findLayerParamDef,
  isUniversalParamName,
  buildUniversalUniforms,
  layerOpacityValue,
  layerTimingFactor,
  isIdentityTransform,
  supports3D,
  isLayer3D,
} from "./compiler/universal-uniforms";
export {
  compositePassId,
  threeDSlotPassId,
  NESTED_SEP,
  type CompileOptions,
} from "./compiler/compile-passes";
export { createNestedResolvers } from "./compiler/nested";
export { find3DRuns, threeDGroupMemberIds, type ThreeDRun } from "./compiler/threed";
export {
  orderThreeDMembers,
  assignThreeDSlots,
  resolveSceneView,
  IDENTITY_VIEW,
  SCENE_FOV_DEG,
  type SceneView,
} from "./renderer/threed-order";
export {
  projectLayerQuad,
  projectObjectBounds,
  projectStagePoint,
  pointInProjectedQuad,
  threeDTransformFromValues,
  drivingCameraIdFor,
  type ProjectedPoint,
  type ThreeDTransform,
} from "./compiler/threed-project";
export { renderPasses, destroyGlContext } from "./renderer/render-passes";

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

