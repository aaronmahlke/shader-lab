<script setup lang="ts">
import type {
  LayerInstance,
  LayerType,
  LFOSource,
  ModulationAssignment,
  PropertyTrack,
  CompositionSettings,
} from "@shader-lab/core";
import {
  LAYER_TEMPLATES,
  DEFAULT_COMPOSITION_SETTINGS,
  UNIVERSAL_LAYER_UNIFORMS,
  findLayerParamDef,
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
} from "@shader-lab/core";
import { refDebounced } from "@vueuse/core";
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
import { PICKABLE_LAYER_TYPES, topLayerAt } from "#shared/editor/canvas-picking";
import { collectSnapTargets } from "#shared/editor/snapping";
import { cloneEditorSnapshot, type EditorSnapshot } from "#shared/editor/editor-history";
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
import { normalizeLfo } from "@shader-lab/core";
import {
  cloneShaderPreset,
  getShaderPreset,
  DEFAULT_PRESET_ID,
} from "#shared/editor/shader-presets";
import { buildLayerValues, offsetDuplicatedWave } from "@shader-lab/core";
import { defaultStageComponentName } from "~/utils/stage-components";
import {
  beginExportClock,
  seekStageSequences,
  endExportClock,
  setTimelineDrive,
  createDomAnimationStepper,
} from "~/utils/export-clock";
import { ChevronRightIcon } from "@heroicons/vue/16/solid";
import {
  WAVE_AMPLITUDE,
  WAVE_CYCLE_WIDTH,
  WAVE_POS_X,
  WAVE_POS_Y,
} from "#shared/editor/wave-position";
import { BAND_EDGE, BAND_Y } from "#shared/editor/band-position";
import { cloneMeshPoints } from "@shader-lab/core";
import { CubeIcon, ArrowPathIcon } from "@heroicons/vue/16/solid";
import type { MeshPoint } from "@shader-lab/core";
import { MESH_MAX_POINTS } from "@shader-lab/core";

useHead({ title: "Shader — Shader Lab" });

const route = useRoute();
const exportOpen = ref(false);
const layerSettingsRef = ref<{ randomize: () => void; reset: () => void } | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const editorSplitRef = ref<HTMLElement | null>(null);
const { prefs: layoutPrefs, updatePrefs: updateLayoutPrefs } = useEditorLayoutPreferences();

const timelineHeight = ref(layoutPrefs.value.timelineHeight);

