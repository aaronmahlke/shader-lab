import type { CompositionConfig } from "./types/composition";
import { ModulationEngine, createModulationFn } from "./modulation/engine";
import { compilePasses, buildLayerUniforms } from "./compiler/compile-passes";
import type { ModulationFn } from "./compiler/compile-passes";
import { CompositionRenderer } from "./renderer/composition-renderer";
import type { CompositionRendererOptions } from "./renderer/composition-renderer";
import { buildLayerValues } from "./compiler/build-layer-values";
import { createAnimatedModulationFn } from "./animation/create-modulation-fn";
import LAYER_TEMPLATES from "./compiler/layer-templates";
import { resolveLayerById } from "./modulation/cloners";
import { motionBlurSampleTimes } from "./renderer/motion-blur";
import { DEFAULT_COMPOSITION_SETTINGS as DEFAULT_SETTINGS_FOR_DRAW } from "./types/animation";

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
  engine.setConfig(config);

  let currentConfig = config;
  let animationId: number | null = null;
  let running = false;
  let startTime = 0;

  const renderer = new CompositionRenderer(canvas, {
    ...options,
    findLayer: (pass) => resolveLayerById(currentConfig.layers, pass.sourceLayerId ?? pass.layerId),
    getModulatedValue: engine.getModulatedValue,
  });

  /** Keyframes set the base, modulators stack on top — same as the editor and headless export. */
  function modulationAt(time: number): ModulationFn {
    engine.sampleAt(time);
    return createAnimatedModulationFn(time, currentConfig.tracks ?? [], engine);
  }

  function draw(time: number) {
    const modFn = modulationAt(time);
    const passes = compilePasses(currentConfig.layers, modFn);
    const times = motionBlurSampleTimes(time, currentConfig.settings ?? DEFAULT_SETTINGS_FOR_DRAW);
    renderer.renderFrameSamples(times, passes, (t) => (t === time ? modFn : modulationAt(t)), time);
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
      engine.setConfig(newConfig);
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
  integrateKeyframes,
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
  CloneInfo,
  EnvelopeSource,
  ModulationAssignment,
  ModulationTimeBase,
  WavePoint,
  LFOWaveShape,
  LFOPlaybackMode,
} from "./types/editor";

export {
  UNIVERSAL_LAYER_UNIFORMS,
  TRANSFORM_UNIFORMS,
  THREED_TRANSFORM_UNIFORMS,
  OPACITY_UNIFORM,
  BLUR_UNIFORM,
  universalUniformsFor,
  findLayerParamDef,
  isUniversalParamName,
  buildUniversalUniforms,
  layerOpacityValue,
  layerTimingFactor,
  isIdentityTransform,
  supports3D,
  isLayer3D,
  isControlLayer,
  isAudioLayer,
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
  componentCaptureScaleFromValues,
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

export { applyModulation, isZeroBaseDisabled } from "./modulation/modulation";
export { evaluateEnvelope } from "./modulation/envelope";
export {
  cloneContentPassId,
  cloneId,
  cloneTransformValue,
  clonerSourceIds,
  expandCloners,
  resolveLayerById,
  CLONE_SEP,
  MAX_CLONES,
} from "./modulation/cloners";
export type { ClonerExpansion } from "./modulation/cloners";
export {
  canParent,
  composeTransforms,
  localFromWorld,
  localTransform,
  worldParam,
  PARENT_PARAMS,
} from "./modulation/parenting";
export type { WorldTransform } from "./modulation/parenting";
export { ATTACH_POINTS, attachPointsFor, attachPointOffset, estimateTextWidth } from "./modulation/attach-points";
export type { AttachPoint, TextMeasure } from "./modulation/attach-points";
export { layoutTextSpec, textFont } from "./renderer/text-raster";
export { motionBlurSampleTimes, motionBlurEnabled } from "./renderer/motion-blur";
export { applyCompProps, compPropsOf, hostPropValues, type CompProp } from "./compiler/comp-props";
export type { TextLayout, TextGlyph } from "./renderer/text-raster";
export {
  applyEffectorInfluence,
  computeEffectorInfluence,
  effectorFalloff,
  EFFECTOR_PARAMS,
  staticParamValue,
} from "./modulation/effectors";
export type { EffectorInfluence } from "./modulation/effectors";
export type { EnvelopeShape } from "./modulation/envelope";
export { linkKey, linkTrackLayerId, linksFor, sourceTrackLayerId } from "./modulation/engine";
export {
  evaluateLfoWave,
  evaluateWavePoints,
  getLfoWaveShape,
  normalizeLfo,
  inferLfoWaveShape,
} from "./modulation/lfo-wave";
export { STBN_TEXTURE_PATH, stbnFrameIndex } from "./modulation/stbn";


/**
 * Bump when rendering output changes for the same inputs (shaders, blur,
 * compositing): editors key cached frames on it so stale frames never show.
 */
export const RENDER_ENGINE_VERSION = "2026-11-27.view-fold.1";
