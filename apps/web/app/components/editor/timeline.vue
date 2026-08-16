<script setup lang="ts">
import {
  ChevronRightIcon,
  PlayIcon,
  PauseIcon,
  MinusIcon,
  PlusIcon,
  EyeIcon,
  EyeSlashIcon,
  CubeIcon,
  CubeTransparentIcon,
  Square2StackIcon,
  PhotoIcon,
  FilmIcon,
  LanguageIcon,
  PuzzlePieceIcon,
  VideoCameraIcon,
  SunIcon,
  StopIcon,
  SwatchIcon,
  Squares2X2Icon,
  CloudIcon,
  SparklesIcon,
  CircleStackIcon,
  AdjustmentsHorizontalIcon,
  Bars3Icon,
  Bars2Icon,
  ScissorsIcon,
  PaintBrushIcon,
  BoltIcon,
  ViewfinderCircleIcon,
} from "@heroicons/vue/16/solid";
import { useEventListener } from "@vueuse/core";
import {
  EditorKeyboardPriority,
  useEditorKeyboard,
} from "~/composables/use-editor-keyboard";
import {
  EASING_PRESETS,
  LAYER_TEMPLATES,
  evaluateKeyframes,
  evaluatePropertyTrack,
  find3DRuns,
  findPropertyTrack,
  hasKeyframeAt,
  isKeyframeableUniform,
  isPropertyTrackActive,
  matchEasingPreset,
  offsetKeyframes,
  setKeyframesEasing,
  isLayer3D,
  supports3D,
  universalUniformsFor,
  upsertKeyframe,
  type CompositionSettings,
  type CubicBezierEase,
  type Keyframe,
  type KeyframeEasing,
  type LayerInstance,
  type LayerUniformDef,
  type PropertyTrack,
} from "@shader-lab/core";
import { dataTransferHasComp, readCompDragPayload } from "#shared/editor/comp-drag";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";
import { layerBlockOverlapsPrevious, layerHeaderBlockRole } from "#shared/editor/layer-block-radius";
import {
  clampBarMoveIn,
  fitPxPerSecond,
  parseCompositionDuration,
} from "#shared/editor/timeline-window";
import {
  isKeyframeInSelection,
  toggleKeyframeInSelection,
} from "#shared/editor/keyframe-selection";

type Emits = {
  "toggle-stopwatch": [layerId: string, paramName: string];
  "toggle-keyframe": [layerId: string, paramName: string];
  "duplicate-layer": [id: string];
  "remove-layer": [id: string];
  /** AE-style pre-compose: group the given layers into a new composition. */
  precompose: [layerIds: string[]];
  /** A comp was dragged in from the project panel; the page owns the insert. */
  "insert-composition": [payload: { compId: string; name: string; index: number }];
};

const expanded = ref<Set<string>>(new Set());
/** Layer ids showing keyed properties while row is collapsed (U key). */
const keyframesRevealed = ref<Set<string>>(new Set());
/** U-view rows that stay visible after stopwatch off until layer collapses. */
const pinnedUViewProperties = ref<Set<string>>(new Set());
const labelWidth = 208;

const PLAYHEAD_HEAD =
  "M0.31938 3.08047C-0.535142 1.74938 0.420642 0 2.00241 0H7.68118C9.26295 0 10.2187 1.74938 9.36421 3.08047L5.95419 8.39224C5.71104 8.77099 5.29188 9 4.8418 9C4.39171 9 3.97256 8.77099 3.72941 8.39224L0.31938 3.08047Z";

const DEFAULT_PX_PER_SECOND = 96;
const MIN_PX_PER_SECOND = 16;
const MAX_PX_PER_SECOND = 640;
/** AE-style UU within this window fully expands after U from collapsed. */
const U_DOUBLE_MS = 350;
let lastUAt = 0;
let lastUTargetIds: string[] = [];
/** Set when a single U reveals keyed props from collapsed; cleared on any other U action. */
let pendingUUFromCollapsed = false;

const layers = defineModel<LayerInstance[]>("layers", { required: true });
const tracks = defineModel<PropertyTrack[]>("tracks", { required: true });
const selectedLayerId = defineModel<string | null>("selectedLayerId", { required: true });
const selectedLayerIds = defineModel<Set<string>>("selectedLayerIds", { required: true });
const selectionAnchorId = defineModel<string | null>("selectionAnchorId", { required: true });
const selectedKeyframes = defineModel<KeyframeSelection[]>("selectedKeyframes", {
  default: () => [],
});
const currentTime = defineModel<number>("currentTime", { required: true });
const playing = defineModel<boolean>("playing", { required: true });
const pxPerSecond = defineModel<number>("pxPerSecond", { default: DEFAULT_PX_PER_SECOND });

const { settings } = defineProps<{
  settings: CompositionSettings;
}>();

const emit = defineEmits<Emits>();

const history = useEditorHistory();

function layerIndex(id: string): number {
  return layers.value.findIndex((l) => l.id === id);
}

function selectedLayerIndices(): number[] {
  return layers.value
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => selectedLayerIds.value.has(layer.id))
    .map(({ index }) => index);
}

const { containerRef: layerListRef, draggingIndices } = useDragReorder(layers, {
  getSelectedIndices: selectedLayerIndices,
  onDragStartIndex(index, e) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    const layer = layers.value[index];
    if (!layer || selectedLayerIds.value.has(layer.id)) return;
    selectedLayerIds.value = new Set([layer.id]);
    selectedLayerId.value = layer.id;
    selectionAnchorId.value = layer.id;
    selectedKeyframes.value = [];
    history?.record();
  },
  onReorderGestureStart: () => history?.beginGesture(),
  onReorderGestureCommit: () => history?.commitGesture(),
  onReorderGestureCancel: () => history?.cancelGesture(),
});

// --- Composition drop (native HTML5 drag from the project panel) ---
// Independent from useDragReorder: the reorder system is pointer-event based
// and a native drag suppresses pointer events, so the two never overlap.

/** Insertion slot while a comp drag hovers the timeline, or null. */
const compDropIndex = ref<number | null>(null);
/** Indicator line y in layer-list content space (labels and tracks align). */
const compDropY = ref(0);

/** Insertion slot + indicator y from the pointer, over the layer row blocks. */
function compDropSlotFor(clientY: number): { index: number; y: number } {
  const listEl = layerListRef.value as HTMLElement | null;
  if (!listEl) return { index: 0, y: 0 };
  const listTop = listEl.getBoundingClientRect().top;
  // Row blocks only (header + expanded property rows); skips any overlays.
  const rows = Array.from(listEl.querySelectorAll(":scope > .layer-group")) as HTMLElement[];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { index: i, y: r.top - listTop };
  }
  const last = rows[rows.length - 1]?.getBoundingClientRect();
  return { index: rows.length, y: last ? last.bottom - listTop : 0 };
}