const timelineZoom = computed({
  get: () => layoutPrefs.value.timelinePxPerSecond,
  set: (pxPerSecond) => updateLayoutPrefs({ timelinePxPerSecond: pxPerSecond }),
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
    const comp = data.value as {
      id: string;
      name: string;
      data: {
        layers: LayerInstance[];
        lfos: LFOSource[];
        assignments: ModulationAssignment[];
        settings?: CompositionSettings;
        tracks?: PropertyTrack[];
      };
    };
    shaderId.value = comp.id;
    shaderName.value = comp.name;
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

const { lfoValues, getModulatedValue, modFn, sampleLfosAtTime } = useModulationEngine(
  lfos,
  assignments,
  { clockTime: currentTime, tracks },
);

provide("lfoValues", lfoValues);

// --- Playback ---

let playbackId: number | null = null;
let lastPlaybackMs = 0;
let playbackClock = 0;

function playbackTick(now: number) {
  if (!playing.value) return;
  const delta = lastPlaybackMs === 0 ? 0 : (now - lastPlaybackMs) / 1000;
  lastPlaybackMs = now;

  playbackClock += delta;
  const fps = settings.value.fps;
  const step = 1 / fps;
  const frame = Math.floor(playbackClock / step);
  const maxFrame = Math.floor(settings.value.duration * fps);

  if (frame >= maxFrame) {
    playbackClock = 0;
    currentTime.value = 0;
  } else {
    currentTime.value = frame * step;
  }

  playbackId = requestAnimationFrame(playbackTick);
}

watch(playing, (isPlaying) => {
  if (isPlaying) {
    playbackClock = currentTime.value;
    lastPlaybackMs = 0;
    playbackId = requestAnimationFrame(playbackTick);
  } else if (playbackId !== null) {
    cancelAnimationFrame(playbackId);
    playbackId = null;
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

/** Render buffer follows the displayed size (crisp zoom), capped for VRAM. */
const debouncedZoom = refDebounced(viewport.zoom, 150);
const renderBufferSize = computed(() => {
  const { width, height } = settings.value;
  const dpr = import.meta.client ? window.devicePixelRatio || 1 : 1;
  let scale = Math.min(Math.max(debouncedZoom.value * dpr, 0.05), 2);
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

const { passes } = useLayerCompiler(renderLayers, modFn, lfos, assignments);
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
} = useMultiPassRenderer(canvasRef, passes, {
  layers,
  tracks,
  fixedBufferSize: renderBufferSize,
  scaleReferenceWidth: compositionWidth,
  contentReferenceHeight: compositionHeight,
  getModulatedValue: modFn,
  sampleLfosAtTime,
  compositionTime: currentTime,
});

// --- Component layers: off-screen stage + DOM capture ---

const stageHostRef = ref<{ getElement: (layerId: string) => HTMLElement | null } | null>(null);

const componentCapture = useComponentCapture({
  layers,
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
  for (const layer of layers.value) {
    if (layer.type !== "component") continue;
    offsets.set(layer.id, Math.max(0, (tSec - (layer.timing?.in ?? 0)) * 1000));
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

function componentStageRoots(): Element[] {
  const roots: Element[] = [];
  for (const layer of layers.value) {
    if (layer.type !== "component") continue;
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
  getCanvas,
  configureRenderer,
  restoreRenderer,
  renderFrame: async (time: number) => {
    currentTime.value = time;
    // 1. Seek sequences to the frame time (fires their due events).
    seekStageToCompTime(time);
    // 2. Let Vue flush the resulting DOM changes so new CSS transitions exist.
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
    await componentCapture.captureAll();
    renderFrame(time);
  },
};

// --- Auto-Save ---

const shaderData = computed(() => ({
  version: 1 as const,
  layers: layers.value,
  lfos: lfos.value,
  assignments: assignments.value,
  settings: settings.value,
  tracks: tracks.value,
}));

useAutoSave(shaderId, shaderName, shaderData, { getCanvas });

// --- Keyframe / track helpers ---

const timelineRef = ref<{ revealLayerTracks: (layerId: string) => void } | null>(null);

function paramValue(layerId: string, paramName: string, fallback: number): number {
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return fallback;
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  const base = (layer.values[paramName] as number) ?? fallback;
  return evaluatePropertyTrack(track, currentTime.value, base);
}

function toggleStopwatch(layerId: string, paramName: string) {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  if (isPropertyTrackActive(track)) {
    tracks.value = setTrackEnabled(tracks.value, layerId, paramName, false);
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) => !(k.layerId === layerId && k.paramName === paramName),
    );
    history.record();
    return;
  }
  const layer = layers.value.find((l) => l.id === layerId);
  const def = layer ? findLayerParamDef(layer, paramName) : undefined;
  const fallback = (def?.default as number) ?? 0;
  const value = paramValue(layerId, paramName, fallback);
  tracks.value = setTrackEnabled(
    tracks.value,
    layerId,
    paramName,
    true,
    value,
    currentTime.value,
  );
  timelineRef.value?.revealLayerTracks(layerId);
  history.record();
}

function setAnimatedValue(layerId: string, paramName: string, value: number) {
  tracks.value = upsertKeyframe(
    tracks.value,
    layerId,
    paramName,
    currentTime.value,
    value,
  );
}

function toggleKeyframeAtPlayhead(layerId: string, paramName: string) {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  if (!track?.enabled) return;

  if (hasKeyframeAt(track, currentTime.value)) {
    tracks.value = removeKeyframeAt(
      tracks.value,
      layerId,
      paramName,
      currentTime.value,
    );
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) =>
        !(
          k.layerId === layerId &&
          k.paramName === paramName &&
          Math.abs(k.time - currentTime.value) < 1e-6
        ),
    );
    history.record();
    return;
  }

  const layer = layers.value.find((l) => l.id === layerId);
  const def = layer ? findLayerParamDef(layer, paramName) : undefined;
  const fallback = (def?.default as number) ?? 0;
  const value = paramValue(layerId, paramName, fallback);
  tracks.value = upsertKeyframe(
    tracks.value,
    layerId,
    paramName,
    currentTime.value,
    value,
  );
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

function addLayer(type: LayerType) {
  const template = LAYER_TEMPLATES[type];
  if (!template) return;

  const id = createUniqueLayerId(type, layers.value, layerCounter);
  const values = buildLayerValues(type);

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
  selectedLayerId.value = id;
  selectedLayerIds.value = new Set([id]);
  selectionAnchorId.value = id;
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
      const url = await uploadMediaFile(kind, file);
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
  if (results.some((result) => result.status === "rejected")) {
    flashMediaImportError(
      addedIds.length > 0 ? "Some media failed to upload." : "Upload failed. Try again.",
    );
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

function getGizmoFloat(layer: LayerInstance, paramName: string, fallback: number): number {
  return paramValue(layer.id, paramName, fallback);
}

function setGizmoFloat(layer: LayerInstance, paramName: string, value: number) {
  if (isPropertyTrackActive(findPropertyTrack(tracks.value, layer.id, paramName))) {
    setAnimatedValue(layer.id, paramName, value);
    return;
  }
  layer.values[paramName] = value;
}

// --- Universal transform gizmo (generators without a specialized gizmo) ---

const TRANSFORM_GIZMO_TYPES = new Set<LayerType>(["gradient", "solid", "noise", "text", "component", "shape", "image", "video"]);

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
const transformScaleDef = transformDef("layerScale");
const transformRotationDef = transformDef("layerRotation");

function getTransformFloat(layer: LayerInstance, name: string): number {
  return paramValue(layer.id, name, transformDef(name).default as number);
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
  return topLayerAt(layers.value, uv, aspect, layerTransformValues, layerContentExtent)?.id ?? null;
}

const compositionAspect = computed(() => settings.value.width / settings.value.height);

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

const layerAddBarRef = ref<{ openPanel: () => void } | null>(null);

registerKeyboard({
  id: "shader:add-layer-palette",
  priority: EditorKeyboardPriority.transport,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return false;
    layerAddBarRef.value?.openPanel();
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
  <EditorFrame>
    <div ref="editorSplitRef" class="flex h-full min-h-0 flex-col">
      <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-layer-1">
        <ClientOnly>
          <div class="size-full min-h-0 select-none">
            <div
              ref="viewportRef"
              class="absolute inset-0 overflow-hidden bg-base-0"
              :class="viewport.panning.value && 'cursor-grabbing'"
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
                class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-accent/60 bg-accent/10"
              >
                <span class="rounded-lg border border-neutral bg-layer-1/90 px-3 py-1.5 text-copy-sm text-neutral-strong backdrop-blur">
                  Drop images or videos to add layers
                </span>
              </div>
              <div
                v-else-if="mediaImportCount > 0 || mediaImportError"
                class="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2"
              >
                <span
                  class="rounded-lg border border-neutral bg-layer-1/90 px-3 py-1.5 text-copy-xs backdrop-blur"
                  :class="mediaImportError ? 'text-red-400' : 'text-neutral-subtle'"
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
                </div>
              <EditorCanvasPicker
                :layers="layers"
                :selected-layer-ids="[...selectedLayerIds]"
                :get-transform="layerTransformValues"
                :get-extent="layerContentExtent"
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
                :position-x="getTransformFloat(selectedLayer, 'layerPositionX')"
                :position-y="getTransformFloat(selectedLayer, 'layerPositionY')"
                :scale="getTransformFloat(selectedLayer, 'layerScale')"
                :rotation="getTransformFloat(selectedLayer, 'layerRotation')"
                :anchor-x="getTransformFloat(selectedLayer, 'layerAnchorX')"
                :anchor-y="getTransformFloat(selectedLayer, 'layerAnchorY')"
                :position-min="transformPosDef.min ?? -1"
                :position-max="transformPosDef.max ?? 1"
                :scale-min="transformScaleDef.min ?? 0"
                :scale-max="transformScaleDef.max ?? 400"
                :rotation-min="transformRotationDef.min ?? -360"
                :rotation-max="transformRotationDef.max ?? 360"
                @update:position-x="setTransformFloat(selectedLayer, 'layerPositionX', $event)"
                @update:position-y="setTransformFloat(selectedLayer, 'layerPositionY', $event)"
                @update:scale="setTransformFloat(selectedLayer, 'layerScale', $event)"
                @update:rotation="setTransformFloat(selectedLayer, 'layerRotation', $event)"
                @pick="(id, additive) => onCanvasSelect(id, additive)"
              />
              <EditorMultiTransformGizmo
                v-if="showMultiGizmo"
                :zoom="viewport.zoom.value"
                :layers="multiSelectedLayers"
                :get-transform="layerTransformValues"
                :get-extent="layerContentExtent"
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
              </div>

              <!-- Canvas tools -->
              <EditorCanvasToolbar
                v-model:tool="activeTool"
                class="absolute bottom-3 left-1/2 z-20 -translate-x-1/2"
              />

              <!-- Zoom controls -->
              <div class="absolute right-3 bottom-3 z-20 flex items-center gap-0.5 rounded-lg border border-neutral bg-layer-1/90 p-0.5 backdrop-blur">
                <button
                  type="button"
                  class="rounded-md px-1.5 py-1 text-copy-xs transition-colors"
                  :class="viewport.fitMode.value
                    ? 'bg-accent/25 text-neutral-strong ring-1 ring-accent/50'
                    : 'text-neutral-subtle hover:bg-control hover:text-neutral-strong'"
                  title="Zoom to fit — stays fitted until you zoom or pan (⌘0)"
                  @click="viewport.fit()"
                >
                  Fit
                </button>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-1 font-mono text-copy-xs text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
                  title="Zoom out (⌘−)"
                  @click="viewport.stepZoom(-1)"
                >
                  −
                </button>
                <button
                  type="button"
                  class="min-w-12 rounded-md px-1 py-1 text-center font-mono text-copy-xs text-neutral-strong transition-colors hover:bg-control"
                  title="Zoom to 100% (⌘1)"
                  @click="viewport.zoomTo100()"
                >
                  {{ viewport.zoomPercent.value }}%
                </button>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-1 font-mono text-copy-xs text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
                  title="Zoom in (⌘+)"
                  @click="viewport.stepZoom(1)"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <EditorComponentStageHost ref="stageHostRef" :layers="layers" />
        </ClientOnly>

        <div class="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center gap-2">
          <EditorLayerAddBar ref="layerAddBarRef" class="pointer-events-auto" @select="addLayer" />
          <UiPopover side="bottom" align="center">
            <template #trigger>
              <button
                type="button"
                class="pointer-events-auto flex h-9 items-center rounded-xl border border-neutral bg-layer-1/90 px-3 font-mono text-copy-xs text-neutral-subtle backdrop-blur transition-colors hover:text-neutral-strong"
                title="Composition size"
              >
                {{ settings.width }} × {{ settings.height }}
              </button>
            </template>
            <div class="flex w-56 flex-col gap-2 p-1">
              <span class="px-1 text-copy-2xs font-medium tracking-wide text-neutral-subtle uppercase">
                Composition size
              </span>
              <div class="flex items-center gap-1.5 px-1">
                <input
                  :value="settings.width"
                  type="text"
                  inputmode="numeric"
                  class="w-full rounded-md bg-control px-2 py-1 text-right font-mono text-copy-xs text-neutral-strong outline-none"
                  @change="setCompositionSize(Number(($event.target as HTMLInputElement).value), settings.height)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
                <span class="text-copy-xs text-neutral-weak">×</span>
                <input
                  :value="settings.height"
                  type="text"
                  inputmode="numeric"
                  class="w-full rounded-md bg-control px-2 py-1 text-right font-mono text-copy-xs text-neutral-strong outline-none"
                  @change="setCompositionSize(settings.width, Number(($event.target as HTMLInputElement).value))"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>
              <div class="flex flex-col">
                <button
                  v-for="preset in COMP_SIZE_PRESETS"
                  :key="preset.label"
                  type="button"
                  class="flex items-center justify-between rounded-md px-2 py-1.5 text-copy-xs transition-colors hover:bg-control"
                  :class="settings.width === preset.width && settings.height === preset.height
                    ? 'text-neutral-strong'
                    : 'text-neutral-subtle'"
                  @click="setCompositionSize(preset.width, preset.height)"
                >
                  <span>{{ preset.label }}</span>
                  <span class="font-mono text-copy-2xs text-neutral-weak">{{ preset.width }}×{{ preset.height }}</span>
                </button>
              </div>
            </div>
          </UiPopover>
        </div>
      </div>

      <div
        class="group relative h-1 shrink-0"
        title="Drag to resize timeline"
      >
        <div
          class="absolute inset-x-0 -top-1.5 -bottom-1.5 flex cursor-ns-resize touch-none items-center justify-center select-none"
          @pointerdown="onTimelineResizePointerDown"
        >
          <div class="h-0.5 w-10 rounded-full bg-neutral-subtle transition-colors group-hover:bg-neutral-strong" />
        </div>
      </div>

      <div
        class="flex shrink-0 flex-col overflow-hidden rounded-lg bg-layer-1"
        :style="{ height: `${timelineHeight}px` }"
      >
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
          :settings="settings"
          @toggle-stopwatch="toggleStopwatch"
          @toggle-keyframe="toggleKeyframeAtPlayhead"
          @duplicate-layer="duplicateLayer"
          @remove-layer="removeLayer"
        />
      </div>
    </div>

    <template #right>
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex shrink-0 items-center gap-2 border-b border-neutral px-2 py-2">
          <UiHover>
            <NuxtLink
              to="/"
              class="flex size-8 items-center justify-center text-neutral-subtle outline-none group-hover/h:text-neutral-strong"
              title="Shader Lab"
            >
              <ChevronRightIcon class="size-4 rotate-180" />
            </NuxtLink>
          </UiHover>
          <UiEditableText
            v-model="shaderName"
            fill
            class="min-w-0 flex-1 text-copy-sm text-neutral-strong"
          />
          <UiButton variant="filled" size="sm" @click="exportOpen = true">
            Export
          </UiButton>
        </div>

        <div class="flex shrink-0 items-center gap-0.5 border-b border-neutral px-3 py-2">
          <UiButton
            v-if="selectedLayer && selectedTemplate"
            variant="ghost"
            size="sm"
            :icon-left="CubeIcon"
            title="Randomize"
            @click="layerSettingsRef?.randomize(); history.record()"
          />
          <UiButton
            v-if="selectedLayer && selectedTemplate"
            variant="ghost"
            size="sm"
            :icon-left="ArrowPathIcon"
            title="Reset to defaults"
            @click="layerSettingsRef?.reset(); history.record()"
          />
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <EditorEasingPanel
            v-if="selectedKeyframes.length > 0"
            v-model:tracks="tracks"
            class="shrink-0"
            :selection="selectedKeyframes"
          />
          <EditorLayerSettings
            v-if="selectedLayer && selectedTemplate"
            ref="layerSettingsRef"
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
          />
          <div
            v-else
            class="flex flex-1 items-center justify-center p-6 text-center"
          >
            <p class="text-copy-sm text-neutral-subtle">
              Select a layer to edit its properties.
            </p>
          </div>

          <EditorLfoList
            v-model:lfos="lfos"
            v-model:selected-lfo-id="selectedLfoId"
            class="max-h-48 shrink-0 border-t border-neutral"
            @drag-start="onDragStart"
            @duplicate-lfo="duplicateLfo"
            @clear-assignments="clearLfoAssignments"
            @delete-lfo="deleteLfo"
          />
        </div>
      </div>
    </template>
  </EditorFrame>

  <div
    v-if="draggingLfo"
    class="pointer-events-none fixed z-50 flex w-max items-center gap-2 whitespace-nowrap rounded-lg border border-neutral bg-layer-1 px-2.5 py-1.5 text-copy-sm text-neutral-strong shadow-panel"
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
  />
</template>
