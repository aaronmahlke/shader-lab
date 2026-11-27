<script setup lang="ts">
import type {
  LayerInstance,
  LayerType,
  LFOSource,
  ModulationAssignment,
  PropertyTrack,
  CompositionConfig,
  CompositionSettings,
} from "@shader-lab/core";
import {
  LAYER_TEMPLATES,
  DEFAULT_COMPOSITION_SETTINGS,
  UNIVERSAL_LAYER_UNIFORMS,
  drivingCameraIdFor,
  findLayerParamDef,
  isLayer3D,
  resolveSceneView,
  threeDTransformFromValues,
  type SceneView,
  normalizeComposition,
  setTrackEnabled,
  upsertKeyframe,
  removeKeyframeAt,
  findPropertyTrack,
  evaluatePropertyTrack,
  hasKeyframeAt,
  isPropertyTrackActive,
  buildKeyframePasteItems,
  pasteKeyframesAtTime,
  localFromWorld,
  motionBlurSampleTimes,
  staticParamValue,
  PARENT_PARAMS,
  NESTED_SEP,
  type WorldTransform,
} from "@shader-lab/core";
import { refDebounced, useEventListener } from "@vueuse/core";
import type { CompositionMeta, ProjectWithCompositions, ShaderDoc } from "#shared/types/project";
import { getKeyframeClipboard, setKeyframeClipboard } from "#shared/editor/keyframe-clipboard";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";
import { clampValue, type LayerTransformValues } from "#shared/editor/layer-transform";
import {
  FULL_CONTENT_EXTENT,
  componentContentExtent,
  mediaContentExtent,
  textContentExtent,
  textExtentSpecFromValues,
  type ContentExtent,
} from "#shared/editor/layer-content-extent";
import { createTextLineMeasurer } from "~/utils/text-measure";
import {
  PICKABLE_LAYER_TYPES,
  topLayerAt,
  type LayerProjection,
} from "#shared/editor/canvas-picking";
import { projectGizmoQuad, type ThreeDGizmoData } from "#shared/editor/threed-gizmo";
import { collectSnapTargets } from "#shared/editor/snapping";
import { cloneEditorSnapshot, type EditorSnapshot } from "#shared/editor/editor-history";
import { linkedParams } from "#shared/editor/position-group";
import { createUniqueLayerId, syncLayerIdCounter } from "#shared/editor/layer-ids";
import type { CanvasTool, TextEditIntent } from "#shared/editor/canvas-tool";
import { provideEditorHistory, useUndoHistory } from "~/composables/use-undo-history";
import {
  EditorKeyboardPriority,
  isDeleteKey,
  isTypingTarget,
  useEditorKeyboard,
} from "~/composables/use-editor-keyboard";
import {
  dataTransferHasFiles,
  mediaFilesFromDataTransfer,
  mediaUploadKindForFile,
  svgFileFromText,
  uploadMediaFile,
} from "~/utils/media-upload";
import { LFO_COLORS, nextLfoColor } from "#shared/editor/lfo-colors";
import { clonePresetPoints } from "#shared/editor/lfo-presets";
import { componentNameFromValues, normalizeLfo } from "@shader-lab/core";
import {
  cloneShaderPreset,
  getShaderPreset,
  DEFAULT_PRESET_ID,
} from "#shared/editor/shader-presets";
import { buildLayerValues, offsetDuplicatedWave, applyCompProps, createNestedResolvers, RENDER_ENGINE_VERSION } from "@shader-lab/core";
import { defaultStageComponentName, resolveStageComponent, stageComponentLoadsPending } from "~/utils/stage-components";
import { loadProjectComponents, projectComponents, projectComponentsLoadedFor } from "~/utils/project-components";
import { renderAudioMix, useAudioPlayback } from "~/composables/use-audio-playback";
import { audioBufferToWav, useVideoExport } from "~/composables/use-video-export";
import { collectCompEvents } from "~/utils/comp-events";
import { measureLoudness } from "~/utils/audio-meter";
import { applyMix, snapshotMix, type MixVersion } from "#shared/editor/mix-versions";
import { effectiveRules, migrateTriggerLayers, ruleLayer, type SoundRule } from "#shared/editor/sound-rules";
import { soundAnchors, triggerHits } from "~/utils/audio-triggers";
import { decodeAudio } from "~/composables/use-audio-playback";
import type { AudioEffect } from "#shared/editor/audio-effects";
import { seekTimelinePointers } from "~/utils/timeline-pointer";
import { BUILT_IN_CURSORS, cursorAnchor } from "#shared/editor/cursors";
import { compUrl, parseTrail, type TrailStep } from "~/utils/comp-trail";
import {
  beginExportClock,
  seekStageSequences,
  endExportClock,
  setTimelineDrive,
  isExportClockActive,
  createDomAnimationStepper,
} from "~/utils/export-clock";
import {
  WAVE_AMPLITUDE,
  WAVE_CYCLE_WIDTH,
  WAVE_POS_X,
  WAVE_POS_Y,
} from "#shared/editor/wave-position";
import { BAND_EDGE, BAND_Y } from "#shared/editor/band-position";
import { cloneMeshPoints } from "@shader-lab/core";
import type { MeshPoint } from "@shader-lab/core";
import { MESH_MAX_POINTS } from "@shader-lab/core";

useHead({ title: "Shader — Shader Lab" });

// Remount the page when navigating between compositions (/shader/a → /shader/b)
// so the whole editor state reloads for the new composition.
definePageMeta({ key: (route) => route.fullPath });

const route = useRoute();
const exportOpen = ref(false);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const editorSplitRef = ref<HTMLElement | null>(null);
const { prefs: layoutPrefs, updatePrefs: updateLayoutPrefs } = useEditorLayoutPreferences();

const timelineHeight = ref(layoutPrefs.value.timelineHeight);

const timelineZoom = computed({
  get: () => layoutPrefs.value.timelinePxPerSecond,
  set: (pxPerSecond) => updateLayoutPrefs({ timelinePxPerSecond: pxPerSecond }),
});

const timelineSnapping = computed({
  get: () => layoutPrefs.value.timelineSnapping,
  set: (snapping) => updateLayoutPrefs({ timelineSnapping: snapping }),
});

const { onPointerDown: onTimelineResizePointerDown } = useVerticalPaneResize({
  height: timelineHeight,
  min: 120,
  getMax: () => Math.max(160, (editorSplitRef.value?.clientHeight ?? 600) - 120),
  onResizeEnd: () => updateLayoutPrefs({ timelineHeight: timelineHeight.value }),
});

// --- Load composition from server or preset ---

const routeId = route.params.id as string | undefined;
const presetId = (route.query.preset as string | undefined) ?? DEFAULT_PRESET_ID;
const initialDoc = cloneShaderPreset(
  routeId ? DEFAULT_PRESET_ID : (getShaderPreset(presetId) ? presetId : DEFAULT_PRESET_ID),
);

const shaderId = ref<string | null>(routeId ?? null);
const projectId = ref<string | null>(null);
const shaderName = ref(
  routeId ? "Untitled" : (getShaderPreset(presetId)?.name ?? "Untitled"),
);
const layers = ref<LayerInstance[]>(initialDoc.layers);
const layerCounter = { value: 100 };

function syncLayerCounter() {
  syncLayerIdCounter(layers.value, layerCounter);
}

const settings = ref<CompositionSettings>({
  ...DEFAULT_COMPOSITION_SETTINGS,
  ...initialDoc.settings,
});
const tracks = ref<PropertyTrack[]>(initialDoc.tracks ?? []);
normalizeComposition({
  version: 1,
  layers: layers.value,
  lfos: initialDoc.lfos,
  assignments: initialDoc.assignments,
  settings: settings.value,
  tracks: tracks.value,
});
const lfos = ref<LFOSource[]>(initialDoc.lfos.map((lfo) => normalizeLfo(lfo)));
const assignments = ref<ModulationAssignment[]>(initialDoc.assignments);

const currentTime = ref(0);
const playing = ref(false);
const selectedKeyframes = ref<KeyframeSelection[]>([]);

const selectedLayerId = ref<string | null>(null);
const selectedLayerIds = ref<Set<string>>(new Set());
const selectionAnchorId = ref<string | null>(null);

function syncInitialLayerSelection() {
  const id = layers.value.find((l) => l.enabled)?.id ?? layers.value[0]?.id ?? null;
  selectedLayerId.value = id;
  selectedLayerIds.value = id ? new Set([id]) : new Set();
  selectionAnchorId.value = id;
}

if (routeId) {
  const { data } = await useFetch(`/api/shaders/${routeId}`);
  if (data.value) {
    const comp = data.value as unknown as ShaderDoc;
    shaderId.value = comp.id;
    projectId.value = comp.projectId;
    shaderName.value = comp.name;
    // Legacy URLs may carry the project id; the adapter resolves it to the
    // first composition. Normalize the URL to the canonical comp id so saves
    // and tab highlighting always work off the comp id. Wait for the router's
    // initial navigation: it finalizes with a history.replace of the original
    // URL and would overwrite an earlier replaceState.
    // (window.history explicitly: `history` is the editor's undo history here)
    if (import.meta.client && comp.id !== routeId) {
      const router = useRouter();
      router.isReady().then(() => {
        window.history.replaceState(window.history.state, "", `/shader/${comp.id}`);
      });
    }
    // Old trigger layers → comp sound rules (off the timeline). On the fetched
    // doc itself, before anything copies it: the SSR payload must carry the
    // moved layers AND the rules (idempotent on the client).
    comp.data.tracks ??= [];
    comp.data.settings ??= {} as typeof comp.data.settings;
    migrateTriggerLayers({ layers: comp.data.layers, tracks: comp.data.tracks, settings: comp.data.settings });
    layers.value = comp.data.layers;
    settings.value = { ...DEFAULT_COMPOSITION_SETTINGS, ...comp.data.settings };
    tracks.value = comp.data.tracks ?? [];
    normalizeComposition({
      version: 1,
      layers: layers.value,
      lfos: comp.data.lfos,
      assignments: comp.data.assignments,
      settings: settings.value,
      tracks: tracks.value,
    });
    lfos.value = comp.data.lfos.map((lfo) => normalizeLfo(lfo));
    assignments.value = comp.data.assignments;
    syncInitialLayerSelection();
  }
}

syncInitialLayerSelection();
syncLayerCounter();

// --- Shell: nested-comp trail, project panel, preview ---

/** Drill-in trail from the URL (empty = comp opened standalone). */
const trail = computed<TrailStep[]>(() => parseTrail(route.query.trail));
const rootCompId = computed(() => trail.value[0]?.id ?? shaderId.value);

// Arriving through a trail (or going up): start on the same moment.
{
  const t = Number(route.query.t);
  if (Number.isFinite(t) && t > 0) currentTime.value = Math.min(t, settings.value.duration);
}

/** The part of this comp its parent shows (child time), when drilled in. */
const usedRange = computed(() => {
  const step = trail.value.at(-1);
  if (!step) return null;
  const end = step.out != null ? step.out - step.in : settings.value.duration;
  return { start: 0, end: Math.max(0, Math.min(end, settings.value.duration)) };
});

/** Double-click a comp layer: go in (same tab, synced time) or open it in its own tab. */
function openNestedComp(layer: LayerInstance, newTab = false) {
  const ref = layer.values.compRefId;
  if (typeof ref !== "string" || !ref || !shaderId.value) return;
  if (newTab) {
    navigateTo(`/shader/${ref}`);
    return;
  }
  const inT = layer.timing?.in ?? 0;
  const step: TrailStep = { id: shaderId.value, in: inT, out: layer.timing?.out ?? null };
  navigateTo(compUrl(ref, [...trail.value, step], Math.max(0, currentTime.value - inT)));
}

const PROJECT_PANEL_KEY = "shader-lab:project-panel-open";
const projectPanelOpen = ref(false);
onMounted(() => {
  try {
    projectPanelOpen.value = localStorage.getItem(PROJECT_PANEL_KEY) === "1";
  } catch {}
});
function toggleProjectPanel() {
  projectPanelOpen.value = !projectPanelOpen.value;
  try {
    localStorage.setItem(PROJECT_PANEL_KEY, projectPanelOpen.value ? "1" : "0");
  } catch {}
}

/** Preview: canvas alone, full window, playing. Esc or click to leave. */
const previewing = ref(false);
function startPreview() {
  previewing.value = true;
  playing.value = true;
  nextTick(() => viewport.fit());
}
function stopPreview() {
  previewing.value = false;
  playing.value = false;
  nextTick(() => viewport.fit());
}
onMounted(() => {
  window.addEventListener("keydown", (e) => {
    if (previewing.value && e.key === "Escape") stopPreview();
  });
});

const selectedLayer = computed(() => {
  if (!selectedLayerId.value) return null;
  return layers.value.find((l) => l.id === selectedLayerId.value) ?? null;
});

const selectedTemplate = computed(() => {
  if (!selectedLayer.value) return null;
  return LAYER_TEMPLATES[selectedLayer.value.type] ?? null;
});

// --- Canvas tool + inline text editing ---

const activeTool = ref<CanvasTool>("select");
const textEditingLayerId = ref<string | null>(null);
const textEditIntent = ref<TextEditIntent>({ type: "end" });

const textEditingLayer = computed(() => {
  const id = textEditingLayerId.value;
  if (!id) return null;
  const layer = layers.value.find((l) => l.id === id);
  return layer?.type === "text" ? layer : null;
});

// --- LFO state ---

const selectedLfoId = ref<string | null>(null);
const draggingLfoId = ref<string | null>(null);

// --- Modulation Engine ---

const { lfoValues, getModulatedValue, modFn, sampleLfosAtTime, modFnAt } = useModulationEngine(
  lfos,
  assignments,
  {
    clockTime: currentTime,
    tracks,
    layers,
    compSize: computed(() => ({ width: settings.value.width, height: settings.value.height })),
  },
);

provide("lfoValues", lfoValues);
// Modulator editors (LFO config) read/write keyframed params (mod:<id> tracks).
provide("editorTracks", tracks);
provide("editorLayers", layers);
provide("editorSettings", settings);
// Precomp layers read their nested comp (props panel).
provide("editorResolveComposition", (id: string) => resolveComposition(id));
provide("editorProjectId", projectId);