function onCompDragOver(e: DragEvent) {
  if (!dataTransferHasComp(e.dataTransfer)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  const slot = compDropSlotFor(e.clientY);
  compDropIndex.value = slot.index;
  compDropY.value = slot.y;
}

function onCompDragLeave(e: DragEvent) {
  // dragleave also fires when moving over children; only clear on a real exit.
  const el = e.currentTarget as HTMLElement | null;
  const to = e.relatedTarget as Node | null;
  if (el && to && el.contains(to)) return;
  compDropIndex.value = null;
}

function onCompDrop(e: DragEvent) {
  const payload = readCompDragPayload(e.dataTransfer);
  compDropIndex.value = null;
  if (!payload) return; // Foreign drag (e.g. media files): leave it alone.
  e.preventDefault();
  e.stopPropagation();
  const { index } = compDropSlotFor(e.clientY);
  emit("insert-composition", { compId: payload.id, name: payload.name, index });
}

watch(
  selectedLayerId,
  (id) => {
    if (id && selectedLayerIds.value.size === 0) {
      selectedLayerIds.value = new Set([id]);
      selectionAnchorId.value = id;
    }
  },
  { immediate: true },
);

const timelineWidth = computed(() => settings.duration * pxPerSecond.value);
const playheadX = computed(() => timeToX(currentTime.value));
const scrubbing = ref(false);
/** Time driving the property value labels (follows the playhead live). */
const displayTime = ref(currentTime.value);
const zoomPercent = computed(() =>
  Math.round((pxPerSecond.value / DEFAULT_PX_PER_SECOND) * 100),
);

watch(currentTime, (t) => {
  displayTime.value = t;
});

const rulerStep = computed(() => {
  for (const step of [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]) {
    if (step * pxPerSecond.value >= 56) return step;
  }
  return 60;
});

const pxPerFrame = computed(() => pxPerSecond.value / settings.fps);
const showFrameTicks = computed(() => pxPerFrame.value >= 4);

/** Pixel x for a time, snapped to frame boundaries for grid alignment. */
function timeToX(time: number): number {
  const frame = Math.round(time * settings.fps);
  return Math.round(((frame / settings.fps) * pxPerSecond.value) * 100) / 100;
}

function xToTime(x: number): number {
  return Math.max(0, Math.min(settings.duration, x / pxPerSecond.value));
}

type RulerMark = {
  time: number;
  kind: "major" | "mid" | "frame";
};

const rulerMarks = computed((): RulerMark[] => {
  const duration = settings.duration;
  const fps = settings.fps;
  const frameDur = 1 / fps;
  const majorStep = rulerStep.value;

  if (!showFrameTicks.value) {
    const marks: RulerMark[] = [];
    for (let t = 0; t <= duration + 1e-9; t += majorStep) {
      marks.push({ time: Math.round(t * 1000) / 1000, kind: "major" });
    }
    return marks;
  }

  const marks: RulerMark[] = [];
  const totalFrames = Math.ceil(duration * fps);

  for (let f = 0; f <= totalFrames; f++) {
    const time = Math.round(Math.min(f * frameDur, duration) * 10000) / 10000;
    const majorTime = Math.round(time / majorStep) * majorStep;
    const isMajor = Math.abs(time - majorTime) < frameDur * 0.5;

    if (isMajor) {
      marks.push({ time, kind: "major" });
    } else if (f % 5 === 0 && pxPerFrame.value >= 6) {
      marks.push({ time, kind: "mid" });
    } else {
      marks.push({ time, kind: "frame" });
    }
  }

  return marks;
});

function formatRulerLabel(time: number): string {
  if (rulerStep.value < 1) return `${time.toFixed(1)}s`;
  return `${time}s`;
}

function rulerMarkHeight(kind: RulerMark["kind"]): string {
  if (kind === "major") return "100%";
  if (kind === "mid") return "55%";
  return "30%";
}

const frameGridStyle = computed(() => {
  if (!showFrameTicks.value) return {};
  const step = Math.max(1, Math.round(pxPerFrame.value * 100) / 100);
  return {
    backgroundImage:
      "linear-gradient(to right, rgb(128 128 128 / 0.14) 1px, transparent 1px)",
    backgroundSize: `${step}px 100%`,
  };
});

function applyScrollLeft(scrollLeft: number) {
  const body = bodyScrollRef.value;
  const ruler = rulerScrollRef.value;
  if (!body) return;
  const maxScroll = Math.max(0, body.scrollWidth - body.clientWidth);
  const next = Math.max(0, Math.min(maxScroll, scrollLeft));
  hScrollSyncLock = true;
  body.scrollLeft = next;
  if (ruler) ruler.scrollLeft = next;
  hScrollSyncLock = false;
}

function syncLabelsScrollTop() {
  const labels = labelsScrollRef.value;
  const body = bodyScrollRef.value;
  if (!labels || !body) return;
  vScrollSyncLock = true;
  labels.scrollTop = body.scrollTop;
  vScrollSyncLock = false;
}

function zoomAt(factor: number, anchorClientX: number) {
  const body = bodyScrollRef.value;
  if (!body) return;

  const rect = body.getBoundingClientRect();
  const anchorX = anchorClientX - rect.left;
  const anchorTime = (body.scrollLeft + anchorX) / pxPerSecond.value;

  const next = Math.max(
    MIN_PX_PER_SECOND,
    Math.min(MAX_PX_PER_SECOND, pxPerSecond.value * factor),
  );
  if (Math.abs(next - pxPerSecond.value) < 1e-6) return;

  userZoomed.value = true;
  pxPerSecond.value = next;
  nextTick(() => {
    applyScrollLeft(anchorTime * next - anchorX);
  });
}

function zoomIn() {
  const body = bodyScrollRef.value;
  if (!body) return;
  const rect = body.getBoundingClientRect();
  zoomAt(1.25, rect.left + rect.width / 2);
}

function zoomOut() {
  const body = bodyScrollRef.value;
  if (!body) return;
  const rect = body.getBoundingClientRect();
  zoomAt(0.8, rect.left + rect.width / 2);
}

/** Set after any manual zoom; auto-fit stays off until the Fit control resets it. */
const userZoomed = ref(false);

/** Zoom so the whole composition fills the visible track area. */
function applyFitZoom() {
  const body = bodyScrollRef.value;
  if (!body) return;
  const next = fitPxPerSecond(
    body.clientWidth,
    settings.duration,
    MIN_PX_PER_SECOND,
    MAX_PX_PER_SECOND,
  );
  if (next === null) return;
  pxPerSecond.value = next;
  nextTick(() => applyScrollLeft(0));
}

function fitTimeline() {
  userZoomed.value = false;
  applyFitZoom();
}

onMounted(() => {
  nextTick(applyFitZoom);
});

watch(
  () => settings.duration,
  () => {
    if (userZoomed.value) return;
    nextTick(applyFitZoom);
  },
);

function onTimelineWheel(e: WheelEvent) {
  if (e.altKey) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(factor, e.clientX);
    return;
  }

  // Forward vertical wheel over the fixed labels column to the tracks scroller.
  const labels = labelsScrollRef.value;
  const body = bodyScrollRef.value;
  if (!labels || !body || e.currentTarget !== labels) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.preventDefault();
  body.scrollTop += e.deltaY;
}

const bodyScrollRef = ref<HTMLElement | null>(null);
const rulerScrollRef = ref<HTMLElement | null>(null);
const labelsScrollRef = ref<HTMLElement | null>(null);
const tracksContentRef = ref<HTMLElement | null>(null);

let vScrollSyncLock = false;
let hScrollSyncLock = false;

function onBodyScroll() {
  if (!vScrollSyncLock) {
    syncLabelsScrollTop();
  }

  if (hScrollSyncLock) return;
  const ruler = rulerScrollRef.value;
  const body = bodyScrollRef.value;
  if (!ruler || !body) return;
  hScrollSyncLock = true;
  ruler.scrollLeft = body.scrollLeft;
  hScrollSyncLock = false;
}

function onRulerScroll() {
  if (hScrollSyncLock) return;
  const ruler = rulerScrollRef.value;
  const body = bodyScrollRef.value;
  if (!ruler || !body) return;
  hScrollSyncLock = true;
  body.scrollLeft = ruler.scrollLeft;
  hScrollSyncLock = false;
}

const LAYER_ROW_H = 28;
const PROP_ROW_H = 24;
const KEY_HIT_R = 8;
/** Keep playhead this far from the viewport edge while scrubbing. */
const SCRUB_SCROLL_MARGIN = 24;

type MarqueeRect = { x0: number; y0: number; x1: number; y1: number };
const marquee = ref<MarqueeRect | null>(null);

const marqueeStyle = computed(() => {
  if (!marquee.value) return {};
  const { x0, y0, x1, y1 } = marquee.value;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(x1 - x0)}px`,
    height: `${Math.abs(y1 - y0)}px`,
  };
});

type KeyframeHit = KeyframeSelection & { x: number; y: number };

function collectKeyframeHits(): KeyframeHit[] {
  const hits: KeyframeHit[] = [];
  let y = 0;

  for (const layer of layers.value) {
    y += LAYER_ROW_H;
    for (const def of visibleProperties(layer)) {
      if (!showPropertyRow(layer, def.name)) continue;
      const centerY = y + PROP_ROW_H / 2;
      const track = findPropertyTrack(tracks.value, layer.id, def.name);
      for (const key of track?.keys ?? []) {
        hits.push({
          layerId: layer.id,
          paramName: def.name,
          time: key.time,
          x: timeToX(key.time),
          y: centerY,
        });
      }
      y += PROP_ROW_H;
    }
  }

  return hits;
}

function hitsInMarquee(rect: MarqueeRect): KeyframeSelection[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);

  return collectKeyframeHits()
    .filter(
      (k) =>
        k.x >= minX - KEY_HIT_R &&
        k.x <= maxX + KEY_HIT_R &&
        k.y >= minY - KEY_HIT_R &&
        k.y <= maxY + KEY_HIT_R,
    )
    .map(({ layerId, paramName, time }) => ({ layerId, paramName, time }));
}

function pointInTracksContent(ev: PointerEvent): { x: number; y: number } {
  const content = tracksContentRef.value;
  if (!content) return { x: 0, y: 0 };
  const rect = content.getBoundingClientRect();
  return {
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top,
  };
}

function layerLabel(layer: LayerInstance): string {
  return layer.name ?? LAYER_TEMPLATES[layer.type]?.label ?? layer.type;
}

/** Small type badge before the name — comps, media, and scene citizens only. */
const LAYER_TYPE_ICONS: Record<LayerInstance["type"], unknown> = {
  composition: Square2StackIcon,
  image: PhotoIcon,
  video: FilmIcon,
  text: LanguageIcon,
  component: PuzzlePieceIcon,
  camera: VideoCameraIcon,
  light: SunIcon,
  shape: StopIcon,
  object3d: CubeIcon,
  gradient: SwatchIcon,
  mesh: Squares2X2Icon,
  solid: StopIcon,
  noise: CloudIcon,
  waveFill: Bars2Icon,
  bandFill: Bars3Icon,
  distortion: AdjustmentsHorizontalIcon,
  dither: CircleStackIcon,
  grain: SparklesIcon,
  seam: ScissorsIcon,
  diffuse: PaintBrushIcon,
  vignette: ViewfinderCircleIcon,
  chromaticAberration: BoltIcon,
};

function layerTypeIcon(layer: LayerInstance) {
  return LAYER_TYPE_ICONS[layer.type] ?? null;
}

type LayerNameEditor = { startEditing: () => void; editing: boolean };
const layerNameRefs: Partial<Record<string, LayerNameEditor>> = {};

function bindLayerNameRef(layerId: string, el: unknown) {
  if (el && typeof el === "object" && "startEditing" in el) {
    layerNameRefs[layerId] = el as LayerNameEditor;
  } else {
    delete layerNameRefs[layerId];
  }
}

function setLayerName(layer: LayerInstance, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  layer.name = trimmed;
  history?.record();
}

/** AE-style: double-click a composition layer opens the referenced comp
 * (capture phase so it wins over the name field's rename; Enter still renames). */
function onLayerRowDblClick(layer: LayerInstance, e: MouseEvent) {
  if (layer.type !== "composition") return;
  const ref = layer.values.compRefId;
  if (typeof ref !== "string" || !ref) return;
  e.stopPropagation();
  e.preventDefault();
  navigateTo(`/shader/${ref}`);
}

function startRenameSelectedLayer() {
  const id = selectedLayerId.value;
  if (!id) return;
  const editor = layerNameRefs[id];
  if (!editor || editor.editing) return;
  editor.startEditing();
}

function isExpanded(layerId: string): boolean {
  return expanded.value.has(layerId);
}

function isKeyframesRevealed(layerId: string): boolean {
  return keyframesRevealed.value.has(layerId);
}

function isLayerPropertiesVisible(layerId: string): boolean {
  return isExpanded(layerId) || isKeyframesRevealed(layerId);
}

function hasVisiblePropertyRows(layer: LayerInstance): boolean {
  return keyframeableUniforms(layer).some((def) => showPropertyRow(layer, def.name));
}

/** Chevron reflects whether property rows are actually showing. */
function isLayerChevronOpen(layerId: string): boolean {
  if (isExpanded(layerId)) return true;
  if (!isKeyframesRevealed(layerId)) return false;
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return false;
  return hasVisiblePropertyRows(layer);
}

function uViewPropertyKey(layerId: string, paramName: string): string {
  return `${layerId}:${paramName}`;
}

function isPinnedInUView(layerId: string, paramName: string): boolean {
  return pinnedUViewProperties.value.has(uViewPropertyKey(layerId, paramName));
}

function clearUViewPinsForLayer(layerId: string) {
  const prefix = `${layerId}:`;
  pinnedUViewProperties.value = new Set(
    [...pinnedUViewProperties.value].filter((key) => !key.startsWith(prefix)),
  );
}

function toggleExpand(layerId: string) {
  if (isLayerPropertiesVisible(layerId)) {
    const nextExpanded = new Set(expanded.value);
    nextExpanded.delete(layerId);
    expanded.value = nextExpanded;

    const nextRevealed = new Set(keyframesRevealed.value);
    nextRevealed.delete(layerId);
    keyframesRevealed.value = nextRevealed;
    clearUViewPinsForLayer(layerId);
    return;
  }

  const next = new Set(expanded.value);
  next.add(layerId);
  expanded.value = next;
}

function layersForKeyframeRevealCommand(): string[] {
  if (selectedLayerIds.value.size > 0) return [...selectedLayerIds.value];
  if (selectedLayerId.value) return [selectedLayerId.value];
  return [];
}

function sameLayerSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

function fullExpandLayers(ids: string[]) {
  const nextExpanded = new Set(expanded.value);
  const nextRevealed = new Set(keyframesRevealed.value);
  for (const id of ids) {
    nextExpanded.add(id);
    nextRevealed.delete(id);
    clearUViewPinsForLayer(id);
  }
  expanded.value = nextExpanded;
  keyframesRevealed.value = nextRevealed;
}

function collapseLayers(ids: string[]) {
  const nextExpanded = new Set(expanded.value);
  const nextRevealed = new Set(keyframesRevealed.value);
  for (const id of ids) {
    nextExpanded.delete(id);
    nextRevealed.delete(id);
    clearUViewPinsForLayer(id);
  }
  expanded.value = nextExpanded;
  keyframesRevealed.value = nextRevealed;
}

function revealUViewLayers(ids: string[]) {
  const nextExpanded = new Set(expanded.value);
  const nextRevealed = new Set(keyframesRevealed.value);
  for (const id of ids) {
    nextExpanded.delete(id);
    nextRevealed.add(id);
  }
  expanded.value = nextExpanded;
  keyframesRevealed.value = nextRevealed;
}

function toggleRevealKeyframes() {
  const ids = layersForKeyframeRevealCommand();
  if (ids.length === 0) return;

  const now = Date.now();
  const doubleU =
    now - lastUAt < U_DOUBLE_MS && sameLayerSelection(ids, lastUTargetIds);

  if (doubleU && pendingUUFromCollapsed) {
    pendingUUFromCollapsed = false;
    lastUAt = 0;
    lastUTargetIds = [];
    fullExpandLayers(ids);
    return;
  }

  pendingUUFromCollapsed = false;

  const anyFullyExpanded = ids.some((id) => isExpanded(id));
  const anyPropertiesShowing = ids.some((id) => isLayerChevronOpen(id));
  const allFlagsCollapsed = ids.every(
    (id) => !isExpanded(id) && !isKeyframesRevealed(id),
  );

  if (anyFullyExpanded) {
    revealUViewLayers(ids);
  } else if (anyPropertiesShowing) {
    collapseLayers(ids);
  } else {
    revealUViewLayers(ids);
    if (allFlagsCollapsed) pendingUUFromCollapsed = true;
  }

  lastUAt = now;
  lastUTargetIds = [...ids];
}

function revealLayerTracks(layerId: string) {
  if (keyframesRevealed.value.has(layerId)) return;
  const next = new Set(keyframesRevealed.value);
  next.add(layerId);
  keyframesRevealed.value = next;
}

defineExpose({ revealLayerTracks });

function enabledTracksForLayer(layerId: string): PropertyTrack[] {
  return tracks.value.filter((t) => t.layerId === layerId && isPropertyTrackActive(t));
}

function keyframeableUniforms(layer: LayerInstance) {
  const template = LAYER_TEMPLATES[layer.type];
  if (!template) return [];
  return [
    ...universalUniformsFor(layer).filter(isKeyframeableUniform),
    ...template.uniforms.filter(isKeyframeableUniform),
  ];
}

function visibleProperties(layer: LayerInstance) {
  const all = keyframeableUniforms(layer);
  if (isExpanded(layer.id)) return all;
  if (!isKeyframesRevealed(layer.id)) return [];
  return all.filter((def) => showPropertyRow(layer, def.name));
}

function showPropertyRow(layer: LayerInstance, paramName: string): boolean {
  if (isExpanded(layer.id)) return true;
  if (!isKeyframesRevealed(layer.id)) return false;
  const track = findPropertyTrack(tracks.value, layer.id, paramName);
  return isPropertyTrackActive(track) || isPinnedInUView(layer.id, paramName);
}

function trackEnabled(layerId: string, paramName: string): boolean {
  return isPropertyTrackActive(findPropertyTrack(tracks.value, layerId, paramName));
}

watch(
  [tracks, keyframesRevealed, layers],
  () => {
    const nextPins = new Set<string>();
    const nextRevealed = new Set(keyframesRevealed.value);

    for (const layer of layers.value) {
      if (!nextRevealed.has(layer.id)) continue;

      const prefix = `${layer.id}:`;
      for (const key of pinnedUViewProperties.value) {
        if (key.startsWith(prefix)) nextPins.add(key);
      }
      for (const def of keyframeableUniforms(layer)) {
        const track = findPropertyTrack(tracks.value, layer.id, def.name);
        if (isPropertyTrackActive(track)) {
          nextPins.add(uViewPropertyKey(layer.id, def.name));
        }
      }

      const hasRows = keyframeableUniforms(layer).some((def) => {
        const track = findPropertyTrack(tracks.value, layer.id, def.name);
        return (
          isPropertyTrackActive(track) || nextPins.has(uViewPropertyKey(layer.id, def.name))
        );
      });
      if (!hasRows) {
        nextRevealed.delete(layer.id);
        for (const key of [...nextPins]) {
          if (key.startsWith(prefix)) nextPins.delete(key);
        }
      }
    }

    pinnedUViewProperties.value = nextPins;
    if (
      nextRevealed.size !== keyframesRevealed.value.size ||
      [...nextRevealed].some((id) => !keyframesRevealed.value.has(id))
    ) {
      keyframesRevealed.value = nextRevealed;
    }
  },
  { deep: true },
);

function valueAt(layer: LayerInstance, paramName: string, fallback: number): number {
  const track = findPropertyTrack(tracks.value, layer.id, paramName);
  const base = (layer.values[paramName] as number) ?? fallback;
  return evaluatePropertyTrack(track, displayTime.value, base);
}

// --- Keyframe easing (context menu) ---

const NAMED_EASINGS: { id: KeyframeEasing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "easeIn", label: "Ease In" },
  { id: "easeOut", label: "Ease Out" },
  { id: "easeInOut", label: "Ease In Out" },
  { id: "hold", label: "Hold" },
];

/** Apply to the whole selection when the clicked key is part of it. */
function applyKeyframeEasing(
  layerId: string,
  paramName: string,
  time: number,
  easing: KeyframeEasing | CubicBezierEase,
) {
  const refs = isKeyframeInSelection(selectedKeyframes.value, layerId, paramName, time)
    ? selectedKeyframes.value
    : [{ layerId, paramName, time }];
  tracks.value = setKeyframesEasing(tracks.value, refs, easing);
  history?.record();
}

/** Shape variant for a key's diamond: linear, eased (curve/named), or hold. */
function keyframeShape(key: Keyframe): "linear" | "eased" | "hold" {
  if (key.ease === "hold") return "hold";
  if (key.curve) return "eased";
  if (key.ease && key.ease !== "linear") return "eased";
  return "linear";
}

/** Mini value curves drawn between adjacent keys in a property row. */
function segmentPaths(layerId: string, paramName: string): string[] {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  if (!track || track.keys.length < 2) return [];

  const keys = [...track.keys].sort((a, b) => a.time - b.time);
  const top = 5;
  const bottom = PROP_ROW_H - 5;
  const paths: string[] = [];

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const x0 = timeToX(a.time);
    const x1 = timeToX(b.time);
    if (x1 - x0 < 6) continue;

    if (Math.abs(b.value - a.value) < 1e-9) {
      const mid = (top + bottom) / 2;
      paths.push(`M ${x0.toFixed(1)} ${mid} L ${x1.toFixed(1)} ${mid}`);
      continue;
    }

    const rising = b.value > a.value;
    const yStart = rising ? bottom : top;
    const yEnd = rising ? top : bottom;
    const steps = 24;
    const points: string[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const value = evaluateKeyframes([a, b], a.time + t * (b.time - a.time), a.value);
      const norm = (value - a.value) / (b.value - a.value);
      const x = x0 + (x1 - x0) * t;
      const y = yStart + (yEnd - yStart) * norm;
      points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    paths.push(`M ${points.join(" L ")}`);
  }

  return paths;
}

/** Current easing id of a key: named ease, preset id, or "custom". */
function keyframeEasingId(layerId: string, paramName: string, time: number): string {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  const key = track?.keys.find((k) => Math.abs(k.time - time) < 1e-6);
  if (!key) return "linear";
  if (key.curve) return matchEasingPreset(key.curve) ?? "custom";
  return key.ease ?? "linear";
}

// --- Timeline value editing (scrub + click to type) ---

const editingValue = ref<{ layerId: string; paramName: string; text: string } | null>(null);

function isEditingValue(layerId: string, paramName: string): boolean {
  return editingValue.value?.layerId === layerId && editingValue.value?.paramName === paramName;
}

function defStep(def: LayerUniformDef): number {
  return def.step ?? (def.type === "int" ? 1 : 0.01);
}

function clampToDef(def: LayerUniformDef, value: number): number {
  const step = defStep(def);
  let v = Math.round(value / step) * step;
  if (def.type === "int") v = Math.round(v);
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  // Kill float noise from step rounding.
  return Number(v.toFixed(6));
}

/** Keyframe-aware write: keys the playhead when the stopwatch is on, else sets the base value. */
function writeParamValue(layer: LayerInstance, def: LayerUniformDef, value: number) {
  const v = clampToDef(def, value);
  if (trackEnabled(layer.id, def.name)) {
    tracks.value = upsertKeyframe(tracks.value, layer.id, def.name, snapTime(currentTime.value), v);
  } else {
    layer.values[def.name] = v;
  }
}

function onValuePointerDown(layer: LayerInstance, def: LayerUniformDef, e: PointerEvent) {
  if (e.button !== 0) return;

  const startX = e.clientX;
  const startValue = valueAt(layer, def.name, def.default as number);
  let dragging = false;

  function onMove(ev: PointerEvent) {
    if (!dragging && Math.abs(ev.clientX - startX) < 3) return;
    if (!dragging) {
      dragging = true;
      history?.beginGesture();
      document.body.style.cursor = "ew-resize";
    }
    // 1px per step, shift for 10x finer.
    const fine = ev.shiftKey ? 0.1 : 1;
    const next = startValue + (ev.clientX - startX) * defStep(def) * fine;
    writeParamValue(layer, def, next);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
    if (dragging) {
      history?.commitGesture();
    } else {
      openValueEditor(layer, def);
    }
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function openValueEditor(layer: LayerInstance, def: LayerUniformDef) {
  const current = valueAt(layer, def.name, def.default as number);
  editingValue.value = {
    layerId: layer.id,
    paramName: def.name,
    text: String(Number(current.toFixed(4))),
  };
}

function focusValueInput(el: unknown) {
  const input = el as HTMLInputElement | null;
  if (input) {
    input.focus();
    input.select();
  }
}

function commitValueEditor(layer: LayerInstance, def: LayerUniformDef) {
  const editing = editingValue.value;
  if (!editing) return;
  editingValue.value = null;
  const parsed = Number.parseFloat(editing.text.replace(",", "."));
  if (!Number.isFinite(parsed)) return;
  const clamped = clampToDef(def, parsed);
  if (clamped === valueAt(layer, def.name, def.default as number)) return;
  writeParamValue(layer, def, clamped);
  history?.record();
}

function cancelValueEditor() {
  editingValue.value = null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  return `${s.toFixed(2)}s`;
}

// --- Editable composition duration (transport readout) ---

const editingDuration = ref<string | null>(null);

function openDurationEditor() {
  editingDuration.value = String(Number(settings.duration.toFixed(2)));
}

function commitDurationEditor() {
  const text = editingDuration.value;
  if (text === null) return;
  editingDuration.value = null;

  const next = parseCompositionDuration(text);
  if (next === null || Math.abs(next - settings.duration) < 1e-9) return;

  // Same write path as the composition settings panel: mutate + record.
  settings.duration = next;
  if (currentTime.value > next) currentTime.value = next;
  history?.record();

  if (!userZoomed.value) nextTick(applyFitZoom);
}

function cancelDurationEditor() {
  editingDuration.value = null;
}

function scrollTimelineForScrub(e: PointerEvent) {
  const body = bodyScrollRef.value;
  if (!body) return;

  const rect = body.getBoundingClientRect();
  let next = body.scrollLeft;

  if (e.clientX < rect.left) {
    next -= rect.left - e.clientX;
  } else if (e.clientX > rect.right) {
    next += e.clientX - rect.right;
  }

  const playheadPx = timeToX(currentTime.value);
  const viewRight = next + body.clientWidth;
  if (playheadPx < next) {
    next = playheadPx - SCRUB_SCROLL_MARGIN;
  } else if (playheadPx > viewRight) {
    next = playheadPx - body.clientWidth + SCRUB_SCROLL_MARGIN;
  }

  if (Math.abs(next - body.scrollLeft) > 0.5) {
    applyScrollLeft(next);
  }
}

let lastScrubPointer: PointerEvent | null = null;
let scrubScrollRaf = 0;

function scheduleScrubScrollLoop() {
  if (scrubScrollRaf) return;
  scrubScrollRaf = requestAnimationFrame(scrubScrollTick);
}

function scrubScrollTick() {
  scrubScrollRaf = 0;
  if (!scrubbing.value || !lastScrubPointer) return;

  const body = bodyScrollRef.value;
  if (!body) return;

  const rect = body.getBoundingClientRect();
  const e = lastScrubPointer;
  if (e.clientX < rect.left || e.clientX > rect.right) {
    scrubFromEvent(e);
    scrubScrollRaf = requestAnimationFrame(scrubScrollTick);
  }
}

function scrubFromEvent(e: PointerEvent) {
  scrollTimelineForScrub(e);
  currentTime.value = snapTime(timeFromPointerEvent(e));
  scrollTimelineForScrub(e);
}

function onRulerPointerDown(e: PointerEvent) {
  e.preventDefault();
  playing.value = false;
  selectedKeyframes.value = [];
  scrubbing.value = true;
  lastScrubPointer = e;

  const captureEl = rulerScrollRef.value;
  captureEl?.setPointerCapture(e.pointerId);
  scrubFromEvent(e);
  scheduleScrubScrollLoop();

  function onMove(ev: PointerEvent) {
    const events = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [ev];
    lastScrubPointer = events[events.length - 1]!;
    scrubFromEvent(lastScrubPointer);
    scheduleScrubScrollLoop();
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (scrubScrollRaf) {
      cancelAnimationFrame(scrubScrollRaf);
      scrubScrollRaf = 0;
    }
    lastScrubPointer = null;
    try {
      captureEl?.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    scrubbing.value = false;
    displayTime.value = currentTime.value;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function timeFromPointerEvent(e: PointerEvent): number {
  const el = rulerScrollRef.value ?? bodyScrollRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left + el.scrollLeft;
  return xToTime(x);
}

function snapTime(time: number): number {
  const step = 1 / settings.fps;
  return Math.round(time / step) * step;
}

function onKeyframePointerDown(
  layerId: string,
  paramName: string,
  time: number,
  e: PointerEvent,
) {
  if (e.button !== 0) {
    // Right-click: make sure the key is selected so easing applies to it.
    if (!isKeyframeInSelection(selectedKeyframes.value, layerId, paramName, time)) {
      selectedKeyframes.value = [{ layerId, paramName, time }];
      selectedLayerId.value = layerId;
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  playing.value = false;

  const clickedKey: KeyframeSelection = { layerId, paramName, time };
  const wasInSelection = isKeyframeInSelection(
    selectedKeyframes.value,
    layerId,
    paramName,
    time,
  );

  if (e.shiftKey) {
    selectedKeyframes.value = toggleKeyframeInSelection(selectedKeyframes.value, clickedKey);
    selectedLayerId.value = layerId;
    history?.record();
    return;
  }

  if (!wasInSelection) {
    selectedKeyframes.value = [clickedKey];
  }

  selectedLayerId.value = layerId;

  const startX = e.clientX;
  let dragging = false;
  let dragKeys: KeyframeSelection[] = [];
  let lastSnappedTime = snapTime(timeFromPointerEvent(e));

  function onMove(ev: PointerEvent) {
    if (!dragging && Math.abs(ev.clientX - startX) < 3) return;

    if (!dragging) {
      dragging = true;
      history?.beginGesture();
      dragKeys = wasInSelection
        ? selectedKeyframes.value.map((k) => ({ ...k }))
        : [{ ...clickedKey }];
    }

    const pointerTime = snapTime(timeFromPointerEvent(ev));
    const delta = pointerTime - lastSnappedTime;
    if (Math.abs(delta) < 1e-6) return;

    tracks.value = offsetKeyframes(tracks.value, dragKeys, delta);
    selectedKeyframes.value = dragKeys.map((k) => ({
      ...k,
      time: k.time + delta,
    }));
    for (const k of dragKeys) {
      k.time += delta;
    }
    lastSnappedTime = pointerTime;
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (dragging) history?.commitGesture();
    else history?.record();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Clear layer and keyframe selection (clicks on empty space). */
function clearSelection() {
  selectedLayerId.value = null;
  selectedLayerIds.value = new Set();
  selectionAnchorId.value = null;
  selectedKeyframes.value = [];
}

function onTracksMarqueePointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  playing.value = false;

  const start = pointInTracksContent(e);
  const addToSelection = e.shiftKey;
  const baseSelection = addToSelection ? [...selectedKeyframes.value] : [];
  if (!addToSelection) {
    selectedKeyframes.value = [];
  }

  let finalRect: MarqueeRect = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
  marquee.value = { ...finalRect };
  let dragging = false;

  function applyMarqueeSelection(rect: MarqueeRect) {
    const hits = hitsInMarquee(rect);
    if (addToSelection) {
      let next = [...baseSelection];
      for (const hit of hits) {
        if (!isKeyframeInSelection(next, hit.layerId, hit.paramName, hit.time)) {
          next.push(hit);
        }
      }
      selectedKeyframes.value = next;
    } else {
      selectedKeyframes.value = hits;
    }
    if (hits.length > 0) {
      selectedLayerId.value = hits[0]!.layerId;
    }
  }

  function onMove(ev: PointerEvent) {
    const pt = pointInTracksContent(ev);
    if (!dragging && Math.hypot(pt.x - start.x, pt.y - start.y) < 3) return;
    dragging = true;
    finalRect = { x0: start.x, y0: start.y, x1: pt.x, y1: pt.y };
    marquee.value = { ...finalRect };
    applyMarqueeSelection(finalRect);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);

    if (dragging) {
      history?.record();
    } else if (!addToSelection) {
      // Plain click on empty tracks space: clear the whole selection.
      selectedLayerId.value = null;
      selectedLayerIds.value = new Set();
      selectionAnchorId.value = null;
    }
    marquee.value = null;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function isKeyframeSelected(layerId: string, paramName: string, time: number): boolean {
  return isKeyframeInSelection(selectedKeyframes.value, layerId, paramName, time);
}

function isKeyframeAtPlayhead(time: number): boolean {
  return Math.abs(time - currentTime.value) < 1e-6;
}

function isKeyedAtPlayhead(layerId: string, paramName: string): boolean {
  const track = findPropertyTrack(tracks.value, layerId, paramName);
  return hasKeyframeAt(track, currentTime.value);
}

function keyLeft(time: number): string {
  return `${timeToX(time)}px`;
}

useEventListener(bodyScrollRef, "wheel", onTimelineWheel, { passive: false });
useEventListener(rulerScrollRef, "wheel", onTimelineWheel, { passive: false });
useEventListener(labelsScrollRef, "wheel", onTimelineWheel, { passive: false });

const { register: registerKeyboard } = useEditorKeyboard();

registerKeyboard({
  id: "timeline:rename-layer",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    if (selectedKeyframes.value.length > 0 || !selectedLayerId.value) return false;
    startRenameSelectedLayer();
    return true;
  },
});

registerKeyboard({
  id: "timeline:select-all-layers",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return false;
    selectAllLayers();
    return true;
  },
});

registerKeyboard({
  id: "timeline:precompose",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
    if (e.key.toLowerCase() !== "g") return false;
    const ids =
      selectedLayerIds.value.size > 0
        ? layers.value.filter((l) => selectedLayerIds.value.has(l.id)).map((l) => l.id)
        : selectedLayerId.value
          ? [selectedLayerId.value]
          : [];
    if (ids.length === 0) return false;
    emit("precompose", ids);
    return true;
  },
});

registerKeyboard({
  id: "timeline:reveal-keyframes",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (e.key.toLowerCase() !== "u" || e.metaKey || e.ctrlKey || e.altKey) return false;
    toggleRevealKeyframes();
    return true;
  },
});

registerKeyboard({
  id: "timeline:zoom-to-fit",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (e.key.toLowerCase() !== "z" || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) {
      return false;
    }
    fitTimeline();
    return true;
  },
});

/** AE-style property reveal shortcuts on the selected layer(s).
 * 3D-only params are filtered per layer below, so 2D layers keep the classic set. */
const PROPERTY_SHORTCUT_PARAMS: Record<string, string[]> = {
  p: ["layerPositionX", "layerPositionY", "layerPositionZ"],
  s: ["layerScale"],
  r: ["layerRotation", "layerRotationX", "layerRotationY"],
  t: ["layerOpacity"],
};

registerKeyboard({
  id: "timeline:reveal-transform-property",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    const params = PROPERTY_SHORTCUT_PARAMS[e.key.toLowerCase()];
    if (!params) return false;
    return toggleUniversalPropertyReveal(params);
  },
});

function toggleUniversalPropertyReveal(params: string[]): boolean {
  const ids = layersForKeyframeRevealCommand();
  if (ids.length === 0) return false;

  // Only params that exist on each layer (effects expose opacity only).
  const targets: Array<[string, string]> = [];
  for (const id of ids) {
    const layer = layers.value.find((l) => l.id === id);
    if (!layer) continue;
    const names = new Set(universalUniformsFor(layer).map((d) => d.name));
    for (const param of params) {
      if (names.has(param)) targets.push([id, param]);
    }
  }
  if (targets.length === 0) return false;

  const allShowing = targets.every(
    ([id, param]) =>
      isExpanded(id) ||
      (isKeyframesRevealed(id) && isPinnedInUView(id, param)),
  );

  const nextPins = new Set(pinnedUViewProperties.value);
  const nextRevealed = new Set(keyframesRevealed.value);

  if (allShowing) {
    for (const [id, param] of targets) nextPins.delete(uViewPropertyKey(id, param));
  } else {
    for (const [id, param] of targets) {
      nextPins.add(uViewPropertyKey(id, param));
      if (!isExpanded(id)) nextRevealed.add(id);
    }
  }

  pinnedUViewProperties.value = nextPins;
  keyframesRevealed.value = nextRevealed;
  return true;
}

// --- Layer in/out bar (visibility window) ---

type LayerBarDragMode = "move" | "in" | "out";

function layerInPoint(layer: LayerInstance): number {
  return layer.timing?.in ?? 0;
}

function layerOutPoint(layer: LayerInstance): number {
  return layer.timing?.out ?? settings.duration;
}

function layerBarStyle(layer: LayerInstance) {
  const left = layerInPoint(layer) * pxPerSecond.value;
  const width = Math.max(
    pxPerFrame.value,
    (layerOutPoint(layer) - layerInPoint(layer)) * pxPerSecond.value,
  );
  return { left: `${left}px`, width: `${width}px` };
}

/**
 * Persist the window; the exact full-width window is stored as "no timing".
 * The window may overhang the composition on either side (in < 0 or
 * out > duration); content outside [0, duration] simply never plays.
 */
function writeLayerTiming(layer: LayerInstance, inPoint: number, outPoint: number) {
  const frame = 1 / settings.fps;
  const nextIn = inPoint;
  const nextOut = Math.max(outPoint, nextIn + frame);
  const eps = 1e-6;

  if (Math.abs(nextIn) < eps && Math.abs(nextOut - settings.duration) < eps) {
    if (layer.timing) layer.timing = undefined;
    return;
  }
  layer.timing = {
    ...(Math.abs(nextIn) > eps ? { in: nextIn } : {}),
    ...(Math.abs(nextOut - settings.duration) > eps ? { out: nextOut } : {}),
  };
}

function onLayerBarPointerDown(layer: LayerInstance, mode: LayerBarDragMode, e: PointerEvent) {
  if (e.button !== 0) return;
  if (!selectedLayerIds.value.has(layer.id)) {
    selectedLayerId.value = layer.id;
    selectedLayerIds.value = new Set([layer.id]);
    selectionAnchorId.value = layer.id;
  }

  const startX = e.clientX;
  const startIn = layerInPoint(layer);
  const startOut = layerOutPoint(layer);
  const frame = 1 / settings.fps;
  let dragging = false;

  // Moving the bar shifts the layer in time: keyframes travel with it.
  const startKeyTimes = new Map(
    tracks.value
      .filter((t) => t.layerId === layer.id)
      .map((t) => [t.paramName, t.keys.map((k) => k.time)]),
  );

  function shiftLayerKeyframes(delta: number) {
    if (startKeyTimes.size === 0) return;
    tracks.value = tracks.value.map((track) => {
      if (track.layerId !== layer.id) return track;
      const startTimes = startKeyTimes.get(track.paramName);
      if (!startTimes) return track;
      return {
        ...track,
        keys: track.keys.map((key, i) => ({ ...key, time: startTimes[i]! + delta })),
      };
    });
  }

  function onMove(ev: PointerEvent) {
    if (!dragging && Math.abs(ev.clientX - startX) < 3) return;
    if (!dragging) {
      dragging = true;
      history?.beginGesture();
    }

    const deltaTime = (ev.clientX - startX) / pxPerSecond.value;
    if (mode === "move") {
      // The bar may overhang either end as long as a grabbable slice stays inside.
      const length = startOut - startIn;
      const nextIn = clampBarMoveIn(
        snapTime(startIn + deltaTime),
        length,
        settings.duration,
      );
      writeLayerTiming(layer, nextIn, nextIn + length);
      shiftLayerKeyframes(nextIn - startIn);
    } else if (mode === "in") {
      // Trim stops at 0 as before, but keeps an existing left overhang reachable.
      const nextIn = Math.max(
        Math.min(0, startIn),
        Math.min(snapTime(startIn + deltaTime), startOut - frame, settings.duration - frame),
      );
      writeLayerTiming(layer, nextIn, startOut);
    } else {
      // The out point may pass the composition end; that tail never plays.
      const nextOut = Math.max(snapTime(startOut + deltaTime), startIn + frame, frame);
      writeLayerTiming(layer, startIn, nextOut);
    }
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (dragging) history?.commitGesture();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function resetLayerTiming(layer: LayerInstance) {
  if (!layer.timing) return;
  layer.timing = undefined;
  history?.record();
}

function togglePlay() {
  playing.value = !playing.value;
}

function toggleLayerEnabled(layer: LayerInstance) {
  const nextEnabled = !layer.enabled;
  const multi = selectedLayerIds.value.size > 1 && selectedLayerIds.value.has(layer.id);
  const applyTo = multi
    ? layers.value.filter((l) => selectedLayerIds.value.has(l.id))
    : [layer];

  for (const target of applyTo) {
    target.enabled = nextEnabled;
  }
  history?.record();
}

/** AE-style 3D switch — same mutation + history path as toggleLayerEnabled. */
function toggleLayer3D(layer: LayerInstance) {
  const next = !layer.is3D;
  const multi = selectedLayerIds.value.size > 1 && selectedLayerIds.value.has(layer.id);
  const applyTo = multi
    ? layers.value.filter((l) => selectedLayerIds.value.has(l.id))
    : [layer];

  for (const target of applyTo) {
    if (supports3D(target)) target.is3D = next;
  }
  history?.record();
}

/** Contiguous 3D runs in the visible top→bottom order (disabled layers are neutral). */
const threeDRuns = computed(() => find3DRuns(layers.value));

/** Bracket segment for a layer row index, or null when the layer is not in a 3D run. */
function threeDBracket(index: number): { first: boolean; last: boolean } | null {
  const run = threeDRuns.value.find((r) => index >= r.start && index < r.end);
  if (!run) return null;
  return { first: index === run.start, last: index === run.end - 1 };
}

function isLayerSelected(id: string): boolean {
  return selectedLayerIds.value.has(id);
}

function layerRowBlockRole(index: number) {
  return layerHeaderBlockRole(index, selectedLayerIndices(), [...draggingIndices.value]);
}

function selectLayer(id: string, e?: MouseEvent) {
  const index = layerIndex(id);
  if (index === -1) return;

  if (e?.shiftKey) {
    const anchorId = selectionAnchorId.value ?? selectedLayerId.value;
    const anchorIndex = anchorId ? layerIndex(anchorId) : index;
    const lo = Math.min(anchorIndex, index);
    const hi = Math.max(anchorIndex, index);
    selectedLayerIds.value = new Set(layers.value.slice(lo, hi + 1).map((l) => l.id));
  } else if (e?.metaKey || e?.ctrlKey) {
    const next = new Set(selectedLayerIds.value);
    const adding = !next.has(id);
    if (adding) next.add(id);
    else next.delete(id);
    selectedLayerIds.value = next;
    selectionAnchorId.value = id;
    selectedKeyframes.value = [];
    if (next.size === 0) {
      selectedLayerId.value = null;
      history?.record();
      return;
    }
    if (adding) {
      selectedLayerId.value = id;
    } else {
      selectedLayerId.value =
        selectedLayerId.value && next.has(selectedLayerId.value)
          ? selectedLayerId.value
          : [...next][0]!;
    }
    history?.record();
    return;
  } else {
    selectedLayerIds.value = new Set([id]);
    selectionAnchorId.value = id;
  }

  selectedLayerId.value = id;
  selectedKeyframes.value = [];
  history?.record();
}

function selectAllLayers() {
  if (layers.value.length === 0) return;
  selectedLayerIds.value = new Set(layers.value.map((l) => l.id));
  if (!selectedLayerId.value || !selectedLayerIds.value.has(selectedLayerId.value)) {
    selectedLayerId.value = layers.value[0]!.id;
  }
  selectionAnchorId.value = selectedLayerId.value;
  selectedKeyframes.value = [];
  history?.record();
}
</script>

<template>
  <div class="flex h-full min-h-0 select-none flex-col bg-layer-1">
    <!-- Transport -->
    <div class="flex shrink-0 items-center gap-2 border-b border-neutral px-2 py-1.5">
      <UiButton variant="ghost" size="sm" :icon-left="playing ? PauseIcon : PlayIcon" @click="togglePlay" />
      <span class="font-mono text-copy-xs text-neutral-strong">{{ formatTime(currentTime) }}</span>
      <input
        v-if="editingDuration !== null"
        :ref="focusValueInput"
        v-model="editingDuration"
        class="w-14 shrink-0 rounded-sm bg-control px-1 text-right font-mono text-copy-xs text-neutral-strong outline-none ring-1 ring-accent/60"
        spellcheck="false"
        title="Composition duration (seconds)"
        @keydown.enter.stop.prevent="commitDurationEditor"
        @keydown.esc.stop.prevent="cancelDurationEditor"
        @keydown.stop
        @blur="commitDurationEditor"
        @pointerdown.stop
      />
      <span
        v-else
        class="cursor-text rounded-sm px-1 text-copy-xs text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
        title="Click to edit composition duration"
        @click="openDurationEditor"
      >/ {{ formatTime(settings.duration) }}</span>
      <div class="ml-auto flex items-center gap-0.5">
        <UiButton variant="ghost" size="sm" title="Fit composition to view (⇧Z)" @click="fitTimeline">Fit</UiButton>
        <UiButton variant="ghost" size="sm" :icon-left="MinusIcon" title="Zoom out (⌥ scroll)" @click="zoomOut" />
        <span class="min-w-10 text-center font-mono text-copy-xs text-neutral-subtle">{{ zoomPercent }}%</span>
        <UiButton variant="ghost" size="sm" :icon-left="PlusIcon" title="Zoom in (⌥ scroll)" @click="zoomIn" />
      </div>
      <span class="text-copy-xs text-neutral-subtle">{{ settings.fps }} fps</span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <!-- Header row -->
      <div class="flex shrink-0 min-w-0">
        <div
          class="h-7 shrink-0 border-b border-r border-neutral bg-layer-2"
          :style="{ width: `${labelWidth}px` }"
        />

        <div
          ref="rulerScrollRef"
          class="h-7 min-w-0 flex-1 cursor-ew-resize touch-none overflow-x-auto overflow-y-hidden border-b border-neutral bg-layer-2 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          @scroll="onRulerScroll"
          @pointerdown="onRulerPointerDown"
        >
          <div class="relative h-full" :style="{ width: `${timelineWidth}px` }">
            <template v-for="mark in rulerMarks" :key="`${mark.kind}-${mark.time}`">
              <div
                class="absolute top-0 flex h-full flex-col justify-end pb-0.5"
                :style="{ left: `${timeToX(mark.time)}px` }"
              >
                <span
                  v-if="mark.kind === 'major'"
                  class="pl-1 font-mono text-[10px] text-neutral-subtle"
                >
                  {{ formatRulerLabel(mark.time) }}
                </span>
                <div
                  class="w-px bg-neutral/60"
                  :class="mark.kind === 'frame' ? 'opacity-50' : mark.kind === 'mid' ? 'opacity-75' : ''"
                  :style="{ height: rulerMarkHeight(mark.kind) }"
                />
              </div>
            </template>
            <div
              class="pointer-events-none absolute bottom-0 z-20 -translate-x-1/2"
              :style="{ left: `${playheadX}px` }"
            >
              <svg
                width="10"
                height="9"
                viewBox="0 0 10 9"
                fill="none"
                aria-hidden="true"
                class="block"
              >
                <path :d="PLAYHEAD_HEAD" class="fill-playhead" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Body row -->
      <div class="flex min-h-0 min-w-0 flex-1">
        <!-- Labels: fixed width, no scrollbar, follows vertical scroll -->
        <div
          ref="labelsScrollRef"
          class="relative shrink-0 overflow-hidden border-r border-neutral bg-layer-1"
          :style="{ width: `${labelWidth}px` }"
          @dragover="onCompDragOver"
          @dragleave="onCompDragLeave"
          @drop="onCompDrop"
        >
          <!-- Comp-drop insertion line (absolute children scroll with content) -->
          <div
            v-if="compDropIndex !== null"
            class="pointer-events-none absolute inset-x-1 z-40 h-0.5 -translate-y-1/2 rounded-full bg-accent"
            :style="{ top: `${compDropY}px` }"
          />
          <div ref="layerListRef" class="min-h-full" @click.self="clearSelection">
            <div
              v-for="(layer, i) in layers"
              :key="layer.id"
              class="layer-group relative"
              :class="[
                !layer.enabled && 'opacity-50',
                draggingIndices.has(i) && 'z-50 scale-[1.01] shadow-lg',
              ]"
            >
              <UiHover
                solid
                :active="isLayerSelected(layer.id) || draggingIndices.has(i)"
                :block-role="layerRowBlockRole(i)"
                class-name="bg-layer-1 group-hover/h:bg-control group-has-focus-visible/h:bg-control group-focus-within/h:bg-control"
                active-class-name="bg-control"
                full-width
              >
                <div
                  data-drag-handle
                  class="flex h-7 w-full cursor-default items-center gap-0.5 px-1 select-none"
                  :title="layer.type === 'composition' ? 'Double-click to open the composition' : undefined"
                  @click="selectLayer(layer.id, $event)"
                  @dblclick.capture="onLayerRowDblClick(layer, $event)"
                >
                  <button
                    type="button"
                    data-drag-exclude
                    class="flex size-5 shrink-0 items-center justify-center text-neutral-subtle outline-none"
                    @click.stop="toggleExpand(layer.id)"
                  >
                    <ChevronRightIcon
                      class="size-3 transition-transform"
                      :class="isLayerChevronOpen(layer.id) && 'rotate-90'"
                    />
                  </button>
                  <component
                    :is="layerTypeIcon(layer)"
                    v-if="layerTypeIcon(layer)"
                    class="size-3 shrink-0 text-neutral-subtle"
                    aria-hidden="true"
                  />
                  <UiEditableText
                    :ref="(el) => bindLayerNameRef(layer.id, el)"
                    :model-value="layerLabel(layer)"
                    fill
                    data-drag-exclude
                    class="min-w-0 flex-1 px-1 text-copy-xs"
                    :class="
                      isLayerSelected(layer.id)
                        ? 'text-neutral-strong'
                        : 'text-neutral-subtle group-hover/h:text-neutral-strong group-data-[active=true]/h:text-neutral-strong group-focus-within/h:text-neutral-strong'
                    "
                    @update:model-value="setLayerName(layer, $event)"
                  />
                  <span
                    v-if="
                      enabledTracksForLayer(layer.id).length &&
                      !isLayerChevronOpen(layer.id)
                    "
                    class="shrink-0 text-copy-xs text-neutral-subtle group-hover/h:opacity-0 group-data-[active=true]/h:opacity-0 group-focus-within/h:opacity-0"
                  >
                    {{ enabledTracksForLayer(layer.id).length }}
                  </span>
                  <!-- 3D switch. Members of a contiguous 3D run share a connected
                       accent chip behind their cubes (one depth-sorted space). -->
                  <span
                    v-if="supports3D(layer) || isLayer3D(layer)"
                    data-drag-exclude
                    class="flex h-full shrink-0 items-stretch self-stretch"
                    :class="threeDBracket(i) && 'bg-accent/15'"
                    :style="
                      threeDBracket(i)
                        ? {
                            borderTopLeftRadius: threeDBracket(i)!.first ? '6px' : '0',
                            borderTopRightRadius: threeDBracket(i)!.first ? '6px' : '0',
                            borderBottomLeftRadius: threeDBracket(i)!.last ? '6px' : '0',
                            borderBottomRightRadius: threeDBracket(i)!.last ? '6px' : '0',
                          }
                        : undefined
                    "
                  >
                    <button
                      v-if="supports3D(layer)"
                      type="button"
                      title="3D layer"
                      class="flex w-6 shrink-0 cursor-pointer items-center justify-center outline-none transition-colors duration-100"
                      :class="
                        layer.is3D
                          ? 'text-accent'
                          : 'text-neutral-subtle opacity-0 hover:text-neutral-strong group-hover/h:opacity-100 group-data-[active=true]/h:opacity-100 group-focus-within/h:opacity-100'
                      "
                      @click.stop="toggleLayer3D(layer)"
                    >
                      <component
                        :is="layer.is3D ? CubeIcon : CubeTransparentIcon"
                        class="size-4 shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                    <span
                      v-else
                      title="Always a 3D layer"
                      class="flex w-6 shrink-0 cursor-default items-center justify-center text-accent"
                    >
                      <CubeIcon class="size-4 shrink-0" aria-hidden="true" />
                    </span>
                  </span>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    data-drag-exclude
                    class="!size-6 shrink-0"
                    :class="
                      layer.enabled &&
                      'opacity-0 group-hover/h:opacity-100 group-data-[active=true]/h:opacity-100 group-focus-within/h:opacity-100'
                    "
                    :icon-left="layer.enabled ? EyeIcon : EyeSlashIcon"
                    :title="layer.enabled ? 'Hide layer' : 'Show layer'"
                    @click.stop="toggleLayerEnabled(layer)"
                  />
                </div>
              </UiHover>

              <template v-for="def in visibleProperties(layer)" :key="`${layer.id}-${def.name}`">
                <div
                  v-if="showPropertyRow(layer, def.name)"
                  class="flex h-6 w-full cursor-default items-center gap-0.5 border-t border-neutral/50 px-1 select-none"
                >
                  <div class="flex size-5 shrink-0 items-center justify-center">
                    <UiKeyframeButton
                      v-if="trackEnabled(layer.id, def.name)"
                      data-drag-exclude
                      :active="isKeyedAtPlayhead(layer.id, def.name)"
                      @toggle="emit('toggle-keyframe', layer.id, def.name)"
                    />
                  </div>
                  <div class="flex min-w-0 flex-1 items-center gap-0.5 px-1">
                    <UiStopwatchButton
                      data-drag-exclude
                      :active="trackEnabled(layer.id, def.name)"
                      @toggle="emit('toggle-stopwatch', layer.id, def.name)"
                    />
                    <span class="min-w-0 flex-1 truncate text-copy-xs text-neutral-subtle">
                      {{ def.label }}
                    </span>
                  </div>
                  <input
                    v-if="isEditingValue(layer.id, def.name)"
                    :ref="focusValueInput"
                    v-model="editingValue!.text"
                    data-drag-exclude
                    class="w-16 shrink-0 rounded-sm bg-control px-1 text-right font-mono text-copy-xs text-neutral-strong outline-none ring-1 ring-accent/60"
                    spellcheck="false"
                    @keydown.enter.stop.prevent="commitValueEditor(layer, def)"
                    @keydown.esc.stop.prevent="cancelValueEditor"
                    @keydown.stop
                    @blur="commitValueEditor(layer, def)"
                    @pointerdown.stop
                  />
                  <span
                    v-else
                    data-drag-exclude
                    class="shrink-0 cursor-ew-resize rounded-sm px-1 font-mono text-copy-xs text-neutral-subtle transition-colors hover:bg-control hover:text-neutral-strong"
                    title="Drag to scrub, click to type (⇧ fine)"
                    @pointerdown.stop.prevent="onValuePointerDown(layer, def, $event)"
                  >
                    {{ valueAt(layer, def.name, def.default as number).toFixed(2) }}
                  </span>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Tracks: horizontal + vertical scroll -->
        <div
          ref="bodyScrollRef"
          class="min-h-0 min-w-0 flex-1 touch-none overflow-auto select-none"
          @scroll="onBodyScroll"
        >
          <div
            ref="tracksContentRef"
            class="relative min-h-full shrink-0 touch-none select-none"
            :style="{ width: `${timelineWidth}px`, ...frameGridStyle }"
            @pointerdown="onTracksMarqueePointerDown"
          >
            <div class="min-h-full">
              <div
                v-for="layer in layers"
                :key="`t-${layer.id}`"
                class="layer-group"
                :class="!layer.enabled && 'opacity-50'"
              >
                <div class="relative h-7 border-b border-neutral/40 bg-layer-1/50">
                  <div
                    class="group/bar absolute inset-y-[5px] cursor-grab rounded-[5px] ring-1 ring-inset transition-colors"
                    :class="selectedLayerIds.has(layer.id)
                      ? 'bg-accent/35 ring-accent/60 hover:bg-accent/45'
                      : 'bg-neutral-700/70 ring-white/10 hover:bg-neutral-600/70'"
                    :style="layerBarStyle(layer)"
                    :title="`${layerInPoint(layer).toFixed(2)}s – ${layerOutPoint(layer).toFixed(2)}s (double-click to reset)`"
                    @pointerdown.stop.prevent="onLayerBarPointerDown(layer, 'move', $event)"
                    @dblclick.stop="resetLayerTiming(layer)"
                  >
                    <div
                      class="absolute inset-y-0 left-0 flex w-2 cursor-ew-resize items-center justify-center rounded-l-[5px] bg-white/10 opacity-0 transition-opacity group-hover/bar:opacity-100"
                      @pointerdown.stop.prevent="onLayerBarPointerDown(layer, 'in', $event)"
                    >
                      <div class="h-3 w-0.5 rounded-full bg-white/60" />
                    </div>
                    <div
                      class="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center rounded-r-[5px] bg-white/10 opacity-0 transition-opacity group-hover/bar:opacity-100"
                      @pointerdown.stop.prevent="onLayerBarPointerDown(layer, 'out', $event)"
                    >
                      <div class="h-3 w-0.5 rounded-full bg-white/60" />
                    </div>
                  </div>
                </div>

                <template v-for="def in visibleProperties(layer)" :key="`t-${layer.id}-${def.name}`">
                  <div
                    v-if="showPropertyRow(layer, def.name)"
                    class="relative h-6 border-b border-neutral/30 select-none"
                  >
                    <svg
                      class="pointer-events-none absolute inset-0 size-full"
                      aria-hidden="true"
                    >
                      <path
                        v-for="(seg, si) in segmentPaths(layer.id, def.name)"
                        :key="`s-${si}`"
                        :d="seg"
                        fill="none"
                        class="stroke-accent/40"
                        stroke-width="1.5"
                      />
                    </svg>
                    <UiContextMenu
                      v-for="key in findPropertyTrack(tracks, layer.id, def.name)?.keys ?? []"
                      :key="`${layer.id}-${def.name}-${key.time}`"
                    >
                      <button
                        type="button"
                        class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-default border-0 bg-transparent p-0 outline-none"
                        :style="{ left: keyLeft(key.time) }"
                        :title="`${def.label} @ ${key.time.toFixed(2)}s`"
                        @pointerdown.stop="onKeyframePointerDown(layer.id, def.name, key.time, $event)"
                      >
                        <UiKeyframeDiamond
                          class="size-full"
                          :selected="isKeyframeSelected(layer.id, def.name, key.time)"
                          :at-playhead="isKeyframeAtPlayhead(key.time)"
                          :easing="keyframeShape(key)"
                        />
                      </button>
                      <template #menu>
                        <UiContextMenuItem
                          v-for="named in NAMED_EASINGS"
                          :key="named.id"
                          @click="applyKeyframeEasing(layer.id, def.name, key.time, named.id)"
                        >
                          <span class="flex-1">{{ named.label }}</span>
                          <span v-if="keyframeEasingId(layer.id, def.name, key.time) === named.id">✓</span>
                        </UiContextMenuItem>
                        <UiContextMenuSeparator />
                        <UiContextMenuItem
                          v-for="preset in EASING_PRESETS"
                          :key="preset.id"
                          @click="applyKeyframeEasing(layer.id, def.name, key.time, preset.curve)"
                        >
                          <span class="flex-1">{{ preset.label }}</span>
                          <span v-if="keyframeEasingId(layer.id, def.name, key.time) === preset.id">✓</span>
                        </UiContextMenuItem>
                      </template>
                    </UiContextMenu>
                  </div>
                </template>
              </div>
            </div>

            <div
              v-if="marquee"
              class="pointer-events-none absolute z-30 border border-accent/80 bg-accent/10"
              :style="marqueeStyle"
            />

            <div
              class="pointer-events-none absolute -top-px bottom-0 z-10 w-px -translate-x-1/2 bg-playhead"
              :style="{ left: `${playheadX}px` }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bg-playhead {
  background-color: #2ca2ff;
}
.fill-playhead {
  fill: #2ca2ff;
}
</style>