// Project-level components (`<project>/components/*.vue`): load with the
// project, re-check when the window regains focus (you edited a file).
watch(projectId, (id) => void loadProjectComponents(id), { immediate: true });
useEventListener(typeof window !== "undefined" ? window : null, "focus", () => {
  void loadProjectComponents(projectId.value);
});
provide("editorTime", currentTime);

// --- Playback ---

let playbackId: number | null = null;
let lastPlaybackMs = 0;
/** A playback-driven render of the next uncached frame is in flight. */
let renderStepping = false;
let playbackClock = 0;
const audioLayerIds = computed(() => new Set(layers.value.filter((l) => l.type === "audio").map((l) => l.id)));

function playbackTick(now: number) {
  if (!playing.value) return;
  const delta = lastPlaybackMs === 0 ? 0 : (now - lastPlaybackMs) / 1000;
  lastPlaybackMs = now;

  playbackClock += delta;
  const fps = settings.value.fps;
  const step = 1 / fps;
  // Epsilon: frame·step/step must land back on the same frame (no back-step flicker).
  let frame = Math.floor(playbackClock / step + 1e-6);
  const maxFrame = Math.floor(settings.value.duration * fps);
  if (frame >= maxFrame) {
    frame = 0;
    playbackClock = 0;
  }

  // AE-style: cached frames play in real time; on uncached frames playback
  // steps frame by frame as fast as they render (caching them), then returns
  // to real time. Nothing else renders while playing.
  const fc = frameCache;
  if (fc.has(frame)) {
    fc.buffering.value = false;
    currentTime.value = frame * step;
    audioPlayback.tick(playbackClock, true);
  } else {
    audioPlayback.tick(currentTime.value, false);
    playbackClock = currentTime.value; // hold the clock while this frame renders
    if (!renderStepping) {
      renderStepping = true;
      fc.buffering.value = true;
      const next = (fc.frameOf(currentTime.value) + 1) % fc.frameCount();
      void fc
        .ensure(next)
        .catch(() => false)
        .finally(() => {
          renderStepping = false;
          if (!playing.value) return;
          // Advance even if the frame couldn't be kept (cache full): it's on screen live.
          currentTime.value = next * step;
          playbackClock = currentTime.value;
          lastPlaybackMs = 0; // continue from here, no catch-up jump
        });
    }
  }
  playbackId = requestAnimationFrame(playbackTick);
}

watch(playing, (isPlaying) => {
  if (isPlaying) {
    playbackClock = currentTime.value;
    lastPlaybackMs = 0;
    playbackId = requestAnimationFrame(playbackTick);
  } else {
    audioPlayback.stop();
    if (playbackId !== null) {
      cancelAnimationFrame(playbackId);
      playbackId = null;
    }
  }
});

onBeforeUnmount(() => {
  if (playbackId !== null) cancelAnimationFrame(playbackId);
});

// --- Viewport (artboard + zoom/pan) ---

const viewportRef = ref<HTMLElement | null>(null);
const artboardSize = computed(() => ({
  width: settings.value.width,
  height: settings.value.height,
}));
const viewport = useViewport(viewportRef, artboardSize);

/** Canvas footer zoom dropdown: Fit + common steps (+ the current zoom when it's in between). */
const zoomOptions = computed(() => {
  const steps = [25, 50, 100, 200, 400];
  const current = viewport.zoomPercent.value;
  const list = [{ value: "fit", label: "Fit" }, ...steps.map((p) => ({ value: String(p), label: `${p} %` }))];
  if (!viewport.fitMode.value && !steps.includes(current)) list.push({ value: String(current), label: `${current} %` });
  return list;
});
function setZoomChoice(v: string) {
  if (v === "fit") viewport.fit();
  else viewport.zoomAt(Number(v) / 100);
}

/** Render buffer follows the displayed size (crisp zoom), capped for VRAM. */
const debouncedZoom = refDebounced(viewport.zoom, 150);
/** Preview resolution (AE's Full / Half / Quarter): render buffer scale, remembered per browser. */
const PREVIEW_RES_KEY = "shaderlab.previewResolution";
const previewResolution = ref<string>(
  (import.meta.client && localStorage.getItem(PREVIEW_RES_KEY)) || "0.5",
);
watch(previewResolution, (v) => {
  try {
    localStorage.setItem(PREVIEW_RES_KEY, v);
  } catch {}
});
const PREVIEW_RES_OPTIONS = [
  { value: "1", label: "Full" },
  { value: "0.5", label: "Half" },
  { value: "0.25", label: "Quarter" },
];

const renderBufferSize = computed(() => {
  const { width, height } = settings.value;
  const dpr = import.meta.client ? window.devicePixelRatio || 1 : 1;
  let scale = Math.min(Math.max(debouncedZoom.value * dpr, 0.05), 2) * (Number(previewResolution.value) || 1);
  scale = Math.min(scale, 4096 / Math.max(width, height));
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
});
const compositionWidth = computed(() => settings.value.width);
const compositionHeight = computed(() => settings.value.height);

const COMP_SIZE_PRESETS = [
  { label: "Landscape 16:9", width: 1920, height: 1080 },
  { label: "Portrait 9:16", width: 1080, height: 1920 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Social 4:5", width: 1080, height: 1350 },
] as const;

function setCompositionSize(width: number, height: number) {
  const w = Math.min(8192, Math.max(16, Math.round(width) || 0));
  const h = Math.min(8192, Math.max(16, Math.round(height) || 0));
  if (!w || !h || (w === settings.value.width && h === settings.value.height)) return;
  settings.value = { ...settings.value, width: w, height: h };
  history.record();
}

// --- Layer Compiler + Renderer ---

/**
 * Layers as the renderer sees them: identical object references (uniforms are
 * read live from them), except the text layer being inline-edited renders
 * disabled — the DOM overlay is the source of truth while editing.
 */
const renderLayers = computed<LayerInstance[]>(() => {
  const id = textEditingLayerId.value;
  if (!id) return layers.value;
  return layers.value.map((l) => (l.id === id ? { ...l, enabled: false } : l));
});

// Nested compositions: fetch referenced comps (and their refs) into a
// registry the compiler and renderer resolve against.
const { registry, registryVersion, resolveComposition, refetch: refetchNestedComp } = useCompRegistry({
  projectId,
  layers,
});
/** Mixer panel above the timeline (remembered). */
const MIXER_KEY = "shaderlab.mixerOpen";
const mixerOpen = ref(false);
onMounted(() => {
  try {
    mixerOpen.value = localStorage.getItem(MIXER_KEY) === "1";
  } catch {}
});
function toggleMixer() {
  mixerOpen.value = !mixerOpen.value;
  try {
    localStorage.setItem(MIXER_KEY, mixerOpen.value ? "1" : "0");
  } catch {}
}
/** Audio layers (incl. nested comps): in sync while playback is real time, quiet while it steps. */
// --- Sound rules: project kit + comp rules → virtual audio layers (not on the timeline) ---

const projectRules = ref<SoundRule[]>([]);
let projectRulesSavedAt = 0;
let projectRulesLoaded = false;
async function loadProjectRules() {
  if (!projectId.value || import.meta.server) return;
  const res = await $fetch<{ rules: SoundRule[] }>(`/api/projects/${projectId.value}/sound-rules`).catch(() => null);
  projectRulesLoaded = false;
  projectRules.value = res?.rules ?? [];
  await nextTick();
  projectRulesLoaded = true;
}
watch(projectId, () => void loadProjectRules(), { immediate: true });
const saveProjectRules = useDebounceFn(async () => {
  if (!projectId.value || (import.meta.client && new URLSearchParams(location.search).has("nosave"))) return;
  projectRulesSavedAt = Date.now();
  await $fetch(`/api/projects/${projectId.value}/sound-rules`, { method: "PUT", body: { rules: toRaw(projectRules.value) } }).catch((e) => console.warn("[sound rules] save failed", e));
}, 400);
watch(projectRules, () => projectRulesLoaded && void saveProjectRules(), { deep: true });

provide("soundRules", { project: projectRules, projectId });

/** Rules in effect for this comp, as virtual audio layers ("rule:<id>"). */
const ruleLayers = computed(() =>
  effectiveRules(projectRules.value, (settings.value.soundRules as SoundRule[] | undefined) ?? []).map((r) => ruleLayer(r.rule)),
);
/** Everything that makes sound in this comp: timeline layers + rules. */
const audioLayers = computed(() => (ruleLayers.value.length ? [...layers.value, ...ruleLayers.value] : layers.value));

const audioPlayback = useAudioPlayback({
  layers: audioLayers,
  tracks,
  resolveComposition: (id) => resolveComposition(id),
  registryVersion,
  masterVolume: () => settings.value.masterVolume ?? 0,
  masterEffects: () => settings.value.masterEffects as AudioEffect[] | undefined,
  duration: () => settings.value.duration,
  frame: () => settings.value,
  settings: () => settings.value,
});

// Project comp list, shared with the project panel, the comp tab strip and
// the inspector's Composition select (useProjectCompositions). One refresh on
// mount keeps every consumer fresh without triple-fetching.
const { project, comps: projectComps, refresh: refreshProjectComps } =
  useProjectCompositions(projectId);
onMounted(refreshProjectComps);

const projectName = computed(() => project.value?.name);
const compNames = computed<Record<string, string>>(() =>
  Object.fromEntries(projectComps.value.map((c) => [c.id, c.name])),
);

// Renames happen in the tabs / project panel (server-side); keep the local
// name in step so autosave doesn't write the old one back.
watch(projectComps, (list) => {
  const name = list.find((c) => c.id === shaderId.value)?.name;
  if (name && name !== shaderName.value) shaderName.value = name;
});

/** Selectable nesting targets: every project comp except the open one (self-cycle). */
const compRefOptions = computed(() =>
  projectComps.value
    .filter((c) => c.id !== shaderId.value)
    .map((c) => ({ value: c.id, label: c.name })),
);
provide("compRefOptions", compRefOptions);

const { passes } = useLayerCompiler(renderLayers, modFn, lfos, assignments, {
  resolveComposition,
  registryVersion,
  rootCompositionId: shaderId,
});
const {
  getCanvas,
  capture,
  pause,
  resume,
  configureRenderer,
  restoreRenderer,
  renderFrame,
  setComponentSource,
  setMediaSource,
  requestRender,
  setLiveRenderEnabled,
} = useMultiPassRenderer(canvasRef, passes, {
  layers,
  tracks,
  fixedBufferSize: renderBufferSize,
  scaleReferenceWidth: compositionWidth,
  contentReferenceHeight: compositionHeight,
  getModulatedValue: modFn,
  resolveComposition,
  sampleLfosAtTime,
  compositionTime: currentTime,
  modFnAt,
  // Cheaper while playing; full samples on still frames and export.
  // Editor renders stay light (2 sub-frames); exports render every motion-blur sample.
  // Export and RAM-preview renders get every sample; only live interaction
  // (dragging, stepping through uncached frames) uses a cheap 2-sample blur.
  motionBlurTimes: (time) =>
    motionBlurSampleTimes(time, settings.value, isExportClockActive() || fullQualityRender ? Infinity : 2),
});

// --- Component layers: off-screen stage + DOM capture ---

/** Set while the RAM preview renders a frame it keeps (full motion-blur samples). */
let fullQualityRender = false;
const stageHostRef = ref<{ getElement: (layerId: string) => HTMLElement | null } | null>(null);

/**
 * Every component layer occurrence to stage: the open comp's own plus those
 * inside nested comps, keyed by core's pass id (`host::layerId`) so a precomp
 * with a component looks the same from outside as inside. `inOffset` = summed
 * host in-points (root time − inOffset = the nested comp's local time).
 */
const stagedComponents = computed(() => {
  void registryVersion.value;
  // windows: root-time [in, out] of the layer and of every host comp around it.
  type Win = [number, number];
  // hosts: prefixed ids of the precomp layers around it (root → innermost).
  const out: { layer: LayerInstance; inOffset: number; windows: Win[]; hosts: string[] }[] = [];
  const winOf = (l: LayerInstance, inOffset: number): Win => [
    inOffset + (l.timing?.in ?? -Infinity),
    inOffset + (l.timing?.out ?? Infinity),
  ];
  const walk = (list: LayerInstance[], prefix: string, inOffset: number, visited: Set<string>, depth: number, hostWins: Win[] = [], hosts: string[] = []) => {
    for (const layer of list) {
      if (!layer.enabled) continue;
      if (layer.type === "component") {
        out.push({
          layer: prefix ? { ...layer, id: `${prefix}${layer.id}` } : layer,
          inOffset,
          windows: [...hostWins, winOf(layer, inOffset)],
          hosts,
        });
        continue;
      }
      if (layer.type !== "composition" || depth >= 4) continue;
      const compId = layer.values.compRefId;
      if (typeof compId !== "string" || !compId || visited.has(compId)) continue;
      const resolved = resolveComposition(compId);
      if (!resolved) continue;
      const config = applyCompProps(resolved, layer); // per-instance props (component, pointer…)
      walk(config.layers, `${prefix}${layer.id}${NESTED_SEP}`, inOffset + (layer.timing?.in ?? 0), new Set([...visited, compId]), depth + 1, [...hostWins, winOf(layer, inOffset)], [...hosts, `${prefix}${layer.id}`]);
    }
  };
  walk(renderLayers.value, "", 0, new Set(), 0);
  return out;
});
const stagedComponentLayers = computed(() => stagedComponents.value.map((c) => c.layer));

/**
 * Pointer layers drive hover / pressed in the components that follow them:
 * in this comp, and inside precomps (a Pointer prop hands Main's pointer in;
 * its position is mapped through each precomp layer's transform).
 */
function samplePointers(time = currentTime.value) {
  const comps = stagedComponents.value;
  const hasLegacyCursor = renderLayers.value.some((l) => l.type === "image" && Number(l.values.timelineCursor) === 1);
  if (!hasLegacyCursor && !comps.some((c) => typeof c.layer.values.pointer === "string" && c.layer.values.pointer)) return;
  const root = time === currentTime.value ? getModulatedValue : modFnAt(time);
  const nested = createNestedResolvers({ layers: renderLayers.value, parentModFn: root, resolveComposition, time });
  seekTimelinePointers({
    components: comps.map((c) => ({ layer: c.layer, hosts: c.hosts })),
    layersOf: compLayersOf,
    time,
    frame: settings.value,
    getRoot: (id) => stageHostRef.value?.getElement(id) ?? null,
    sample: nested.modFn,
  });
}

/** A comp's layers by id prefix ("" = this comp, "h1::h2::" = nested), props applied. */
function compLayersOf(prefix: string): LayerInstance[] {
  let list: LayerInstance[] = renderLayers.value;
  for (const hostId of prefix.split(NESTED_SEP).filter(Boolean)) {
    const host = list.find((l) => l.id === hostId);
    const compId = host?.values.compRefId;
    const resolved = typeof compId === "string" ? resolveComposition(compId) : null;
    if (!host || !resolved) return [];
    list = applyCompProps(resolved, host).layers;
  }
  return list;
}

const componentCapture = useComponentCapture({
  layers: stagedComponentLayers,
  samplePointer: samplePointers,
  isActive: (layerId, time) => {
    const t = time ?? currentTime.value;
    const entry = stagedComponents.value.find((c) => c.layer.id === layerId);
    return !entry || entry.windows.every(([a, b]) => t >= a && t < b);
  },
  getElement: (layerId) => stageHostRef.value?.getElement(layerId) ?? null,
  setComponentSource,
  requestRender,
});

// --- Image/video layers: host-side decode + playhead-driven video time ---

const mediaSources = useMediaSources({
  layers,
  setMediaSource,
  requestRender,
  currentTime,
  compSize: () => ({ width: settings.value.width, height: settings.value.height }),
  // Nested comps: register image/video sources under `host::layerId` pass ids.
  resolveComposition,
  registryVersion,
});

// Default clip length: a video layer with no timing yet gets out = its clip
// end (min(video duration, comp duration); the timeline stores the exact
// full-width window as "no timing", so a clip longer than the comp stays
// timing-less). Applied once per layer so clearing the bar sticks.
const defaultedClipLengths = new Set<string>();
watch(
  () => [...mediaSources.durations.entries()],
  (entries) => {
    for (const [layerId, duration] of entries) {
      if (!(duration > 0) || defaultedClipLengths.has(layerId)) continue;
      defaultedClipLengths.add(layerId);
      const layer = layers.value.find((l) => l.id === layerId);
      if (!layer || layer.type !== "video" || layer.timing) continue;
      const out = Math.min(duration, settings.value.duration);
      if (out >= settings.value.duration - 1e-6) continue;
      layer.timing = { out };
    }
  },
);

// The renderer follows the playhead (compositionTime: currentTime), so an
// export must DRIVE the playhead: keyframe tracks and LFO sampling all key
// off currentTime. Passing a time only into renderFrame() gets overridden by
// the frozen playhead and exports lose every keyframed animation.
let exportRestoreTime: number | null = null;

// Virtual clock: while exporting, timed sequences are seeked to exact frame
// times and Web Animations under the component stages are paused and stepped
// per frame, so self-animating components bake identically on every run.
const exportAnimationStepper = createDomAnimationStepper();
let lastExportFrameTime: number | null = null;

/**
 * Timeline drive: a staged component's internal time is the playhead time
 * minus the layer's in-point, so component beats line up with keyframes both
 * while scrubbing and in exports.
 */
function seekStageToCompTime(tSec: number): void {
  const offsets = new Map<string, number>();
  for (const { layer, inOffset } of stagedComponents.value) {
    offsets.set(layer.id, Math.max(0, (tSec - inOffset - (layer.timing?.in ?? 0)) * 1000));
  }
  seekStageSequences((layerId) => {
    if (layerId === null) return Math.max(0, tSec * 1000);
    return offsets.get(layerId) ?? null;
  });
}

onMounted(() => setTimelineDrive(true));
onBeforeUnmount(() => setTimelineDrive(false));

watch(currentTime, (t) => {
  seekStageToCompTime(t);
});
// Newly staged components (e.g. a nested comp arriving) start at the playhead, not at 0.
watch(stagedComponents, () => nextTick(() => seekStageToCompTime(currentTime.value)), { immediate: true });

function componentStageRoots(): Element[] {
  const roots: Element[] = [];
  for (const layer of stagedComponentLayers.value) {
    const el = stageHostRef.value?.getElement(layer.id);
    if (el) roots.push(el);
  }
  return roots;
}

const shaderExport = {
  capture: async (w: number, h: number) => {
    await componentCapture.captureAll();
    return capture(w, h, `${shaderId.value ?? "shader"}-${w}x${h}.png`);
  },
  // Exports drive capture per frame; the live loop would only race them.
  pause: () => {
    exportRestoreTime = currentTime.value;
    lastExportFrameTime = null;
    componentCapture.pause();
    mediaSources.pause();
    pause();
    beginExportClock();
  },
  resume: () => {
    exportAnimationStepper.release(componentStageRoots());
    endExportClock();
    if (exportRestoreTime !== null) {
      currentTime.value = exportRestoreTime;
      exportRestoreTime = null;
    }
    resume();
    componentCapture.resume();
    mediaSources.resume();
  },
  renderAudio: (duration: number) => renderAudioMix(audioLayers.value, tracks.value, duration, resolveComposition, settings.value.masterVolume ?? 0, settings.value.masterEffects as AudioEffect[] | undefined, { frame: settings.value, settings: settings.value }),
  getCanvas,
  configureRenderer,
  restoreRenderer,
  renderFrame: async (time: number) => {
    currentTime.value = time;
    // 1. Seek sequences to the frame time (fires their due events).
    seekStageToCompTime(time);
    // 2. Pointer hover/press for this frame, then let Vue flush the resulting
    //    DOM changes so new CSS transitions exist (and get stepped below).
    samplePointers(time);
    await nextTick();
    // 3. Freeze + step all stage animations by exactly one frame. The first
    //    frame instead cancels animations inherited from the live preview so
    //    every run starts from the same clean state.
    if (lastExportFrameTime === null) {
      exportAnimationStepper.reset(componentStageRoots());
    } else {
      exportAnimationStepper.step(componentStageRoots(), (time - lastExportFrameTime) * 1000);
    }
    lastExportFrameTime = time;
    // 4. Seek every video layer to the exact frame time (awaits `seeked`).
    await mediaSources.syncForExport(time);
    // 5. Capture the DOM in that exact state and render.
    await componentCapture.captureAll(time);
    renderFrame(time);
  },
};

// --- Renders: metadata, video reuse, CLI hook ---

/** Everything that affects the PICTURE (not the audio): same value = same video. */
const visualFingerprint = computed(() => {
  const json = JSON.stringify([
    layers.value.filter((l) => l.type !== "audio"),
    lfos.value,
    assignments.value,
    settings.value,
    tracks.value.filter((t) => !audioLayerIds.value.has(t.layerId)),
    Object.keys(registry.value).sort().map((k) => [k, registry.value[k]]),
    projectComponents.value,
    RENDER_ENGINE_VERSION,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${json.length.toString(36)}`;
});

type StoredRender = { fingerprint?: string; width?: number; height?: number; fps?: number; duration?: number; url: string };

/** Metadata for a render, plus the stored video when only the audio changed since. */
async function prepareVideoExport(s: { width: number; height: number; fps: number; duration: number }) {
  const meta: Record<string, unknown> = {
    app: "shader-lab",
    projectId: projectId.value,
    compId: shaderId.value,
    compName: shaderName.value,
    fingerprint: visualFingerprint.value,
    engine: RENDER_ENGINE_VERSION,
  };
  let reuseVideo: { url: string } | null = null;
  if (projectId.value && shaderId.value) {
    const stored = await $fetch<StoredRender | null>(`/api/local/renders/${projectId.value}/${shaderId.value}`).catch(() => null);
    if (
      stored &&
      stored.fingerprint === meta.fingerprint &&
      stored.width === s.width &&
      stored.height === s.height &&
      stored.fps === s.fps &&
      Math.abs((stored.duration ?? 0) - s.duration) < 1e-6
    ) {
      reuseVideo = { url: stored.url };
    }
  }
  return { meta, reuseVideo };
}

/** Keep the finished render in the project (`.shaderlab/renders/`, local mode). */
async function storeRender(result: { blob: Blob; meta: Record<string, unknown> }) {
  if (!projectId.value || !shaderId.value) return null;
  // Raw body, streamed to disk server-side (renders can be hundreds of MB).
  const qs = new URLSearchParams({ projectId: projectId.value, compId: shaderId.value });
  return await $fetch<Record<string, unknown>>(`/api/local/renders?${qs}`, {
    method: "POST",
    body: result.blob,
    headers: { "content-type": "application/octet-stream", "x-render-meta": encodeURIComponent(JSON.stringify(result.meta)) },
  }).catch((err) => {
    console.warn("[render] couldn't store the render", err);
    return null;
  });
}

/**
 * One render of this comp, for the export dialog's sibling: the CLI
 * (`shaderlab render`) calls `window.__shaderlab.render(...)` in a hidden
 * browser and gets back where the file was stored + what it is.
 */
async function renderComp(opts: { scale?: number; fps?: number; format?: "auto" | "mp4" | "webm"; audioOnly?: boolean; fresh?: boolean } = {}) {
  const scale = opts.scale ?? 1;
  const width = Math.round(settings.value.width * scale);
  const height = Math.round(settings.value.height * scale);
  const fps = opts.fps ?? settings.value.fps;
  const duration = settings.value.duration;
  if (opts.audioOnly) {
    const mix = await renderAudioMix(audioLayers.value, tracks.value, duration, resolveComposition, settings.value.masterVolume ?? 0, settings.value.masterEffects as AudioEffect[] | undefined, { frame: settings.value, settings: settings.value });
    if (!mix) return { ok: false, error: "This comp has no audio layers" };
    const meta = {
      app: "shader-lab", kind: "audio", projectId: projectId.value, compId: shaderId.value, compName: shaderName.value,
      duration, sampleRate: mix.sampleRate, channels: mix.numberOfChannels, renderedAt: new Date().toISOString(),
    };
    const stored = await storeRender({ blob: audioBufferToWav(mix), meta });
    return { ok: !!stored, meta, stored };
  }
  await componentCapture.captureAll();
  const { meta, reuseVideo } = await prepareVideoExport({ width, height, fps, duration });
  const exporter = useVideoExport();
  (window as unknown as { __shaderlabProgress?: unknown }).__shaderlabProgress = exporter.state;
  frameCache.suspend(true);
  let result;
  try {
    result = await exporter.exportVideo(shaderExport, {
      width, height, fps, duration, experimentId: shaderId.value ?? "shader", format: opts.format ?? "auto",
      meta, reuseVideo: opts.fresh ? null : reuseVideo, deliver: "return",
    });
  } finally {
    frameCache.suspend(false);
  }
  if (!result) return { ok: false, error: exporter.state.error ?? "Render failed" };
  const stored = await storeRender(result);
  return { ok: !!stored, meta: result.meta, stored, frozen: result.frozen, reusedVideo: result.reusedVideo };
}

if (import.meta.client) {
  (window as unknown as { __shaderlab?: unknown }).__shaderlab = {
    render: renderComp,
    /** True once nested comps, components and media are loaded enough to render. */
    /**
     * Comp loaded AND every staged component loaded + mounted (their cues
     * register on mount; renders that start earlier miss late components).
     */
    ready: () => {
      if (!shaderId.value) return false;
      const layers = stagedComponentLayers.value;
      if (!layers.length) return true;
      if (projectId.value && projectComponentsLoadedFor !== projectId.value) return false;
      if (stageComponentLoadsPending() > 0) return false;
      return layers.every((l) => {
        const name = componentNameFromValues(l.values);
        if (!name || !resolveStageComponent(name)) return true; // missing component: nothing to wait for
        return !!stageHostRef.value?.getElement(l.id)?.firstElementChild;
      });
    },
    /** Loudness: master (integrated / short-term LUFS, true peak), each strip solo, trigger sync. */
    /** Sound rules in effect (project kit + comp), with their scope. */
    rules: () => ({
      project: projectRules.value.length,
      comp: ((settings.value.soundRules as SoundRule[] | undefined) ?? []).length,
      effective: effectiveRules(projectRules.value, (settings.value.soundRules as SoundRule[] | undefined) ?? []).map((r) => ({ id: r.rule.id, scope: r.scope, label: r.rule.label, on: r.rule.on })),
      audioLayers: audioLayers.value.length,
    }),
    /** Switch to a mix version by id or name (render / meter it next). */
    saveMix: (name: string) => (saveMixVersion(name), { ok: true, activeMix: settings.value.activeMix }),
    mix: (idOrName: string) => ({ ok: useMixVersion(idOrName), versions: (settings.value.mixVersions ?? []).map((m) => m.name) }),
    meter: async () => {
      const duration = settings.value.duration;
      const mixOf = (ls: LayerInstance[]) =>
        renderAudioMix(ls, tracks.value, duration, resolveComposition, settings.value.masterVolume ?? 0, settings.value.masterEffects as AudioEffect[] | undefined, { frame: settings.value, settings: settings.value });
      const full = await mixOf(audioLayers.value);
      if (!full) return { ok: false, error: "This comp has no sound" };
      const master = await measureLoudness(full);
      const stripLayers = audioLayers.value.filter((l) => l.type === "audio" || (l.type === "composition" && audioPlayback.entries.value.some((e) => e.hosts[0]?.key === l.id)));
      const strips = [];
      for (const l of stripLayers.slice(0, 96)) {
        const solo = audioLayers.value.map((x) => {
          const { audioSolo: _s, ...rest } = x;
          return x.id === l.id ? { ...rest, audioSolo: true } : rest;
        }) as LayerInstance[];
        const buf = await mixOf(solo);
        const m = buf ? await measureLoudness(buf) : null;
        strips.push({ layer: l.name ?? l.id, layerId: l.id, kind: l.type, integratedLufs: m?.integratedLufs ?? null, truePeakDb: m?.truePeakDb ?? null, maxShortTermLufs: m?.maxShortTermLufs ?? null });
      }
      // Trigger sync: where each hit's anchor lands vs its picture event.
      const sync = [];
      for (const l of audioLayers.value.filter((x) => x.type === "audio" && x.trigger)) {
        const srcs = [l.values.src as string, ...((((l.trigger as { alternates?: string[] }).alternates) ?? []))];
        const bufs = new Map<string, AudioBuffer | null>();
        for (const s of srcs) bufs.set(s, await decodeAudio(s));
        for (const h of triggerHits(l, { layers: layers.value, tracks: tracks.value, settings: settings.value }, { prefix: "", resolveComposition, frame: settings.value, buffers: (s) => bufs.get(s) ?? null })) {
          const buf = bufs.get(h.src);
          const anchor = (l.trigger as { anchor?: "onset" | "peak" | "end" }).anchor ?? "onset";
          const lands = buf ? h.start + soundAnchors(buf)[anchor] / h.rate : h.start;
          const eventAt = h.event.type === "motion" ? ((l.trigger as { on: string }).on === "motionStart" ? h.event.start : (l.trigger as { on: string }).on === "motionEnd" ? h.event.end : h.event.time) ?? h.event.time : h.event.time;
          sync.push({ layer: l.name ?? l.id, event: `${h.event.type}${h.event.name ? `:${h.event.name}` : ""}`, from: h.event.layer, eventAt: Math.round(eventAt * 1000) / 1000, lands: Math.round(lands * 1000) / 1000, offsetMs: Math.round((lands - eventAt) * 1000) });
        }
      }
      return { ok: true, master, strips, sync };
    },
    /** Sync points in comp time: motion peaks, presses, in/out, component cues, markers. */
    events: () =>
      collectCompEvents(
        { version: 1, layers: layers.value, lfos: lfos.value, assignments: assignments.value, settings: settings.value, tracks: tracks.value },
        { resolveComposition, frame: settings.value },
      ),
  };
}

// --- RAM preview (frame cache) ---

const cacheCanvasRef = ref<HTMLCanvasElement | null>(null);
const frameCache = useFrameCache({
  fps: () => settings.value.fps,
  duration: () => settings.value.duration,
  // Content, not counters: nested comps by their data (a remount re-loads them,
  // the hash comes back the same and the cached frames are reused).
  signature: () => [
    // Audio layers don't change the picture: editing them keeps cached frames.
    layers.value.filter((l) => l.type !== "audio"),
    lfos.value, assignments.value, settings.value,
    tracks.value.filter((t) => !audioLayerIds.value.has(t.layerId)),
    // Sorted: nested comps load in any order; the hash must not depend on it.
    Object.keys(registry.value).sort().map((k) => [k, registry.value[k]]),
    previewResolution.value, textEditingLayerId.value,
    // Editing a component file re-renders the frames that use it.
    projectComponents.value,
    // Engine changes (shaders, blur…) invalidate frames rendered by older code.
    RENDER_ENGINE_VERSION,
  ],
  cacheKey: () => shaderId.value ?? "",
  getCanvas,
  renderAt: async (time: number) => {
    seekStageToCompTime(time);
    await nextTick();
    if (layers.value.some((l) => l.type === "video")) await mediaSources.syncForExport(time);
    await componentCapture.captureAll(time);
    // Cached frames are kept: render them at export quality (all blur samples).
    fullQualityRender = true;
    try {
      renderFrame(time);
    } finally {
      fullQualityRender = false;
    }
  },
  restoreLive: () => {
    seekStageToCompTime(currentTime.value);
    setLiveRenderEnabled(true);
    requestRender();
  },
  playing,
  currentTime,
});
/** Green bar on the timeline (throttled by the cache's version bumps). */
const cachedRanges = computed(() => {
  void frameCache.version.value;
  return frameCache.ranges();
});
// Live renders (and live DOM capture) only while the overlay isn't covering the canvas.
watch(frameCache.showing, (s) => {
  setLiveRenderEnabled(!s);
  if (s) componentCapture.pause();
  else componentCapture.resume();
});
// Draw the playhead's cached frame into the overlay.
watch(
  () => [currentTime.value, frameCache.version.value, frameCache.showing.value] as const,
  () => {
    const c = cacheCanvasRef.value;
    const bmp = frameCache.get(frameCache.frameOf(currentTime.value));
    if (!c || !bmp) return;
    // Frames cached at another size (zoom / resize since) are scaled to fit.
    if (c.width !== bmp.width || c.height !== bmp.height) {
      c.width = bmp.width;
      c.height = bmp.height;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
  },
  { flush: "post" },
);

// --- Auto-Save ---

const shaderData = computed(() => ({
  version: 1 as const,
  layers: layers.value,
  lfos: lfos.value,
  assignments: assignments.value,
  settings: settings.value,
  tracks: tracks.value,
}));

useAutoSave(shaderId, shaderName, shaderData, { getCanvas, projectId });

// --- Mix versions (A/B the sound on the same picture) ---

/** Keep the active version in sync with edits, then snapshot a new one. */
function saveMixVersion(name: string) {
  const list = syncActiveMix();
  const v = snapshotMix(name, layers.value, tracks.value, settings.value);
  settings.value = { ...settings.value, mixVersions: [...list, v as unknown as NonNullable<CompositionSettings["mixVersions"]>[number]], activeMix: v.id };
  history.record();
}
/** The stored versions with the active one refreshed from the current sound. */
function syncActiveMix() {
  const list = settings.value.mixVersions ?? [];
  const active = list.find((m) => m.id === settings.value.activeMix);
  if (!active) return list;
  const fresh = { ...snapshotMix(active.name, layers.value, tracks.value, settings.value), id: active.id, createdAt: active.createdAt };
  return list.map((m) => (m.id === active.id ? (fresh as unknown as typeof m) : m));
}
function useMixVersion(idOrName: string): boolean {
  const list = syncActiveMix();
  const v = list.find((m) => m.id === idOrName || m.name === idOrName);
  if (!v) return false;
  const next = applyMix(v as unknown as MixVersion, layers.value, tracks.value, settings.value);
  layers.value = next.layers;
  tracks.value = next.tracks;
  settings.value = { ...next.settings, mixVersions: list };
  history.record();
  return true;
}

// --- Auto-reload: comps changed on disk (agents, git) show up without a refresh ---

/** Last known file time per comp; our own saves update it so they don't count as external. */
const compMtimes = new Map<string, number>();
let ownSaveAt = 0;
watch(shaderData, () => (ownSaveAt = Date.now()), { deep: true });
async function pollDisk() {
  if (!projectId.value || document.hidden) return;
  const res = await $fetch<{ comps: Record<string, number> }>(`/api/local/project-mtimes/${projectId.value}`).catch(() => null);
  if (!res) return;
  for (const [id, mtime] of Object.entries(res.comps)) {
    const known = compMtimes.get(id);
    compMtimes.set(id, mtime);
    if (known === undefined || mtime <= known) continue;
    if (id === "__soundRules") {
      if (Date.now() - projectRulesSavedAt > 2500) void loadProjectRules();
      continue;
    }
    if (id === shaderId.value) {
      // Our own autosave writes too: only reload when we haven't edited lately.
      if (Date.now() - ownSaveAt < 2500) continue;
      const doc = await $fetch<ShaderDoc>(`/api/shaders/${id}`).catch(() => null);
      if (!doc?.data) continue;
      doc.data.tracks ??= [];
      doc.data.settings ??= {} as typeof doc.data.settings;
      migrateTriggerLayers({ layers: doc.data.layers, tracks: doc.data.tracks, settings: doc.data.settings });
      layers.value = doc.data.layers;
      settings.value = { ...DEFAULT_COMPOSITION_SETTINGS, ...doc.data.settings };
      tracks.value = doc.data.tracks ?? [];
      normalizeComposition({ version: 1, layers: layers.value, lfos: doc.data.lfos, assignments: doc.data.assignments, settings: settings.value, tracks: tracks.value });
      lfos.value = doc.data.lfos.map((lfo) => normalizeLfo(lfo));
      assignments.value = doc.data.assignments;
      ownSaveAt = Date.now(); // the reload itself triggers an autosave of the same data
    } else {
      void refetchNestedComp(id);
    }
  }
}
onMounted(() => {
  const timer = setInterval(() => void pollDisk(), 1500);
  onBeforeUnmount(() => clearInterval(timer));
});


// --- Keyframe / track helpers ---

const timelineRef = ref<{ revealLayerTracks: (layerId: string) => void } | null>(null);

function paramValue(layerId: string, paramName: string, fallback: number): number {
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return fallback;
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  const base = (layer.values[paramName] as number) ?? fallback;
  return evaluatePropertyTrack(track, currentTime.value, base);
}

/** Params an edit applies to: all position axes while Position is linked (AE). */
function linkedParamsFor(layerId: string, paramName: string): string[] {
  return linkedParams(layers.value.find((l) => l.id === layerId), paramName);
}

function paramFallback(layerId: string, paramName: string): number {
  const layer = layers.value.find((l) => l.id === layerId);
  const def = layer ? findLayerParamDef(layer, paramName) : undefined;
  return (def?.default as number) ?? 0;
}

function toggleStopwatch(layerId: string, paramName: string) {
  const params = linkedParamsFor(layerId, paramName);
  const anyActive = params.some((p) => isPropertyTrackActive(findPropertyTrack(tracks.value, layerId, p)));
  if (anyActive) {
    for (const p of params) tracks.value = setTrackEnabled(tracks.value, layerId, p, false);
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) => !(k.layerId === layerId && params.includes(k.paramName)),
    );
    history.record();
    return;
  }
  for (const p of params) {
    const value = paramValue(layerId, p, paramFallback(layerId, p));
    tracks.value = setTrackEnabled(tracks.value, layerId, p, true, value, currentTime.value);
  }
  timelineRef.value?.revealLayerTracks(layerId);
  history.record();
}

/**
 * Key the playhead. Linked position: the other axes get keyed too (and their
 * stopwatch switched on), so the whole position is always captured.
 */
function setAnimatedValue(layerId: string, paramName: string, value: number) {
  for (const p of linkedParamsFor(layerId, paramName)) {
    const v = p === paramName ? value : paramValue(layerId, p, paramFallback(layerId, p));
    if (!isPropertyTrackActive(findPropertyTrack(tracks.value, layerId, p))) {
      tracks.value = setTrackEnabled(tracks.value, layerId, p, true, v, currentTime.value);
    }
    tracks.value = upsertKeyframe(tracks.value, layerId, p, currentTime.value, v);
  }
}

function toggleKeyframeAtPlayhead(layerId: string, paramName: string) {
  const params = linkedParamsFor(layerId, paramName);
  const active = params.filter((p) => findPropertyTrack(tracks.value, layerId, p)?.enabled);
  if (active.length === 0) return;

  const keyed = active.some((p) => hasKeyframeAt(findPropertyTrack(tracks.value, layerId, p), currentTime.value));
  if (keyed) {
    for (const p of active) {
      tracks.value = removeKeyframeAt(tracks.value, layerId, p, currentTime.value);
    }
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) =>
        !(
          k.layerId === layerId &&
          params.includes(k.paramName) &&
          Math.abs(k.time - currentTime.value) < 1e-6
        ),
    );
    history.record();
    return;
  }

  const p0 = params[0]!;
  setAnimatedValue(layerId, p0, paramValue(layerId, p0, paramFallback(layerId, p0)));
  history.record();
}

function deleteSelectedKeyframes() {
  const keys = selectedKeyframes.value;
  if (keys.length === 0) return;

  let next = tracks.value;
  for (const key of keys) {
    next = removeKeyframeAt(next, key.layerId, key.paramName, key.time);
  }

  const touched = new Map<string, Set<string>>();
  for (const key of keys) {
    const names = touched.get(key.layerId) ?? new Set<string>();
    names.add(key.paramName);
    touched.set(key.layerId, names);
  }
  for (const [layerId, paramNames] of touched) {
    for (const paramName of paramNames) {
      if (!isPropertyTrackActive(findPropertyTrack(next, layerId, paramName))) {
        next = setTrackEnabled(next, layerId, paramName, false);
      }
    }
  }

  tracks.value = next;
  selectedKeyframes.value = [];
  history.record();
}

function snapPlayheadTime(time: number): number {
  const step = 1 / settings.value.fps;
  return Math.round(time / step) * step;
}

function copySelectedKeyframes() {
  const items = buildKeyframePasteItems(tracks.value, selectedKeyframes.value);
  if (items.length === 0) return;
  setKeyframeClipboard(items);
}

function pasteKeyframesAtPlayhead() {
  const clip = getKeyframeClipboard();
  if (!clip) return;

  playing.value = false;
  const pasteTime = snapPlayheadTime(currentTime.value);
  const { tracks: next, pasted } = pasteKeyframesAtTime(
    tracks.value,
    clip.items,
    clip.anchorTime,
    pasteTime,
  );
  if (pasted.length === 0) return;

  tracks.value = next;
  selectedKeyframes.value = pasted;
  history.record();
}


// --- Layer Management ---

function addLayer(type: LayerType, overrides: Record<string, unknown> = {}) {
  const template = LAYER_TEMPLATES[type];
  if (!template) return;

  const id = createUniqueLayerId(type, layers.value, layerCounter);
  const values = { ...buildLayerValues(type), ...overrides };

  if (type === "waveFill") {
    offsetDuplicatedWave(
      values,
      layers.value.filter((l) => l.type === "waveFill").length,
    );
  }

  // Stage the first available component right away instead of an empty pick.
  if (type === "component" && !values.componentName) {
    values.componentName = defaultStageComponentName();
  }

  layers.value.unshift({ id, type, enabled: true, values });

  if (type === "pointer") {
    // Default cursor graphic (built-in arrow at real size), parented so it
    // follows the pointer. Anchor on the tip: it scales (press) and rotates
    // around where it points; positioned so the tip sits on the pointer.
    const cursor = BUILT_IN_CURSORS[0]!;
    const anchor = cursorAnchor(cursor, settings.value);
    const cursorId = createUniqueLayerId("image", layers.value, layerCounter);
    layers.value.unshift({
      id: cursorId,
      type: "image",
      name: "Cursor",
      enabled: true,
      parent: id,
      values: {
        ...buildLayerValues("image"),
        src: cursor.src,
        layerScale: 100,
        layerAnchorX: anchor.x,
        layerAnchorY: anchor.y,
        layerPositionX: 0.5 - anchor.x,
        layerPositionY: 0.5 - anchor.y,
      },
    });
    // Components without a pointer follow this one right away.
    for (const l of layers.value) {
      if (l.type === "component" && !l.values.pointer) l.values.pointer = id;
    }
  }

  selectedLayerId.value = id;
  selectedLayerIds.value = new Set([id]);
  selectionAnchorId.value = id;
  history.record();
}

/** Inspector → "Expose as prop": add a comp prop bound to this layer setting. */
function exposeProp(layerId: string, param: string, label: string) {
  const list = settings.value.props ?? [];
  if (list.some((p) => p.layerId === layerId && p.param === param)) return;
  const layer = layers.value.find((l) => l.id === layerId);
  const name = `${layer?.name ?? "Layer"} ${label}`.trim();
  settings.value = { ...settings.value, props: [...list, { id: crypto.randomUUID().slice(0, 8), name, layerId, param }] };
  history.record();
}

// --- Media import (drop or paste anywhere on the canvas) ---

/** Files currently uploading via drop/paste; drives the "Uploading…" pill. */
const mediaImportCount = ref(0);
const mediaImportError = ref("");
let mediaImportErrorTimer: ReturnType<typeof setTimeout> | null = null;
/** dragenter/dragleave nesting depth over the viewport (leave fires per child). */
const mediaDropDepth = ref(0);
const mediaDropActive = computed(() => mediaDropDepth.value > 0);

function flashMediaImportError(message: string) {
  mediaImportError.value = message;
  if (mediaImportErrorTimer) clearTimeout(mediaImportErrorTimer);
  mediaImportErrorTimer = setTimeout(() => {
    mediaImportError.value = "";
  }, 4000);
}

/** Upload dropped/pasted files and add one image/video layer per file. */
async function importMediaFiles(files: File[]) {
  const supported = files.filter((file) => mediaUploadKindForFile(file) !== null);
  if (supported.length === 0) return;
  mediaImportCount.value += supported.length;
  const results = await Promise.allSettled(
    supported.map(async (file) => {
      const kind = mediaUploadKindForFile(file)!;
      const url = await uploadMediaFile(kind, file, projectId.value);
      return { kind, url, name: file.name };
    }),
  );
  mediaImportCount.value -= supported.length;

  const addedIds: string[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { kind, url, name } = result.value;
    const id = createUniqueLayerId(kind, layers.value, layerCounter);
    const values = buildLayerValues(kind);
    values.src = url;
    const baseName = name.replace(/\.[^.]+$/, "").trim();
    layers.value.unshift({
      id,
      type: kind,
      enabled: true,
      values,
      ...(baseName ? { name: baseName } : {}),
    });
    addedIds.push(id);
  }
  if (addedIds.length > 0) {
    selectedLayerId.value = addedIds[0]!;
    selectedLayerIds.value = new Set(addedIds);
    selectionAnchorId.value = addedIds[0]!;
    history.record();
  }
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) {
    // Surface the server's statusMessage ("Media storage is unavailable",
    // "File must be an image", …) instead of a generic line.
    const reason = rejected.reason as { data?: { statusMessage?: string }; message?: string } | undefined;
    const detail = reason?.data?.statusMessage ?? "";
    const prefix = addedIds.length > 0 ? "Some media failed to upload" : "Upload failed";
    flashMediaImportError(detail ? `${prefix}: ${detail}` : `${prefix}. Try again.`);
  }
}

function onViewportDragEnter(event: DragEvent) {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  mediaDropDepth.value++;
}

function onViewportDragOver(event: DragEvent) {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onViewportDragLeave(event: DragEvent) {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  mediaDropDepth.value = Math.max(0, mediaDropDepth.value - 1);
}

/** Media files in a payload, falling back to SVG markup carried as text. */
function mediaFilesFromPayload(data: DataTransfer | null): File[] {
  const files = mediaFilesFromDataTransfer(data);
  if (files.length > 0) return files;
  const svgFile = svgFileFromText(data?.getData("text/plain") ?? "");
  return svgFile ? [svgFile] : [];
}

function onViewportDrop(event: DragEvent) {
  mediaDropDepth.value = 0;
  void importMediaFiles(mediaFilesFromPayload(event.dataTransfer));
}

/**
 * System-clipboard media paste. Keyframe paste wins when its internal
 * clipboard is set (its keydown handler cancels the paste event); otherwise
 * ⌘V with an image/video — or raw SVG markup ("Copy as SVG") — lands here.
 */
function onWindowPaste(event: ClipboardEvent) {
  // Paste targets the focused element, but guard: window itself has no closest().
  if (event.target instanceof Element && isTypingTarget(event.target)) return;
  const files = mediaFilesFromPayload(event.clipboardData);
  if (files.length === 0) return;
  event.preventDefault();
  void importMediaFiles(files);
}

// --- Pasteboard deselect ---

/**
 * Clicking the empty pasteboard around the artboard clears the selection.
 * Guarded by pointer travel so a drag that starts and ends on the background
 * doesn't deselect; .self on the handlers keeps artboard/gizmo/UI clicks out.
 */
let pasteboardDownAt: { x: number; y: number } | null = null;

function onPasteboardPointerDown(event: PointerEvent) {
  pasteboardDownAt = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
}

function onPasteboardClick(event: MouseEvent) {
  const down = pasteboardDownAt;
  pasteboardDownAt = null;
  if (!down) return;
  if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
  onCanvasSelect(null);
}

onMounted(() => {
  window.addEventListener("paste", onWindowPaste);
});

onUnmounted(() => {
  window.removeEventListener("paste", onWindowPaste);
  if (mediaImportErrorTimer) clearTimeout(mediaImportErrorTimer);
});

function removeLayer(id: string) {
  const idx = layers.value.findIndex((l) => l.id === id);
  if (idx === -1) return;
  layers.value.splice(idx, 1);
  assignments.value = assignments.value.filter((a) => a.layerId !== id);
  tracks.value = tracks.value.filter((t) => t.layerId !== id);
  selectedLayerIds.value = new Set([...selectedLayerIds.value].filter((layerId) => layerId !== id));
  selectedKeyframes.value = selectedKeyframes.value.filter((k) => k.layerId !== id);
  if (selectedLayerId.value === id) {
    selectedLayerId.value = layers.value[Math.min(idx, layers.value.length - 1)]?.id ?? null;
  }
  history.record();
}

function removeSelectedLayers() {
  const ids =
    selectedLayerIds.value.size > 0
      ? [...selectedLayerIds.value]
      : selectedLayerId.value
        ? [selectedLayerId.value]
        : [];
  if (ids.length === 0) return;

  const idSet = new Set(ids);
  layers.value = layers.value.filter((l) => !idSet.has(l.id));
  assignments.value = assignments.value.filter((a) => !idSet.has(a.layerId));
  tracks.value = tracks.value.filter((t) => !idSet.has(t.layerId));
  selectedKeyframes.value = selectedKeyframes.value.filter((k) => !idSet.has(k.layerId));
  selectedLayerIds.value = new Set();
  selectedLayerId.value = layers.value[0]?.id ?? null;
  selectionAnchorId.value = selectedLayerId.value;
  history.record();
}

function duplicateLayer(
  id: string,
  options: { record?: boolean; updateSelection?: boolean } = {},
): string | null {
  const { record = true, updateSelection = true } = options;
  const source = layers.value.find((l) => l.id === id);
  if (!source) return null;
  const newId = createUniqueLayerId(source.type, layers.value, layerCounter);
  const values = JSON.parse(JSON.stringify(source.values)) as Record<string, unknown>;
  if (source.type === "waveFill") {
    offsetDuplicatedWave(
      values,
      layers.value.filter((l) => l.type === "waveFill").length,
    );
  }
  const clone: LayerInstance = {
    id: newId,
    type: source.type,
    enabled: source.enabled,
    values,
    ...(source.name ? { name: source.name } : {}),
  };
  const idx = layers.value.findIndex((l) => l.id === id);
  layers.value.splice(idx, 0, clone);

  const clonedAssignments = assignments.value
    .filter((a) => a.layerId === id)
    .map((a) => ({ ...a, layerId: newId }));
  assignments.value.push(...clonedAssignments);

  if (updateSelection) {
    selectedLayerId.value = newId;
    selectedLayerIds.value = new Set([newId]);
    selectionAnchorId.value = newId;
  }
  if (record) history.record();
  return newId;
}

function duplicateSelectedLayers() {
  const ids =
    selectedLayerIds.value.size > 0
      ? [...selectedLayerIds.value]
      : selectedLayerId.value
        ? [selectedLayerId.value]
        : [];
  if (ids.length === 0) return;

  const byIndexDesc = ids
    .map((id) => ({ id, index: layers.value.findIndex((l) => l.id === id) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => b.index - a.index);

  const newIds: string[] = [];
  for (const { id } of byIndexDesc) {
    const newId = duplicateLayer(id, { record: false, updateSelection: false });
    if (newId) newIds.push(newId);
  }
  if (newIds.length === 0) return;

  const ordered = layers.value.filter((l) => newIds.includes(l.id)).map((l) => l.id);
  selectedLayerIds.value = new Set(ordered);
  selectedLayerId.value = ordered[0] ?? null;
  selectionAnchorId.value = ordered[0] ?? null;
  history.record();
}

// --- Pre-compose (AE-style: group selected layers into a new composition) ---

const topBarRef = ref<{ refresh: () => Promise<void> } | null>(null);

/** First "Precomp N" not already used by a comp in this project. */
function nextPrecompName(): string {
  const taken = new Set(projectComps.value.map((c) => c.name));
  let n = 1;
  while (taken.has(`Precomp ${n}`)) n++;
  return `Precomp ${n}`;
}

/**
 * Move the given layers into a brand-new comp and replace them with one
 * composition layer at the topmost moved layer's index. The moved layers'
 * tracks and assignments move too; LFO sources are copied (deep-cloned) into
 * the new comp but stay in the parent — other layers may still use them.
 * Undo restores the parent comp only; the created comp persists on the server.
 */
async function precomposeLayers(layerIds: string[]) {
  if (!projectId.value) return;
  const idSet = new Set(layerIds);
  // Stack order comes from layers.value, not from the incoming id order.
  const moved = layers.value.filter((l) => idSet.has(l.id));
  if (moved.length === 0) return;
  const topIndex = layers.value.findIndex((l) => idSet.has(l.id));

  const movedAssignments = assignments.value.filter((a) => idSet.has(a.layerId));
  const movedTracks = tracks.value.filter((t) => idSet.has(t.layerId));
  const usedLfoIds = new Set(movedAssignments.map((a) => a.sourceId));
  const movedLfos = lfos.value.filter((l) => usedLfoIds.has(l.id));

  const data = JSON.parse(
    JSON.stringify({
      version: 1,
      layers: moved,
      lfos: movedLfos,
      assignments: movedAssignments,
      tracks: movedTracks,
      settings: settings.value,
    }),
  ) as CompositionConfig;

  let created: CompositionMeta;
  try {
    created = await $fetch<CompositionMeta>(
      `/api/projects/${projectId.value}/compositions`,
      { method: "POST", body: { name: nextPrecompName(), data } },
    );
  } catch (e) {
    console.error("Failed to pre-compose:", e);
    return;
  }

  const newId = createUniqueLayerId("composition", layers.value, layerCounter);
  const values = buildLayerValues("composition");
  values.compRefId = created.id;
  const remaining = layers.value.filter((l) => !idSet.has(l.id));
  // topIndex is the first selected index, so no moved layer sits above it.
  remaining.splice(topIndex, 0, {
    id: newId,
    type: "composition",
    name: created.name,
    enabled: true,
    values,
  });
  layers.value = remaining;
  assignments.value = assignments.value.filter((a) => !idSet.has(a.layerId));
  tracks.value = tracks.value.filter((t) => !idSet.has(t.layerId));
  selectedKeyframes.value = selectedKeyframes.value.filter((k) => !idSet.has(k.layerId));
  selectedLayerId.value = newId;
  selectedLayerIds.value = new Set([newId]);
  selectionAnchorId.value = newId;
  history.record();

  // The comp registry watches compRefIds and fetches the new comp on its own;
  // refresh the comp lists (tabs + inspector's Composition select) here.
  void refreshProjectComps();
  void topBarRef.value?.refresh();
}

/** Drop from the project panel: insert a composition layer at the slot. */
function insertCompositionLayer(payload: { compId: string; name: string; index: number }) {
  // Nesting the open comp into itself would be a trivial cycle — ignore.
  if (!payload.compId || payload.compId === shaderId.value) return;

  const newId = createUniqueLayerId("composition", layers.value, layerCounter);
  const values = buildLayerValues("composition");
  values.compRefId = payload.compId;
  const index = Math.max(0, Math.min(payload.index, layers.value.length));
  layers.value.splice(index, 0, {
    id: newId,
    type: "composition",
    name: payload.name || "Composition",
    enabled: true,
    values,
  });
  selectedLayerId.value = newId;
  selectedLayerIds.value = new Set([newId]);
  selectionAnchorId.value = newId;
  history.record();
}

// --- LFO Management ---

function deleteLfo(id: string) {
  lfos.value = lfos.value.filter((l) => l.id !== id);
  assignments.value = assignments.value.filter((a) => a.sourceId !== id);
  if (selectedLfoId.value === id) selectedLfoId.value = null;
  history.record();
}

function duplicateLfo(id: string) {
  const source = lfos.value.find((l) => l.id === id);
  if (!source) return;
  const newId = `lfo-${Date.now()}`;
  const existingColors = lfos.value.map((l) => l.color);
  const clone: LFOSource = {
    ...source,
    id: newId,
    label: `${source.label}`,
    color: nextLfoColor(existingColors),
    points: source.points.map((p) => ({ ...p })),
  };
  lfos.value.push(clone);
  selectedLfoId.value = newId;
  history.record();
}

function clearLfoAssignments(id: string) {
  assignments.value = assignments.value.filter((a) => a.sourceId !== id);
  history.record();
}

// --- Modulation Assignment Management ---

function assignLfo(paramName: string) {
  if (!draggingLfoId.value || !selectedLayer.value) return;
  assignments.value = assignments.value.filter(
    (a) => !(a.layerId === selectedLayer.value!.id && a.paramName === paramName),
  );
  const def = findLayerParamDef(selectedLayer.value, paramName);
  const range = ((def?.max ?? 1) - (def?.min ?? 0)) * 0.15;

  assignments.value.push({
    sourceId: draggingLfoId.value,
    layerId: selectedLayer.value.id,
    paramName,
    depth: range,
  });
  draggingLfoId.value = null;
  history.record();
}

function removeAssignment(sourceId: string, paramName: string) {
  if (!selectedLayer.value) return;
  assignments.value = assignments.value.filter(
    (a) => !(a.sourceId === sourceId && a.layerId === selectedLayer.value!.id && a.paramName === paramName),
  );
  history.record();
}

function updateDepth(sourceId: string, paramName: string, depth: number) {
  const assignment = assignments.value.find(
    (a) => a.sourceId === sourceId && a.layerId === selectedLayer.value?.id && a.paramName === paramName,
  );
  if (assignment) {
    assignment.depth = depth;
  }
}

// --- Drag LFO handling ---

const dragPos = ref({ x: -999, y: -999 });

const draggingLfo = computed(() => {
  if (!draggingLfoId.value) return null;
  return lfos.value.find((l) => l.id === draggingLfoId.value) ?? null;
});

function onDragStart(lfoId: string, x: number, y: number) {
  draggingLfoId.value = lfoId;
  dragPos.value = { x, y };

  function onMove(e: PointerEvent) {
    dragPos.value = { x: e.clientX, y: e.clientY };
  }

  function onUp() {
    setTimeout(() => {
      draggingLfoId.value = null;
      dragPos.value = { x: -999, y: -999 };
    }, 50);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// --- Selected layer assignments ---

const selectedLayerAssignments = computed(() => {
  if (!selectedLayer.value) return [];
  return assignments.value.filter((a) => a.layerId === selectedLayer.value!.id);
});

/**
 * What gizmos show: the layer's own (keyframed) value, except transform params
 * of parented layers, which show where the layer really is on screen.
 */
function gizmoParamValue(layerId: string, paramName: string, fallback: number): number {
  const layer = layers.value.find((l) => l.id === layerId);
  if (layer?.parent && PARENT_PARAMS.has(paramName)) {
    return getModulatedValue(layerId, paramName, staticParamValue(layer, paramName));
  }
  return paramValue(layerId, paramName, fallback);
}

function getGizmoFloat(layer: LayerInstance, paramName: string, fallback: number): number {
  return gizmoParamValue(layer.id, paramName, fallback);
}

function setGizmoFloat(layer: LayerInstance, paramName: string, value: number) {
  if (layer.parent && PARENT_PARAMS.has(paramName)) {
    // Gizmos work in screen space: shift by the parent's current contribution.
    const own = paramValue(layer.id, paramName, staticParamValue(layer, paramName));
    const world = getModulatedValue(layer.id, paramName, staticParamValue(layer, paramName));
    value = paramName === "layerScale"
      ? (Math.abs(world) > 1e-9 ? value * (own / world) : own)
      : value - (world - own);
  }
  // Animated (any linked axis keyed): key the playhead — linked axes together.
  const linked = linkedParams(layer, paramName);
  if (linked.some((p) => isPropertyTrackActive(findPropertyTrack(tracks.value, layer.id, p)))) {
    setAnimatedValue(layer.id, paramName, value);
    return;
  }
  layer.values[paramName] = value;
}

// --- Universal transform gizmo (generators without a specialized gizmo) ---

const TRANSFORM_GIZMO_TYPES = new Set<LayerType>(["gradient", "solid", "noise", "text", "component", "shape", "image", "video", "object3d", "composition"]);

const showTransformGizmo = computed(
  () =>
    !!selectedLayer.value &&
    selectedLayer.value.enabled &&
    TRANSFORM_GIZMO_TYPES.has(selectedLayer.value.type),
);

function transformDef(name: string) {
  return UNIVERSAL_LAYER_UNIFORMS.find((def) => def.name === name)!;
}

const transformPosDef = transformDef("layerPositionX");
const transformPosZDef = transformDef("layerPositionZ");
const transformScaleDef = transformDef("layerScale");
const transformRotationDef = transformDef("layerRotation");
const transformAnchorDef = transformDef("layerAnchorX");

function getTransformFloat(layer: LayerInstance, name: string): number {
  return gizmoParamValue(layer.id, name, transformDef(name).default as number);
}

function setTransformFloat(layer: LayerInstance, name: string, value: number) {
  setGizmoFloat(layer, name, value);
}

/** Live transform values for canvas hit-testing and hover outlines. */
function layerTransformValues(layer: LayerInstance): LayerTransformValues {
  return {
    positionX: getTransformFloat(layer, "layerPositionX"),
    positionY: getTransformFloat(layer, "layerPositionY"),
    scale: getTransformFloat(layer, "layerScale"),
    rotation: getTransformFloat(layer, "layerRotation"),
    anchorX: getTransformFloat(layer, "layerAnchorX"),
    anchorY: getTransformFloat(layer, "layerAnchorY"),
  };
}

/** Memoized text extents — measurement is canvas-backed, picking is hot. */
const textExtentCache = new Map<string, ContentExtent>();

/** Content rect of a text layer, mirroring core's rasterizer layout. */
function textLayerExtent(layer: LayerInstance): ContentExtent {
  const spec = textExtentSpecFromValues(layer.values);
  // Numeric layout inputs follow keyframes, like the rasterizer's uniforms.
  spec.fontSize = paramValue(layer.id, "fontSize", spec.fontSize);
  spec.tracking = paramValue(layer.id, "tracking", spec.tracking);
  spec.lineHeight = paramValue(layer.id, "lineHeight", spec.lineHeight);

  const { width, height } = settings.value;
  const key = JSON.stringify([spec, width, height]);
  const cached = textExtentCache.get(key);
  if (cached) return cached;

  const measure = createTextLineMeasurer(spec);
  const extent = measure ? textContentExtent(spec, width, height, measure) : FULL_CONTENT_EXTENT;
  if (textExtentCache.size > 64) textExtentCache.clear();
  textExtentCache.set(key, extent);
  return extent;
}

/**
 * Rect of the layer's unit square its pixels actually occupy. Component and
 * text layers draw a smaller rect inside the full-frame FBO, so outlines,
 * gizmo boxes and hit-tests wrap the content instead of the whole frame.
 */
function layerContentExtent(layer: LayerInstance): ContentExtent {
  if (layer.type === "component") {
    const size = componentCapture.contentSizes.get(layer.id);
    if (!size) return FULL_CONTENT_EXTENT;
    return componentContentExtent(
      size.cssWidth,
      size.cssHeight,
      settings.value.width,
      settings.value.height,
    );
  }
  if (layer.type === "image" || layer.type === "video") {
    const size = mediaSources.naturalSizes.get(layer.id);
    if (!size) return FULL_CONTENT_EXTENT;
    // Crops are keyframeable and shrink the on-screen rect, like the shader.
    return mediaContentExtent(
      size.width,
      size.height,
      settings.value.width,
      settings.value.height,
      {
        cropLeft: paramValue(layer.id, "cropLeft", 0),
        cropRight: paramValue(layer.id, "cropRight", 0),
        cropTop: paramValue(layer.id, "cropTop", 0),
        cropBottom: paramValue(layer.id, "cropBottom", 0),
      },
    );
  }
  if (layer.type === "text") return textLayerExtent(layer);
  return FULL_CONTENT_EXTENT;
}

/** Topmost pickable layer id at a comp UV point (gizmo click-through). */
function canvasLayerAt(uv: { x: number; y: number }, aspect: number): string | null {
  return (
    topLayerAt(
      layers.value,
      uv,
      aspect,
      layerTransformValues,
      layerContentExtent,
      layerProjectionFor,
    )?.id ?? null
  );
}

const compositionAspect = computed(() => settings.value.width / settings.value.height);

// --- 3D gizmos: scene view + projected quads (must match the 3D render) ---

/** Live view of the drive-3D camera piloting the layer's group (or identity). */
/** Effectors aren't group members: borrow the view of the nearest 3D layer in the stack. */
function viewAnchorLayerId(layerId: string): string {
  const list = layers.value;
  const index = list.findIndex((l) => l.id === layerId);
  if (index < 0 || list[index]!.type !== "effector") return layerId;
  for (let d = 1; d < list.length; d++) {
    for (const j of [index + d, index - d]) {
      const l = list[j];
      if (l && l.enabled && l.type !== "effector" && isLayer3D(l)) return l.id;
    }
  }
  return layerId;
}

function sceneViewForLayer(layerId: string): SceneView {
  return resolveSceneView(
    drivingCameraIdFor(layers.value, viewAnchorLayerId(layerId)),
    (id) => layers.value.find((l) => l.id === id),
    // Same modFn the renderer uses — keyframed/LFO camera params stay in sync.
    getModulatedValue,
  );
}

/** Transform + view + (object3d) size for 3D gizmo projection; null for 2D layers. */
function threeDGizmoDataFor(layer: LayerInstance): ThreeDGizmoData | null {
  if (!isLayer3D(layer)) return null;
  return {
    // Same evaluated reads the 2D gizmo uses (keyframes; parented → on-screen).
    transform: threeDTransformFromValues(layer.values, (name, fallback) =>
      gizmoParamValue(layer.id, name, fallback),
    ),
    view: sceneViewForLayer(layer.id),
    size:
      layer.type === "object3d"
        ? {
            x: paramValue(layer.id, "u_sizeX", 0.25),
            y: paramValue(layer.id, "u_sizeY", 0.25),
            z: paramValue(layer.id, "u_sizeZ", 0.25),
          }
        : null,
  };
}

/** 3D layers: projected screen quad for picking/hover; null marks a 2D layer. */
function layerProjectionFor(layer: LayerInstance): LayerProjection | null {
  const data = threeDGizmoDataFor(layer);
  if (!data) return null;
  return { quad: projectGizmoQuad(data, compositionAspect.value) };
}

/** Smart-guide lines: composition frame + the other visible layers' bounds. */
const snapTargets = computed(() =>
  collectSnapTargets(
    layers.value,
    selectedLayerIds.value,
    compositionAspect.value,
    layerTransformValues,
    layerContentExtent,
  ),
);

function onCanvasSelect(layerId: string | null, additive = false) {
  if (!layerId) {
    selectedLayerId.value = null;
    selectedLayerIds.value = new Set();
    selectionAnchorId.value = null;
    selectedKeyframes.value = [];
    return;
  }

  if (additive) {
    const next = new Set(selectedLayerIds.value);
    if (next.has(layerId)) next.delete(layerId);
    else next.add(layerId);
    selectedLayerIds.value = next;
    selectedLayerId.value = next.has(layerId) ? layerId : [...next].pop() ?? null;
    selectionAnchorId.value = selectedLayerId.value;
    return;
  }

  selectedLayerId.value = layerId;
  selectedLayerIds.value = new Set([layerId]);
  selectionAnchorId.value = layerId;
}

// --- Inline text editing (Figma-style text tool) ---

const artboardRef = ref<HTMLElement | null>(null);

/** Client point → comp UV via the artboard's on-screen rect. */
function compUvFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = artboardRef.value?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return {
    x: (clientX - rect.left) / rect.width,
    y: 1 - (clientY - rect.top) / rect.height,
  };
}

function startTextEditing(layerId: string, intent: TextEditIntent = { type: "end" }) {
  if (textEditingLayerId.value === layerId) return;
  // One undo entry for the whole editing session (creation + typing).
  history.beginGesture();
  textEditIntent.value = intent;
  textEditingLayerId.value = layerId;
  onCanvasSelect(layerId);
  // The hidden-while-editing pass graph swap does not touch layer state,
  // so the renderer needs an explicit frame.
  nextTick(() => requestRender());
}

function commitTextEditing() {
  const layer = textEditingLayer.value;
  if (!layer) return;
  textEditingLayerId.value = null;
  // Figma-style: text left empty is removed, the tool snaps back to select.
  if (!String(layer.values.content ?? "").trim()) {
    removeLayer(layer.id);
  }
  history.commitGesture();
  if (activeTool.value === "text") activeTool.value = "select";
  nextTick(() => requestRender());
}

/** Text tool click on empty canvas: create an empty layer at the point and edit it. */
function addTextLayerAt(uv: { x: number; y: number }) {
  const id = createUniqueLayerId("text", layers.value, layerCounter);
  const values = buildLayerValues("text");
  values.content = "";
  const posMin = (transformPosDef.min as number | undefined) ?? -1;
  const posMax = (transformPosDef.max as number | undefined) ?? 1;
  values.layerPositionX = clampValue(Number((uv.x - 0.5).toFixed(4)), posMin, posMax);
  values.layerPositionY = clampValue(Number((uv.y - 0.5).toFixed(4)), posMin, posMax);
  layers.value.unshift({ id, type: "text", enabled: true, values });
  startTextEditing(id, { type: "end" });
}

function onTextToolPointerDown(e: PointerEvent) {
  if (e.button !== 0 || textEditingLayerId.value) return;
  const uv = compUvFromClient(e.clientX, e.clientY);
  if (!uv) return;
  e.preventDefault();
  e.stopPropagation();

  const id = canvasLayerAt(uv, compositionAspect.value);
  const layer = id ? layers.value.find((l) => l.id === id) : null;
  if (layer?.type === "text") {
    startTextEditing(layer.id, {
      type: "point",
      clientX: e.clientX,
      clientY: e.clientY,
      drag: true,
    });
  } else {
    addTextLayerAt(uv);
  }
}

/** Double-click a text layer (any tool): edit with everything selected. */
function onArtboardDblClick(e: MouseEvent) {
  if (textEditingLayerId.value) return;
  const uv = compUvFromClient(e.clientX, e.clientY);
  if (!uv) return;
  const id = canvasLayerAt(uv, compositionAspect.value);
  const layer = id ? layers.value.find((l) => l.id === id) : null;
  if (layer?.type === "text") {
    startTextEditing(layer.id, { type: "all" });
  } else if (layer?.type === "composition") {
    openNestedComp(layer, e.metaKey || e.ctrlKey);
  }
}

/** Selected layers that carry a transform (generators), in stack order. */
const multiSelectedLayers = computed(() =>
  layers.value.filter(
    (l) => selectedLayerIds.value.has(l.id) && PICKABLE_LAYER_TYPES.has(l.type),
  ),
);

const showMultiGizmo = computed(
  () => selectedLayerIds.value.size > 1 && multiSelectedLayers.value.length > 0,
);

/** Keyframe-aware write used by the multi-selection gizmo. */
// --- Parenting ---

/** World transform as rendered right now (frame-height units, x × aspect). */
function worldTransformOf(layerId: string): WorldTransform {
  const layer = layers.value.find((l) => l.id === layerId)!;
  const aspect = settings.value.width / Math.max(settings.value.height, 1);
  const v = (p: string) => getModulatedValue(layerId, p, staticParamValue(layer, p));
  return {
    x: v("layerPositionX") * aspect,
    y: v("layerPositionY"),
    z: v("layerPositionZ"),
    rx: v("layerRotationX"),
    ry: v("layerRotationY"),
    rz: v("layerRotation"),
    scale: v("layerScale"),
  };
}

/**
 * Set or clear a layer's parent. Keeps the layer where it is on screen
 * (AE pick-whip): its static transform is converted into the new space.
 * Attaching to a point (text end) snaps the layer onto that point instead.
 * Keyframed params keep their keys.
 */
function setLayerParent(layerId: string, parentId: string | null, point: string | null) {
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return;
  const aspect = settings.value.width / Math.max(settings.value.height, 1);
  const world = worldTransformOf(layerId);
  const parentWorld = parentId ? worldTransformOf(parentId) : null;

  if (parentId) layer.parent = parentId;
  else delete layer.parent;
  if (parentId && point) layer.parentPoint = point;
  else delete layer.parentPoint;

  const local = parentWorld ? localFromWorld(parentWorld, world) : world;
  if (parentId && point) {
    local.x = 0;
    local.y = 0;
    local.z = 0;
  }
  const write = (param: string, value: number) => {
    if (isPropertyTrackActive(findPropertyTrack(tracks.value, layerId, param))) return;
    layer.values[param] = Number(value.toFixed(6));
  };
  write("layerPositionX", local.x / aspect);
  write("layerPositionY", local.y);
  if (isLayer3D(layer)) {
    write("layerPositionZ", local.z);
    write("layerRotationX", local.rx);
    write("layerRotationY", local.ry);
  }
  write("layerRotation", local.rz);
  write("layerScale", local.scale);
  history.record();
}

function applyLayerParam(layerId: string, paramName: string, value: number) {
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return;
  setGizmoFloat(layer, paramName, value);
}

const waveFillTemplate = LAYER_TEMPLATES.waveFill;
const wavePosXDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_POS_X)!;
const wavePosYDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_POS_Y)!;
const waveAmpDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_AMPLITUDE)!;
const waveWidthDef = waveFillTemplate.uniforms.find((u) => u.name === WAVE_CYCLE_WIDTH)!;

const showWavePositionGizmo = computed(
  () => selectedLayer.value?.type === "waveFill" && selectedLayer.value.enabled,
);

function getWaveFloat(
  layer: LayerInstance,
  key: typeof WAVE_POS_X | typeof WAVE_POS_Y | typeof WAVE_AMPLITUDE | typeof WAVE_CYCLE_WIDTH,
  fallback: number,
) {
  return getGizmoFloat(layer, key, fallback);
}

function setWaveFloat(
  layer: LayerInstance,
  key: typeof WAVE_POS_X | typeof WAVE_POS_Y | typeof WAVE_AMPLITUDE | typeof WAVE_CYCLE_WIDTH,
  value: number,
) {
  setGizmoFloat(layer, key, value);
}

const meshTemplate = LAYER_TEMPLATES.mesh;
const meshPointsDef = meshTemplate.uniforms.find((u) => u.type === "meshPoints")!;

const meshSelectedPointIndex = ref(0);

watch(selectedLayerId, () => {
  meshSelectedPointIndex.value = 0;
});

const showMeshPointsGizmo = computed(
  () => selectedLayer.value?.type === "mesh" && selectedLayer.value.enabled,
);

function getMeshPoints(layer: LayerInstance): MeshPoint[] {
  const raw = layer.values[meshPointsDef.name] as MeshPoint[] | undefined;
  const base = raw?.length
    ? cloneMeshPoints(raw)
    : cloneMeshPoints(meshPointsDef.default as MeshPoint[]);
  while (base.length < MESH_MAX_POINTS) {
    base.push({ x: 0.5, y: 0.5, color: "#808080", radius: 0.5 });
  }
  return base.slice(0, MESH_MAX_POINTS);
}

function setMeshPoints(layer: LayerInstance, points: MeshPoint[]) {
  layer.values[meshPointsDef.name] = points;
}

const bandFillTemplate = LAYER_TEMPLATES.bandFill;
const bandYDef = bandFillTemplate.uniforms.find((u) => u.name === BAND_Y)!;
const bandEdgeDef = bandFillTemplate.uniforms.find((u) => u.name === BAND_EDGE)!;

const showBandPositionGizmo = computed(
  () => selectedLayer.value?.type === "bandFill" && selectedLayer.value.enabled,
);

function getBandFloat(
  layer: LayerInstance,
  key: typeof BAND_Y | typeof BAND_EDGE,
  fallback: number,
) {
  return getGizmoFloat(layer, key, fallback);
}

function setBandFloat(
  layer: LayerInstance,
  key: typeof BAND_Y | typeof BAND_EDGE,
  value: number,
) {
  setGizmoFloat(layer, key, value);
}

function captureEditorSnapshot(): EditorSnapshot {
  return cloneEditorSnapshot({
    shaderName: shaderName.value,
    layers: layers.value,
    lfos: lfos.value,
    assignments: assignments.value,
    settings: settings.value,
    tracks: tracks.value,
    selectedLayerId: selectedLayerId.value,
    selectedLayerIds: [...selectedLayerIds.value],
    selectedLfoId: selectedLfoId.value,
    selectedKeyframes: selectedKeyframes.value,
    selectionAnchorId: selectionAnchorId.value,
    meshSelectedPointIndex: meshSelectedPointIndex.value,
  });
}

function applyEditorSnapshot(snap: EditorSnapshot) {
  shaderName.value = snap.shaderName;
  layers.value = snap.layers;
  lfos.value = snap.lfos;
  assignments.value = snap.assignments;
  settings.value = snap.settings;
  tracks.value = snap.tracks;
  selectedLayerId.value = snap.selectedLayerId;
  selectedLayerIds.value = new Set(snap.selectedLayerIds);
  selectedLfoId.value = snap.selectedLfoId;
  selectedKeyframes.value = snap.selectedKeyframes;
  selectionAnchorId.value = snap.selectionAnchorId;
  meshSelectedPointIndex.value = snap.meshSelectedPointIndex;
  syncLayerCounter();
}

const history = useUndoHistory(captureEditorSnapshot, applyEditorSnapshot);
provideEditorHistory(history);
history.reset();

watch(shaderName, () => {
  if (history.isApplying.value) return;
  history.record();
});

const { register: registerKeyboard } = useEditorKeyboard();

const toolDockRef = ref<{ openAddLayer: () => void } | null>(null);

registerKeyboard({
  id: "shader:add-layer-palette",
  priority: EditorKeyboardPriority.transport,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return false;
    toolDockRef.value?.openAddLayer();
    return true;
  },
});

registerKeyboard({
  id: "shader:undo",
  priority: EditorKeyboardPriority.transport,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return false;
    if (e.shiftKey) history.redo();
    else history.undo();
    return true;
  },
});

registerKeyboard({
  id: "shader:copy-keyframes",
  priority: EditorKeyboardPriority.keyframe,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c") return false;
    if (selectedKeyframes.value.length === 0) return false;
    copySelectedKeyframes();
    return true;
  },
});

registerKeyboard({
  id: "shader:paste-keyframes",
  priority: EditorKeyboardPriority.keyframe,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "v") return false;
    if (!getKeyframeClipboard()) return false;
    pasteKeyframesAtPlayhead();
    return true;
  },
});

registerKeyboard({
  id: "shader:duplicate-layers",
  priority: EditorKeyboardPriority.layer,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "d") return false;
    if (selectedLayerIds.value.size === 0 && !selectedLayerId.value) return false;
    duplicateSelectedLayers();
    return true;
  },
});

registerKeyboard({
  id: "shader:toggle-play",
  priority: EditorKeyboardPriority.transport,
  handle(e) {
    if (e.code !== "Space" || e.repeat) return false;
    playing.value = !playing.value;
    return true;
  },
});

registerKeyboard({
  id: "shader:delete-keyframes",
  priority: EditorKeyboardPriority.keyframe,
  handle(e) {
    if (!isDeleteKey(e)) return false;
    if (selectedKeyframes.value.length === 0) return false;
    deleteSelectedKeyframes();
    return true;
  },
});

registerKeyboard({
  id: "shader:delete-layers",
  priority: EditorKeyboardPriority.layer,
  handle(e) {
    if (!isDeleteKey(e)) return false;
    if (selectedLayerIds.value.size === 0 && !selectedLayerId.value) return false;
    removeSelectedLayers();
    return true;
  },
});

registerKeyboard({
  id: "text:edit-selected",
  priority: EditorKeyboardPriority.layer,
  handle(e) {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    if (textEditingLayerId.value) return false;
    const layer = selectedLayer.value;
    if (!layer || layer.type !== "text" || selectedLayerIds.value.size > 1) return false;
    startTextEditing(layer.id, { type: "all" });
    return true;
  },
});
</script>

<template>
  <!-- Studio UI: dark frame, panels as grey tiles with 6px gaps (see /kitchen). -->
  <div data-ui="studio" class="flex h-dvh flex-col gap-[2px] overflow-hidden bg-[var(--s-frame)] px-[10px] pb-[10px]" :class="previewing && '!gap-0 !p-0'">
    <ShellTopBar
      v-show="!previewing"
      ref="topBarRef"
      :project-id="projectId"
      :project-name="projectName"
      :comp-id="shaderId"
      :comp-name="shaderName"
      :root-comp-id="rootCompId"
      :project-panel-open="projectPanelOpen"
      @toggle-project-panel="toggleProjectPanel"
      @preview="startPreview"
      @export="exportOpen = true"
    >
      <template #tools>
        <ShellToolDock ref="toolDockRef" v-model:tool="activeTool" @add-layer="addLayer" />
      </template>
    </ShellTopBar>

    <div ref="editorSplitRef" class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 gap-[var(--s-gap)]">
        <aside
          v-if="projectId && projectPanelOpen && !previewing"
          class="shrink-0 overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)]"
        >
          <ShellProjectPanel
            :project-id="projectId"
            :active-comp-id="shaderId"
            :root-comp-id="rootCompId"
            @add-component="(name) => addLayer('component', { componentName: name })"
          />
        </aside>

        <main
          class="min-w-0 flex-1 overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)]"
          :class="previewing ? 'fixed inset-0 z-[100] bg-black' : 'relative'"
          @click="previewing && stopPreview()"
        >
        <ClientOnly>
          <div class="size-full min-h-0 select-none">
            <div
              ref="viewportRef"
              class="absolute inset-x-0 top-0 overflow-hidden"
              :style="{ bottom: previewing ? '0' : '22px' }"
              :class="[previewing ? 'bg-black' : 'bg-[var(--s-tile)]', viewport.panning.value && 'cursor-default']"
              @wheel.prevent="viewport.onWheel"
              @pointerdown.capture="viewport.onPointerDown"
              @pointerdown.self="onPasteboardPointerDown"
              @click.self="onPasteboardClick"
              @dragenter.prevent="onViewportDragEnter"
              @dragover.prevent="onViewportDragOver"
              @dragleave="onViewportDragLeave"
              @drop.prevent="onViewportDrop"
            >
              <!-- Media drop target / upload status -->
              <div
                v-if="mediaDropActive"
                class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-[var(--s-accent)] bg-[color-mix(in_srgb,var(--s-accent)_10%,transparent)]"
              >
                <span class="rounded-[var(--s-r-ctl)] bg-[var(--s-band)] px-[8px] py-[4px] text-[var(--s-txt)] shadow-[0_0_0_1px_var(--s-edge)]">
                  Drop images or videos to add layers
                </span>
              </div>
              <!-- top-16: the floating toolbar owns top-3 at z-50 and would cover this. -->
              <div
                v-else-if="mediaImportCount > 0 || mediaImportError"
                class="pointer-events-none absolute top-16 left-1/2 z-40 -translate-x-1/2"
              >
                <span
                  class="rounded-[var(--s-r-ctl)] bg-[var(--s-band)] px-[8px] py-[4px] shadow-[0_0_0_1px_var(--s-edge)]"
                  :class="mediaImportError ? 'text-[var(--s-danger)]' : 'text-[var(--s-dim)]'"
                >
                  {{ mediaImportError || "Uploading media…" }}
                </span>
              </div>
              <div
                ref="artboardRef"
                class="absolute top-0 left-0"
                :style="viewport.artboardStyle.value"
                @dblclick="onArtboardDblClick"
              >
                <div class="absolute inset-0 overflow-hidden bg-black shadow-2xl ring-1 ring-white/10">
                  <canvas
                    ref="canvasRef"
                    class="pointer-events-none size-full"
                  />
                  <!-- RAM preview: cached frames shown on top of the live canvas. -->
                  <canvas
                    v-show="frameCache.showing.value"
                    ref="cacheCanvasRef"
                    class="pointer-events-none absolute inset-0 size-full"
                  />
                </div>
              <template v-if="!previewing">
              <EditorCanvasPicker
                :layers="layers"
                :selected-layer-ids="[...selectedLayerIds]"
                :get-transform="layerTransformValues"
                :get-extent="layerContentExtent"
                :get-projection="layerProjectionFor"
                @select="onCanvasSelect"
              />
              <EditorLightGizmos
                :layers="layers"
                :selected-layer-ids="[...selectedLayerIds]"
                :zoom="viewport.zoom.value"
                :get-view="sceneViewForLayer"
                :get-param="gizmoParamValue"
                :apply-param="applyLayerParam"
                @select="onCanvasSelect"
              />
              <EditorWavePositionGizmo
                v-if="showWavePositionGizmo && selectedLayer && selectedLayerIds.size <= 1"
                :zoom="viewport.zoom.value"
                :cycle-x="getWaveFloat(selectedLayer, WAVE_POS_X, wavePosXDef.default as number)"
                :center-y="getWaveFloat(selectedLayer, WAVE_POS_Y, wavePosYDef.default as number)"
                :amplitude="getWaveFloat(selectedLayer, WAVE_AMPLITUDE, waveAmpDef.default as number)"
                :cycle-width="getWaveFloat(selectedLayer, WAVE_CYCLE_WIDTH, waveWidthDef.default as number)"
                :x-min="wavePosXDef.min ?? -1"
                :x-max="wavePosXDef.max ?? 2"
                :y-min="wavePosYDef.min ?? -1"
                :y-max="wavePosYDef.max ?? 2"
                :amp-min="waveAmpDef.min ?? 0"
                :amp-max="waveAmpDef.max ?? 0.4"
                :width-min="waveWidthDef.min ?? 0.08"
                :width-max="waveWidthDef.max ?? 2"
                @update:cycle-x="setWaveFloat(selectedLayer, WAVE_POS_X, $event)"
                @update:center-y="setWaveFloat(selectedLayer, WAVE_POS_Y, $event)"
                @update:amplitude="setWaveFloat(selectedLayer, WAVE_AMPLITUDE, $event)"
                @update:cycle-width="setWaveFloat(selectedLayer, WAVE_CYCLE_WIDTH, $event)"
              />
              <EditorMeshPointsGizmo
                v-if="showMeshPointsGizmo && selectedLayer && selectedLayerIds.size <= 1"
                :zoom="viewport.zoom.value"
                :points="getMeshPoints(selectedLayer)"
                :selected-index="meshSelectedPointIndex"
                :radius-min="0.15"
                :radius-max="1.5"
                @update:points="setMeshPoints(selectedLayer, $event)"
                @update:selected-index="meshSelectedPointIndex = $event"
              />
              <EditorBandPositionGizmo
                v-if="showBandPositionGizmo && selectedLayer && selectedLayerIds.size <= 1"
                :zoom="viewport.zoom.value"
                :band-y="getBandFloat(selectedLayer, BAND_Y, bandYDef.default as number)"
                :edge="getBandFloat(selectedLayer, BAND_EDGE, bandEdgeDef.default as number)"
                :y-min="bandYDef.min ?? 0"
                :y-max="bandYDef.max ?? 1"
                :edge-min="bandEdgeDef.min ?? 0.02"
                :edge-max="bandEdgeDef.max ?? 1"
                @update:band-y="setBandFloat(selectedLayer, BAND_Y, $event)"
                @update:edge="setBandFloat(selectedLayer, BAND_EDGE, $event)"
              />
              <EditorLayerTransformGizmo
                v-if="showTransformGizmo && selectedLayer && selectedLayerIds.size <= 1"
                :zoom="viewport.zoom.value"
                :layer-id="selectedLayer.id"
                :pick-at="canvasLayerAt"
                :snap-targets="snapTargets"
                :content-extent="layerContentExtent(selectedLayer)"
                :three-d="threeDGizmoDataFor(selectedLayer)"
                :position-x="getTransformFloat(selectedLayer, 'layerPositionX')"
                :position-y="getTransformFloat(selectedLayer, 'layerPositionY')"
                :position-z="getTransformFloat(selectedLayer, 'layerPositionZ')"
                :scale="getTransformFloat(selectedLayer, 'layerScale')"
                :rotation="getTransformFloat(selectedLayer, 'layerRotation')"
                :anchor-x="getTransformFloat(selectedLayer, 'layerAnchorX')"
                :anchor-y="getTransformFloat(selectedLayer, 'layerAnchorY')"
                :position-min="transformPosDef.min ?? -1"
                :position-max="transformPosDef.max ?? 1"
                :position-z-min="transformPosZDef.min ?? -2"
                :position-z-max="transformPosZDef.max ?? 2"
                :scale-min="transformScaleDef.min ?? 0"
                :scale-max="transformScaleDef.max ?? 400"
                :rotation-min="transformRotationDef.min ?? -360"
                :rotation-max="transformRotationDef.max ?? 360"
                :anchor-min="transformAnchorDef.min ?? 0"
                :anchor-max="transformAnchorDef.max ?? 1"
                @update:position-x="setTransformFloat(selectedLayer, 'layerPositionX', $event)"
                @update:position-y="setTransformFloat(selectedLayer, 'layerPositionY', $event)"
                @update:position-z="setTransformFloat(selectedLayer, 'layerPositionZ', $event)"
                @update:scale="setTransformFloat(selectedLayer, 'layerScale', $event)"
                @update:rotation="setTransformFloat(selectedLayer, 'layerRotation', $event)"
                @update:anchor-x="setTransformFloat(selectedLayer, 'layerAnchorX', $event)"
                @update:anchor-y="setTransformFloat(selectedLayer, 'layerAnchorY', $event)"
                @pick="(id, additive) => onCanvasSelect(id, additive)"
              />
              <EditorMultiTransformGizmo
                v-if="showMultiGizmo"
                :zoom="viewport.zoom.value"
                :layers="multiSelectedLayers"
                :get-transform="layerTransformValues"
                :get-extent="layerContentExtent"
                :get-three-d="threeDGizmoDataFor"
                :apply-param="applyLayerParam"
                :snap-targets="snapTargets"
                :pick-at="canvasLayerAt"
                @pick="(id, additive) => onCanvasSelect(id, additive)"
                @gesture-start="history.beginGesture()"
                @gesture-end="history.commitGesture()"
              />

              <!-- Text tool: click into text layers or empty canvas to edit/create -->
              <div
                v-if="activeTool === 'text' && !textEditingLayerId"
                class="absolute inset-0 z-30 cursor-text"
                @pointerdown="onTextToolPointerDown"
              />
              <EditorTextEditOverlay
                v-if="textEditingLayer"
                :layer="textEditingLayer"
                :comp="{ width: settings.width, height: settings.height }"
                :transform="layerTransformValues(textEditingLayer)"
                :intent="textEditIntent"
                @commit="commitTextEditing"
              />
              </template>
              </div>

              <template v-if="!previewing">
                <ShellBreadcrumbs
                  class="absolute top-[6px] left-[6px] z-20"
                  :trail="trail"
                  :comp-name="shaderName"
                  :names="compNames"
                  :current-time="currentTime"
                />
              </template>

            </div>

            <!-- Canvas panel footer (AE-style viewer bar): zoom dropdown; split from the canvas by a 2px frame line. -->
            <div
              v-if="!previewing"
              class="absolute inset-x-0 bottom-0 flex h-[20px] items-center justify-end gap-[2px] border-t-2 border-[var(--s-frame)] bg-[var(--s-tile)] px-[2px]"
            >
              <span v-if="playing && frameCache.buffering.value" class="mr-auto pl-[4px] text-[var(--s-dim)]">Rendering…</span>
              <StudioButton
                variant="ghost"
                :active="mixerOpen"
                class="!h-[16px]"
                title="Mixer (channel strips, meters)"
                @click="toggleMixer"
              >
                <StudioIcon name="audio" /> Mixer
              </StudioButton>
              <div class="grid w-[78px]" title="Preview resolution">
                <StudioSelect v-model="previewResolution" :options="PREVIEW_RES_OPTIONS" />
              </div>
              <div class="grid w-[78px]">
                <StudioSelect
                  :model-value="viewport.fitMode.value ? 'fit' : String(viewport.zoomPercent.value)"
                  :options="zoomOptions"
                  @update:model-value="setZoomChoice"
                />
              </div>
            </div>
          </div>

          <EditorComponentStageHost ref="stageHostRef" :layers="stagedComponentLayers" />
        </ClientOnly>
        </main>

        <aside
          v-show="!previewing"
          class="flex w-editor-panel shrink-0 flex-col overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)]"
        >
          <EditorEasingPanel
            v-if="selectedKeyframes.length > 0"
            v-model:tracks="tracks"
            class="shrink-0"
            :selection="selectedKeyframes"
          />
          <EditorLayerSettings
            v-if="selectedLayer && selectedTemplate"
            :key="selectedLayer.id"
            class="min-h-0 flex-1"
            :layer="selectedLayer"
          :template="selectedTemplate"
          :assignments="selectedLayerAssignments"
          :lfos="lfos"
          :dragging-lfo-id="draggingLfoId"
          :mesh-selected-point-index="meshSelectedPointIndex"
          :current-time="currentTime"
          :tracks="tracks"
          :composition-aspect="compositionAspect"
          @update:mesh-selected-point-index="meshSelectedPointIndex = $event"
          @assign-lfo="assignLfo"
          @remove-assignment="removeAssignment"
          @update-depth="updateDepth"
          @toggle-stopwatch="toggleStopwatch(selectedLayer.id, $event)"
          @toggle-keyframe="toggleKeyframeAtPlayhead(selectedLayer.id, $event)"
          @set-animated-value="(param, value) => setAnimatedValue(selectedLayer!.id, param, value)"
          @set-parent="(parentId, point) => setLayerParent(selectedLayer!.id, parentId, point)"
          @expose-prop="(param, label) => exposeProp(selectedLayer!.id, param, label)"
          />
          <ShellCompSettings
            v-else
            class="min-h-0 flex-1 overflow-y-auto"
            :settings="settings"
            :comp-name="shaderName"
            @set-size="setCompositionSize"
            @update="(patch) => { settings = { ...settings, ...patch }; history.record(); }"
            @mix-save="saveMixVersion"
            @mix-apply="useMixVersion"
            @mix-delete="(id) => { settings = { ...settings, mixVersions: (settings.mixVersions ?? []).filter((m) => m.id !== id), activeMix: settings.activeMix === id ? undefined : settings.activeMix }; history.record(); }"
          />

          <EditorLfoRack
            v-model:lfos="lfos"
            v-model:selected-lfo-id="selectedLfoId"
            class="max-h-48 shrink-0"
            @drag-start="onDragStart"
            @duplicate-lfo="duplicateLfo"
            @clear-assignments="clearLfoAssignments"
            @delete-lfo="deleteLfo"
          />
        </aside>
      </div>

      <template v-if="!previewing">
        <div class="group relative h-[var(--s-gap)] shrink-0" title="Drag to resize timeline">
          <div
            class="absolute inset-x-0 -top-1.5 -bottom-1.5 z-10 cursor-ns-resize touch-none select-none"
            @pointerdown="onTimelineResizePointerDown"
          />
        </div>
        <div v-if="mixerOpen" class="mb-[var(--s-gap)] h-[176px] shrink-0 overflow-hidden rounded-[var(--s-r)]">
          <EditorAudioMixer
            :layers="audioLayers"
            :tracks="tracks"
            :settings="settings"
            :entries="audioPlayback.entries.value"
            :meters="audioPlayback.meters.value"
            @update-settings="(patch) => { settings = { ...settings, ...patch }; history.record(); }"
          />
        </div>
        <div class="flex shrink-0 flex-col overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)]" :style="{ height: `${timelineHeight}px` }">
          <div class="min-h-0 flex-1">
          <EditorTimeline
            ref="timelineRef"
            v-model:layers="layers"
            v-model:tracks="tracks"
            v-model:selected-layer-id="selectedLayerId"
            v-model:selected-layer-ids="selectedLayerIds"
            v-model:selection-anchor-id="selectionAnchorId"
            v-model:selected-keyframes="selectedKeyframes"
            v-model:current-time="currentTime"
            v-model:playing="playing"
            v-model:px-per-second="timelineZoom"
            v-model:snapping="timelineSnapping"
            :settings="settings"
            :lfos="lfos"
            :assignments="assignments"
            :used-range="usedRange"
            :cached-ranges="cachedRanges"
            @select-modulator="(id: string) => (selectedLfoId = id)"
            @toggle-stopwatch="toggleStopwatch"
            @toggle-keyframe="toggleKeyframeAtPlayhead"
            @duplicate-layer="duplicateLayer"
            @remove-layer="removeLayer"
            @precompose="precomposeLayers"
            @insert-composition="insertCompositionLayer"
            @open-comp="openNestedComp"
            @set-parent="(layerId, parentId) => setLayerParent(layerId, parentId, null)"
          />
          </div>
        </div>
      </template>
    </div>
  </div>

  <div
    v-if="draggingLfo"
    data-ui="studio"
    class="pointer-events-none fixed z-50 flex w-max items-center gap-[6px] whitespace-nowrap rounded-[var(--s-r-ctl)] bg-[var(--s-band)] px-[6px] py-[3px] text-[var(--s-txt)] shadow-[0_0_0_1px_var(--s-edge),0_4px_12px_#0008]"
    :style="{
      left: `${dragPos.x}px`,
      top: `${dragPos.y}px`,
      transform: 'translate(-50%, -50%)',
    }"
  >
    <UiLfoSineIcon class="h-1.5 w-4 shrink-0" :style="{ color: draggingLfo.color }" />
    <span>{{ draggingLfo.label }}</span>
  </div>

  <ControlsExportDialog
    v-model:open="exportOpen"
    :experiment-id="shaderId ?? 'shader'"
    :shader="shaderExport"
    :composition-duration="settings.duration"
    :design-canvas="{ width: settings.width, height: settings.height }"
    :prepare-video-export="prepareVideoExport"
    :on-exported="storeRender"
  />
</template>
