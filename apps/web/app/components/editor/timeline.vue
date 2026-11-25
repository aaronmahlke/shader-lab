<script setup lang="ts">
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  MagnifyingGlassIcon,
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
  CursorArrowRaysIcon,
} from "@heroicons/vue/16/solid";
import { useEventListener } from "@vueuse/core";
import {
  EditorKeyboardPriority,
  useEditorKeyboard,
} from "~/composables/use-editor-keyboard";
import {
  LAYER_TEMPLATES,
  ModulationEngine,
  linksFor,
  linkTrackLayerId,
  removeKeyframeAt,
  setTrackEnabled,
  sourceTrackLayerId,
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
  type EnvelopeSource,
  type LFOSource,
  type ModulationAssignment,
  type KeyframeEasing,
  type LayerInstance,
  type LayerUniformDef,
  type PropertyTrack,
} from "@shader-lab/core";
import { dataTransferHasComp, readCompDragPayload } from "#shared/editor/comp-drag";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";
import { POSITION_GROUP, positionAxes } from "#shared/editor/position-group";
import {
  clampGroupBarMoveDelta,
  fitPxPerSecond,
  parseCompositionDuration,
} from "#shared/editor/timeline-window";
import {
  collectBarSnapTargets,
  snapBarMoveDelta,
  snapEdgeTime,
  TIMELINE_GUIDE_COLOR,
  TIMELINE_SNAP_RELEASE_PX,
  TIMELINE_SNAP_THRESHOLD_PX,
} from "#shared/editor/timeline-snapping";
import UIcon from "../UIcon.vue";
import {
  isKeyframeInSelection,
  toggleKeyframeInSelection,
} from "#shared/editor/keyframe-selection";

/** Lucide magnet as a component so UiButton can take it as icon-left. */
const MagnetIcon = () => h(UIcon, { name: "i-lucide-magnet" });
/** Lucide "wind" for the motion blur switch (AE's motion blur toggle). */
const MotionBlurIcon = () => h(UIcon, { name: "i-lucide-wind" });

function toggleMotionBlur() {
  settings.motionBlur = !settings.motionBlur;
  history?.record();
}

type Emits = {
  "toggle-stopwatch": [layerId: string, paramName: string];
  "toggle-keyframe": [layerId: string, paramName: string];
  "duplicate-layer": [id: string];
  "remove-layer": [id: string];
  /** AE-style pre-compose: group the given layers into a new composition. */
  precompose: [layerIds: string[]];
  /** A comp was dragged in from the project panel; the page owns the insert. */
  "insert-composition": [payload: { compId: string; name: string; index: number }];
  "open-comp": [layer: LayerInstance, newTab: boolean];
  /** Parent column changed (AE Parent & Link). */
  "set-parent": [layerId: string, parentId: string | null];
  /** Modulator pill clicked: open that LFO/envelope in the inspector. */
  "select-modulator": [sourceId: string];
};

const expanded = ref<Set<string>>(new Set());
/** Layer ids showing keyed properties while row is collapsed (U key). */
const keyframesRevealed = ref<Set<string>>(new Set());
/** U-view rows that stay visible after stopwatch off until layer collapses. */
const pinnedUViewProperties = ref<Set<string>>(new Set());
const labelWidth = 360;

const PLAYHEAD_HEAD = "M0 0H10L5 9Z";

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
const snapping = defineModel<boolean>("snapping", { default: true });

const { settings, lfos = [], envelopes = [], assignments = [], usedRange = null } = defineProps<{
  settings: CompositionSettings;
  /** Drilled into a nested comp: the range (comp time) the parent shows. */
  usedRange?: { start: number; end: number } | null;
  lfos?: LFOSource[];
  envelopes?: EnvelopeSource[];
  assignments?: ModulationAssignment[];
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

  const pushRowHits = (row: TimelineRow) => {
    const centerY = y + PROP_ROW_H / 2;
    for (const axis of axesFor(row.owner, row.def.name)) {
      const track = findPropertyTrack(tracks.value, row.owner, axis);
      for (const key of track?.keys ?? []) {
        hits.push({
          layerId: row.owner,
          paramName: axis,
          time: key.time,
          x: timeToX(key.time),
          y: centerY,
        });
      }
    }
  };

  for (const layer of layers.value) {
    y += LAYER_ROW_H;
    for (const row of rowsForLayer(layer)) {
      pushRowHits(row);
      y += PROP_ROW_H;
    }
  }

  for (const item of modulatorGroupLayout()) {
    if (item.row) pushRowHits(item.row);
    y += item.height;
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
  effector: CursorArrowRaysIcon,
  cloner: Squares2X2Icon,
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
  // ⌘/Ctrl double-click: own tab; plain: drill in (breadcrumb + synced time).
  emit("open-comp", layer, e.metaKey || e.ctrlKey);
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

/** Every keyframeable param (position as separate X/Y/Z). */
function rawKeyframeableUniforms(layer: LayerInstance) {
  const template = LAYER_TEMPLATES[layer.type];
  if (!template) return [];
  return [
    ...universalUniformsFor(layer).filter(isKeyframeableUniform),
    ...template.uniforms.filter(isKeyframeableUniform),
  ];
}

const POSITION_GROUP_DEF: LayerUniformDef = { name: POSITION_GROUP, label: "Position", type: "float", default: 0 };

/** Timeline properties: X/Y/Z collapse into one linked Position unless separated. */
function keyframeableUniforms(layer: LayerInstance) {
  const raw = rawKeyframeableUniforms(layer);
  const axes = new Set(positionAxes(layer));
  if (axes.size === 0) return raw;
  const out: LayerUniformDef[] = [];
  for (const def of raw) {
    if (!axes.has(def.name)) out.push(def);
    else if (!out.includes(POSITION_GROUP_DEF)) out.push(POSITION_GROUP_DEF);
  }
  return out;
}

/** Track params behind a row param (the linked Position row → its axes). */
function axesFor(owner: string, paramName: string): string[] {
  if (paramName !== POSITION_GROUP) return [paramName];
  const layer = layers.value.find((l) => l.id === owner);
  return layer ? positionAxes(layer) : [];
}


/** Keys of a row: the union over its axes (one diamond per time). */
function rowKeys(owner: string, paramName: string): Keyframe[] {
  const axes = axesFor(owner, paramName);
  if (axes.length === 1) return findPropertyTrack(tracks.value, owner, axes[0]!)?.keys ?? [];
  const byTime = new Map<number, Keyframe>();
  for (const axis of axes) {
    for (const key of findPropertyTrack(tracks.value, owner, axis)?.keys ?? []) {
      const t = Math.round(key.time * 1e6) / 1e6;
      if (!byTime.has(t)) byTime.set(t, key);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Axis keys at a time, as selection refs. */
function axisRefsAt(owner: string, paramName: string, time: number): KeyframeSelection[] {
  return axesFor(owner, paramName)
    .filter((axis) => hasKeyframeAt(findPropertyTrack(tracks.value, owner, axis), time))
    .map((axis) => ({ layerId: owner, paramName: axis, time }));
}

/** Position rows folded open into per-axis rows (layer ids). */
const axisRowsOpen = ref<Set<string>>(new Set());

function toggleAxisRows(layerId: string) {
  const next = new Set(axisRowsOpen.value);
  if (next.has(layerId)) next.delete(layerId);
  else next.add(layerId);
  axisRowsOpen.value = next;
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
  return (
    trackEnabled(layer.id, paramName) ||
    isModulated(layer.id, paramName) ||
    isPinnedInUView(layer.id, paramName)
  );
}

function trackEnabled(layerId: string, paramName: string): boolean {
  return axesFor(layerId, paramName).some((axis) =>
    isPropertyTrackActive(findPropertyTrack(tracks.value, layerId, axis)),
  );
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
        if (trackEnabled(layer.id, def.name)) {
          nextPins.add(uViewPropertyKey(layer.id, def.name));
        }
      }

      const hasRows = keyframeableUniforms(layer).some((def) => {
        return (
          trackEnabled(layer.id, def.name) ||
          isModulated(layer.id, def.name) ||
          nextPins.has(uViewPropertyKey(layer.id, def.name))
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

// --- Modulators (LFOs / envelopes) ---

type ModSource = { id: string; label: string; color: string };

const modSources = computed(
  () => new Map<string, ModSource>([...lfos, ...envelopes].map((s) => [s.id, s])),
);

function propertyLinks(layerId: string, paramName: string): ModulationAssignment[] {
  return axesFor(layerId, paramName)
    .flatMap((axis) => linksFor(assignments, layerId, axis))
    .filter((a) => modSources.value.has(a.sourceId));
}

function isModulated(layerId: string, paramName: string): boolean {
  return propertyLinks(layerId, paramName).length > 0;
}

function uniqueSources(links: ModulationAssignment[]): ModSource[] {
  const seen = new Map<string, ModSource>();
  for (const link of links) {
    const source = modSources.value.get(link.sourceId);
    if (source) seen.set(source.id, source);
  }
  return [...seen.values()];
}

function propertyModSources(layerId: string, paramName: string): ModSource[] {
  return uniqueSources(propertyLinks(layerId, paramName));
}

/** Modulators driving any timeline property of the layer (for the collapsed bar). */
function layerModSources(layer: LayerInstance): ModSource[] {
  const names = new Set(rawKeyframeableUniforms(layer).map((d) => d.name));
  return uniqueSources(assignments.filter((a) => a.layerId === layer.id && names.has(a.paramName)));
}

function modTitle(sources: ModSource[]): string {
  return `Modulated by ${sources.map((s) => s.label).join(", ")} — click to edit`;
}

type ModCurve = { base: string; mod: string; color: string };

/**
 * Per modulated property: the base (static/keyframes) and the final value
 * (base + links) sampled across the comp, normalized to the row height.
 * Independent of the playhead, so scrubbing doesn't resample.
 */
const modulationCurves = computed(() => {
  const curves = new Map<string, ModCurve>();
  if (assignments.length === 0) return curves;

  type Target = { layer: LayerInstance; paramName: string; staticBase: number; color: string };
  const targets: Target[] = [];
  for (const layer of layers.value) {
    for (const def of rawKeyframeableUniforms(layer)) {
      const sources = propertyModSources(layer.id, def.name);
      if (sources.length === 0) continue;
      const raw = layer.values[def.name];
      const staticBase = typeof raw === "number" ? raw : Number(def.default ?? 0);
      targets.push({ layer, paramName: def.name, staticBase, color: sources[0]!.color });
    }
  }
  if (targets.length === 0) return curves;

  const engine = new ModulationEngine();
  engine.setConfig({ layers: layers.value, lfos, envelopes, assignments, tracks: tracks.value, settings });

  const duration = Math.max(settings.duration, 1e-3);
  const samples = Math.max(32, Math.min(800, Math.round((duration * pxPerSecond.value) / 2)));
  const times = Array.from({ length: samples }, (_, i) => (duration * i) / (samples - 1));
  const base = targets.map(() => new Array<number>(samples));
  const mod = targets.map(() => new Array<number>(samples));

  times.forEach((t, i) => {
    engine.sampleAt(t);
    targets.forEach((target, ti) => {
      const track = findPropertyTrack(tracks.value, target.layer.id, target.paramName);
      const b = evaluatePropertyTrack(track, t, target.staticBase);
      base[ti]![i] = b;
      mod[ti]![i] = engine.getModulatedValue(target.layer.id, target.paramName, b);
    });
  });

  const top = 4;
  const bottom = PROP_ROW_H - 4;
  targets.forEach((target, ti) => {
    const all = [...base[ti]!, ...mod[ti]!];
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (max - min < 1e-9) {
      min -= 1;
      max += 1;
    }
    const toPath = (values: number[]) =>
      "M " +
      values
        .map((v, i) => {
          const x = times[i]! * pxPerSecond.value;
          const y = bottom - ((v - min) / (max - min)) * (bottom - top);
          return `${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" L ");
    curves.set(`${target.layer.id}:${target.paramName}`, {
      base: toPath(base[ti]!),
      mod: toPath(mod[ti]!),
      color: target.color,
    });
  });

  return curves;
});

function modulationCurve(layerId: string, paramName: string): ModCurve | undefined {
  return modulationCurves.value.get(`${layerId}:${paramName}`);
}

// --- Timeline rows ---
//
// Every keyframeable row (layer property, modulator link param, modulator
// param) shares one model: `owner` is the track layerId (layer id, `link:…`,
// `mod:…`), `def` drives clamping/formatting, base/setBase read and write the
// static value used when the stopwatch is off.

type TimelineRow = {
  key: string;
  owner: string;
  def: LayerUniformDef;
  /** "axis": a position axis folded out under the linked Position row (edits that axis only). */
  kind: "property" | "axis" | "link" | "source";
  layer?: LayerInstance;
  link?: ModulationAssignment;
  color?: string;
  /** Modulator name shown before the label on link rows. */
  prefix?: string;
  base: () => number;
  setBase: (v: number) => void;
};

/** Per-axis rows behind a linked Position row (value scrub/edit per axis). */
function positionAxisRows(row: TimelineRow): TimelineRow[] {
  if (!row.layer) return [];
  const axes = new Set(positionAxes(row.layer));
  return rawKeyframeableUniforms(row.layer)
    .filter((d) => axes.has(d.name))
    .map((d) => propertyRow(row.layer!, d));
}

function propertyRow(layer: LayerInstance, def: LayerUniformDef): TimelineRow {
  return {
    key: `${layer.id}:${def.name}`,
    owner: layer.id,
    def,
    kind: "property",
    layer,
    base: () => {
      const raw = layer.values[def.name];
      return typeof raw === "number" ? raw : Number(def.default ?? 0);
    },
    setBase: (v) => {
      layer.values[def.name] = v;
    },
  };
}

/** Link sub-rows open under a modulated property (toggled by its dots). */
const linkRowsOpen = ref<Set<string>>(new Set());

function linkRowsKey(layerId: string, paramName: string): string {
  return `${layerId}:${paramName}`;
}

function isLinkRowsOpen(layerId: string, paramName: string): boolean {
  return linkRowsOpen.value.has(linkRowsKey(layerId, paramName));
}

function toggleLinkRows(layerId: string, paramName: string) {
  const next = new Set(linkRowsOpen.value);
  const key = linkRowsKey(layerId, paramName);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  linkRowsOpen.value = next;
}

function linkRows(layer: LayerInstance, def: LayerUniformDef): TimelineRow[] {
  if (def.name === POSITION_GROUP) {
    const axes = new Set(positionAxes(layer));
    return rawKeyframeableUniforms(layer).filter((d) => axes.has(d.name)).flatMap((d) => linkRows(layer, d));
  }
  const span =
    def.min !== undefined && def.max !== undefined ? def.max - def.min : undefined;
  return propertyLinks(layer.id, def.name).flatMap((link) => {
    const source = modSources.value.get(link.sourceId)!;
    const owner = linkTrackLayerId(link);
    const common = { owner, kind: "link" as const, layer, link, color: source.color, prefix: source.label };
    return [
      {
        ...common,
        key: `${owner}:depth`,
        def: {
          name: "depth",
          label: "Amount",
          type: def.type === "int" ? "int" : "float",
          default: 0,
          step: def.step,
          min: span === undefined ? undefined : -span,
          max: span,
        },
        base: () => link.depth,
        setBase: (v: number) => {
          link.depth = v;
        },
      },
      {
        ...common,
        key: `${owner}:enabled`,
        def: { name: "enabled", label: "On", type: "bool", default: 1 },
        base: () => (link.enabled === false ? 0 : 1),
        setBase: (v: number) => {
          link.enabled = v >= 0.5;
        },
      },
    ] satisfies TimelineRow[];
  });
}

/** Property rows (+ open link rows) under a layer, in display order. */
function rowsForLayer(layer: LayerInstance): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const def of visibleProperties(layer)) {
    if (!showPropertyRow(layer, def.name)) continue;
    const row = propertyRow(layer, def);
    rows.push(row);
    if (def.name === POSITION_GROUP && axisRowsOpen.value.has(layer.id)) {
      for (const axisRow of positionAxisRows(row)) {
        rows.push({
          ...axisRow,
          key: `${axisRow.key}:axis`,
          kind: "axis",
          color: AXIS_COLORS[axisRow.def.name],
          def: { ...axisRow.def, label: axisRow.def.name.slice(-1) },
        });
      }
    }
    if (isLinkRowsOpen(layer.id, def.name) && isModulated(layer.id, def.name)) {
      rows.push(...linkRows(layer, def));
    }
  }
  return rows;
}

// --- Modulators group (bottom of the timeline) ---

type ModulatorEntry =
  | { kind: "lfo"; source: LFOSource }
  | { kind: "envelope"; source: EnvelopeSource };

const modulatorEntries = computed<ModulatorEntry[]>(() => [
  ...lfos.map((source) => ({ kind: "lfo" as const, source })),
  ...envelopes.map((source) => ({ kind: "envelope" as const, source })),
]);

const modGroupOpen = ref(false);
const sourceRowsOpen = ref<Set<string>>(new Set());

function toggleSourceRows(id: string) {
  const next = new Set(sourceRowsOpen.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  sourceRowsOpen.value = next;
}

type SourceParam = { name: string; label: string; min: number; max: number; step: number };

const LFO_PARAMS: SourceParam[] = [
  { name: "rate", label: "Rate", min: 0, max: 20, step: 0.01 },
  { name: "phase", label: "Phase", min: 0, max: 360, step: 1 },
];

const ENVELOPE_PARAMS: SourceParam[] = [
  { name: "attack", label: "Attack", min: 0, max: 30, step: 0.01 },
  { name: "decay", label: "Decay", min: 0, max: 30, step: 0.01 },
  { name: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01 },
  { name: "gate", label: "Gate", min: 0, max: 30, step: 0.01 },
  { name: "release", label: "Release", min: 0, max: 30, step: 0.01 },
];

function sourceRows(entry: ModulatorEntry): TimelineRow[] {
  const owner = sourceTrackLayerId(entry.source.id);
  const params = entry.kind === "lfo" ? LFO_PARAMS : ENVELOPE_PARAMS;
  const values = entry.source as unknown as Record<string, number>;
  return params.map((p) => ({
    key: `${owner}:${p.name}`,
    owner,
    kind: "source",
    color: entry.source.color,
    def: { name: p.name, label: p.label, type: "float", default: 0, min: p.min, max: p.max, step: p.step },
    base: () => values[p.name] ?? 0,
    setBase: (v: number) => {
      values[p.name] = v;
    },
  }));
}

/** Each modulator's signal (0..1) across the comp, for its header row. */
const sourceCurves = computed(() => {
  const curves = new Map<string, string>();
  if (modulatorEntries.value.length === 0) return curves;
  const engine = new ModulationEngine();
  engine.setConfig({ layers: layers.value, lfos, envelopes, assignments, tracks: tracks.value, settings });
  const duration = Math.max(settings.duration, 1e-3);
  const samples = Math.max(32, Math.min(800, Math.round((duration * pxPerSecond.value) / 2)));
  const top = 4;
  const bottom = PROP_ROW_H - 4;
  for (const { source } of modulatorEntries.value) {
    const points: string[] = [];
    for (let i = 0; i < samples; i++) {
      const t = (duration * i) / (samples - 1);
      const y = bottom - engine.signal(source.id, t) * (bottom - top);
      points.push(`${(t * pxPerSecond.value).toFixed(1)} ${y.toFixed(1)}`);
    }
    curves.set(source.id, `M ${points.join(" L ")}`);
  }
  return curves;
});

/** On-spans of a bool row (link "On"), in px. */
function onRanges(row: TimelineRow): { x: number; w: number }[] {
  const duration = settings.duration;
  const track = findPropertyTrack(tracks.value, row.owner, row.def.name);
  const spans: [number, number][] = [];
  if (isPropertyTrackActive(track)) {
    const keys = [...track!.keys].sort((a, b) => a.time - b.time);
    keys.forEach((key, i) => {
      if (key.value < 0.5) return;
      const start = i === 0 ? 0 : key.time;
      const end = keys[i + 1]?.time ?? duration;
      if (end > start) spans.push([start, end]);
    });
  } else if (row.base() >= 0.5) {
    spans.push([0, duration]);
  }
  return spans.map(([a, b]) => ({ x: a * pxPerSecond.value, w: (b - a) * pxPerSecond.value }));
}

/** Rows in the modulators group, in display order, with header placeholders (for hit testing). */
function modulatorGroupLayout(): ({ height: number; row?: TimelineRow })[] {
  if (modulatorEntries.value.length === 0) return [];
  const out: { height: number; row?: TimelineRow }[] = [{ height: LAYER_ROW_H }];
  if (!modGroupOpen.value) return out;
  for (const entry of modulatorEntries.value) {
    out.push({ height: PROP_ROW_H });
    if (sourceRowsOpen.value.has(entry.source.id)) {
      for (const row of sourceRows(entry)) out.push({ height: PROP_ROW_H, row });
    }
  }
  return out;
}

/** Keyframe clicks on link/modulator rows select the related layer, never a fake id. */
function selectLayerForOwner(owner: string) {
  if (layers.value.some((l) => l.id === owner)) {
    selectedLayerId.value = owner;
    return;
  }
  const link = assignments.find((a) => linkTrackLayerId(a) === owner);
  if (link) selectedLayerId.value = link.layerId;
}

function rowValue(row: TimelineRow): number {
  const track = findPropertyTrack(tracks.value, row.owner, row.def.name);
  return evaluatePropertyTrack(track, displayTime.value, row.base());
}

function formatRowValue(row: TimelineRow): string {
  const v = rowValue(row);
  if (row.def.type === "bool") return v >= 0.5 ? "On" : "Off";
  return v.toFixed(2);
}

/** Bool rows step: every key holds. Pure (tracks is a v-model, reads stale after a write). */
function holdKeys(list: PropertyTrack[], owner: string, paramName: string): PropertyTrack[] {
  return list.map((t) =>
    t.layerId === owner && t.paramName === paramName
      ? { ...t, keys: t.keys.map(({ curve: _curve, ...k }) => ({ ...k, ease: "hold" as const })) }
      : t,
  );
}

function onRowStopwatch(row: TimelineRow) {
  if (row.kind === "property") {
    emit("toggle-stopwatch", row.owner, row.def.name);
    return;
  }
  const { owner } = row;
  const name = row.def.name;
  if (trackEnabled(owner, name)) {
    tracks.value = setTrackEnabled(tracks.value, owner, name, false);
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) => !(k.layerId === owner && k.paramName === name),
    );
  } else {
    const next = setTrackEnabled(tracks.value, owner, name, true, row.base(), snapTime(currentTime.value));
    tracks.value = row.def.type === "bool" ? holdKeys(next, owner, name) : next;
  }
  history?.record();
}

function onRowKeyframe(row: TimelineRow) {
  if (row.kind === "property") {
    emit("toggle-keyframe", row.owner, row.def.name);
    return;
  }
  const { owner } = row;
  const name = row.def.name;
  const track = findPropertyTrack(tracks.value, owner, name);
  if (!track?.enabled) return;
  const time = currentTime.value;
  if (hasKeyframeAt(track, time)) {
    tracks.value = removeKeyframeAt(tracks.value, owner, name, time);
    selectedKeyframes.value = selectedKeyframes.value.filter(
      (k) => !(k.layerId === owner && k.paramName === name && Math.abs(k.time - time) < 1e-6),
    );
  } else {
    const next = upsertKeyframe(tracks.value, owner, name, time, rowValue(row));
    tracks.value = row.def.type === "bool" ? holdKeys(next, owner, name) : next;
  }
  history?.record();
}

// --- Keyframe easing (context menu) ---

/** Apply to the whole selection when the clicked key is part of it. */
function applyKeyframeEasing(
  layerId: string,
  paramName: string,
  time: number,
  easing: KeyframeEasing | CubicBezierEase,
) {
  const refs = isKeyframeSelected(layerId, paramName, time)
    ? selectedKeyframes.value
    : axisRefsAt(layerId, paramName, time);
  tracks.value = setKeyframesEasing(tracks.value, refs, easing);
  history?.record();
}

/**
 * Value line for a property row: one continuous path through all keys (the
 * whole journey), scaled to the track's own min/max so highs and lows read
 * true. Linked Position draws one line per animated axis.
 */
/** Axis colors, same as the canvas gizmo arrows (X red, Y green, Z blue). */
const AXIS_COLORS: Record<string, string> = {
  layerPositionX: "#ef4444",
  layerPositionY: "#22c55e",
  layerPositionZ: "#3b82f6",
};

function segmentPaths(layerId: string, paramName: string): { d: string; color?: string }[] {
  const top = 5;
  const bottom = PROP_ROW_H - 5;
  const paths: { d: string; color?: string }[] = [];
  for (const axis of axesFor(layerId, paramName)) {
    const track = findPropertyTrack(tracks.value, layerId, axis);
    if (!isPropertyTrackActive(track) || track!.keys.length < 2) continue;
    const keys = [...track!.keys].sort((a, b) => a.time - b.time);
    const t0 = keys[0]!.time;
    const t1 = keys[keys.length - 1]!.time;
    const x0 = timeToX(t0);
    const x1 = timeToX(t1);
    if (x1 - x0 < 2) continue;

    // Sample every ~2px; also hit each key exactly (holds step there).
    const times: number[] = [];
    const steps = Math.max(2, Math.ceil((x1 - x0) / 2));
    for (let i = 0; i <= steps; i++) times.push(t0 + ((t1 - t0) * i) / steps);
    for (const k of keys) times.push(k.time, k.time - 1e-6);
    times.sort((a, b) => a - b);
    const values = times.map((t) => evaluateKeyframes(keys, Math.max(t0, t), keys[0]!.value));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 1e-9) {
      min -= 1;
      max += 1;
    }
    const points = times.map((t, i) => {
      const x = (Math.max(t0, t) - t0) * pxPerSecond.value + x0;
      const y = bottom - ((values[i]! - min) / (max - min)) * (bottom - top);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    paths.push({ d: `M ${points.join(" L ")}`, color: AXIS_COLORS[axis] });
  }
  return paths;
}

/** Current easing id of a key: named ease, preset id, or "custom". */
function keyframeEasingId(layerId: string, paramName: string, time: number): string {
  const ref = axisRefsAt(layerId, paramName, time)[0];
  const track = ref ? findPropertyTrack(tracks.value, layerId, ref.paramName) : undefined;
  const key = track?.keys.find((k) => Math.abs(k.time - time) < 1e-6);
  if (!key) return "linear";
  if (key.curve) return matchEasingPreset(key.curve) ?? "custom";
  return key.ease ?? "linear";
}

// --- Timeline value editing (scrub + click to type) ---

const editingValue = ref<{ rowKey: string; layerId: string; paramName: string; text: string } | null>(null);
// layerId here is the row owner (layer id or link/modulator track id).

/** By row key: the same param can show in two rows (Position and its X/Y row). */
function isEditingValue(rowKey: string): boolean {
  return editingValue.value?.rowKey === rowKey;
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
function writeParamValue(row: TimelineRow, value: number) {
  const { def, owner } = row;
  const v = def.type === "bool" ? (value >= 0.5 ? 1 : 0) : clampToDef(def, value);
  if (trackEnabled(owner, def.name)) {
    const time = snapTime(currentTime.value);
    // One write: `tracks` is a v-model, so it reads stale until the parent updates.
    let next = tracks.value;
    // Linked Position: one keyframe holds every axis (AE).
    if (row.kind === "property" && row.layer && def.name.startsWith("layerPosition")) {
      for (const axis of positionAxes(row.layer)) {
        if (axis === def.name) continue;
        const axisRow = positionAxisRows({ ...row, def: POSITION_GROUP_DEF }).find((r) => r.def.name === axis);
        if (axisRow) next = upsertKeyframe(next, owner, axis, time, rowValue(axisRow));
      }
    }
    next = upsertKeyframe(next, owner, def.name, time, v);
    tracks.value = def.type === "bool" ? holdKeys(next, owner, def.name) : next;
  } else {
    row.setBase(v);
  }
}

function onValuePointerDown(row: TimelineRow, e: PointerEvent) {
  if (e.button !== 0) return;
  const { def } = row;

  if (def.type === "bool") {
    writeParamValue(row, rowValue(row) >= 0.5 ? 0 : 1);
    history?.record();
    return;
  }

  const startX = e.clientX;
  const startValue = rowValue(row);
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
    writeParamValue(row, next);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
    if (dragging) {
      history?.commitGesture();
    } else {
      openValueEditor(row);
    }
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function openValueEditor(row: TimelineRow) {
  const current = rowValue(row);
  editingValue.value = {
    rowKey: row.key,
    layerId: row.owner,
    paramName: row.def.name,
    text: String(Number(current.toFixed(4))),
  };
}

/** Function refs run on every re-render; only focus/select when the input first mounts. */
let focusedValueInput: HTMLInputElement | null = null;

function focusValueInput(el: unknown) {
  const input = el as HTMLInputElement | null;
  if (input && input !== focusedValueInput) {
    // Next frame: the click that opened the editor would otherwise steal focus.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
  focusedValueInput = input;
}

function commitValueEditor(row: TimelineRow) {
  const editing = editingValue.value;
  if (!editing) return;
  editingValue.value = null;
  const parsed = Number.parseFloat(editing.text.replace(",", "."));
  if (!Number.isFinite(parsed)) return;
  const clamped = clampToDef(row.def, parsed);
  if (clamped === rowValue(row)) return;
  writeParamValue(row, clamped);
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
  // A linked Position diamond stands for every axis key at that time.
  const clickedKeys = axisRefsAt(layerId, paramName, time);
  if (clickedKeys.length === 0) clickedKeys.push({ layerId, paramName, time });
  if (e.button !== 0) {
    // Right-click: make sure the key is selected so easing applies to it.
    if (!isKeyframeSelected(layerId, paramName, time)) {
      selectedKeyframes.value = clickedKeys;
      selectLayerForOwner(layerId);
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  playing.value = false;

  const wasInSelection = isKeyframeSelected(layerId, paramName, time);

  if (e.shiftKey) {
    let next = selectedKeyframes.value;
    for (const key of clickedKeys) {
      const has = isKeyframeInSelection(next, key.layerId, key.paramName, key.time);
      if (has === wasInSelection) next = toggleKeyframeInSelection(next, key);
    }
    selectedKeyframes.value = next;
    selectLayerForOwner(layerId);
    history?.record();
    return;
  }

  if (!wasInSelection) {
    selectedKeyframes.value = clickedKeys;
  }

  selectLayerForOwner(layerId);

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
        : clickedKeys.map((k) => ({ ...k }));
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
      selectLayerForOwner(hits[0]!.layerId);
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
  return axesFor(layerId, paramName).some((axis) =>
    isKeyframeInSelection(selectedKeyframes.value, layerId, axis, time),
  );
}

function isKeyframeAtPlayhead(time: number): boolean {
  return Math.abs(time - currentTime.value) < 1e-6;
}

function isKeyedAtPlayhead(layerId: string, paramName: string): boolean {
  return axesFor(layerId, paramName).some((axis) =>
    hasKeyframeAt(findPropertyTrack(tracks.value, layerId, axis), currentTime.value),
  );
}

/** All key times of a row (linked Position: every axis), sorted, unique. */
function rowKeyTimes(layerId: string, paramName: string): number[] {
  const times = new Set<number>();
  for (const axis of axesFor(layerId, paramName)) {
    for (const k of findPropertyTrack(tracks.value, layerId, axis)?.keys ?? []) times.add(k.time);
  }
  return [...times].sort((a, b) => a - b);
}

/** AE keyframe navigator: jump the playhead to the previous / next key. */
function jumpToKey(layerId: string, paramName: string, dir: -1 | 1) {
  const t = currentTime.value;
  const times = rowKeyTimes(layerId, paramName);
  const target = dir < 0
    ? [...times].reverse().find((k) => k < t - 1e-6)
    : times.find((k) => k > t + 1e-6);
  if (target != null) currentTime.value = target;
}

function hasKeyBefore(layerId: string, paramName: string): boolean {
  return rowKeyTimes(layerId, paramName).some((k) => k < currentTime.value - 1e-6);
}

function hasKeyAfter(layerId: string, paramName: string): boolean {
  return rowKeyTimes(layerId, paramName).some((k) => k > currentTime.value + 1e-6);
}

// --- Search (⌘F): filter layers by name or type ---

const search = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);

function layerMatchesSearch(layer: LayerInstance): boolean {
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  return layerLabel(layer).toLowerCase().includes(q) || layer.type.toLowerCase().includes(q);
}

// --- Animated only (toolbar toggle = U for every animated layer) ---

const animatedOnly = computed(() => {
  const animated = layers.value.filter((l) => enabledTracksForLayer(l.id).length > 0);
  return animated.length > 0 && animated.every((l) => keyframesRevealed.value.has(l.id));
});

function toggleAnimatedOnly() {
  const animated = layers.value.filter((l) => enabledTracksForLayer(l.id).length > 0).map((l) => l.id);
  if (animatedOnly.value) collapseLayers(animated);
  else revealUViewLayers(animated);
}

// --- Parent column ---

/** Layers that can parent `layer`: not itself, not one of its descendants. */
function parentOptionsFor(layer: LayerInstance): { value: string; label: string }[] {
  const descendants = new Set<string>([layer.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of layers.value) {
      if (l.parent && descendants.has(l.parent) && !descendants.has(l.id)) {
        descendants.add(l.id);
        grew = true;
      }
    }
  }
  return [
    { value: "", label: "None" },
    ...layers.value.filter((l) => !descendants.has(l.id)).map((l) => ({ value: l.id, label: layerLabel(l) })),
  ];
}

// --- Pick-whip: drag from a layer's spiral onto another layer to parent ---

const pickWhip = ref<{ childId: string; x0: number; y0: number; x: number; y: number } | null>(null);
const pickWhipTargetId = ref<string | null>(null);

function layerIdAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId ?? null;
}

function startPickWhip(childId: string, e: PointerEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x0 = rect.left + rect.width / 2;
  const y0 = rect.top + rect.height / 2;
  pickWhip.value = { childId, x0, y0, x: e.clientX, y: e.clientY };
  const valid = () => new Set(parentOptionsFor(layers.value.find((l) => l.id === childId)!).map((o) => o.value));
  const allowed = valid();
  const move = (ev: PointerEvent) => {
    if (!pickWhip.value) return;
    pickWhip.value = { ...pickWhip.value, x: ev.clientX, y: ev.clientY };
    const id = layerIdAt(ev.clientX, ev.clientY);
    pickWhipTargetId.value = id && allowed.has(id) ? id : null;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const target = pickWhipTargetId.value;
    pickWhip.value = null;
    pickWhipTargetId.value = null;
    if (target) emit("set-parent", childId, target);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// --- Zoom slider (log scale between min and max) ---

const zoomSlider = computed({
  get: () =>
    Math.log(pxPerSecond.value / MIN_PX_PER_SECOND) / Math.log(MAX_PX_PER_SECOND / MIN_PX_PER_SECOND),
  set: (v: number) => {
    const body = bodyScrollRef.value;
    const next = MIN_PX_PER_SECOND * Math.pow(MAX_PX_PER_SECOND / MIN_PX_PER_SECOND, v);
    if (!body) {
      pxPerSecond.value = next;
      return;
    }
    const rect = body.getBoundingClientRect();
    zoomAt(next / pxPerSecond.value, rect.left + rect.width / 2);
  },
});

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
  id: "timeline:search",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return false;
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
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
  p: [POSITION_GROUP, "layerPositionX", "layerPositionY", "layerPositionZ"],
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
    const names = new Set(keyframeableUniforms(layer).map((d) => d.name));
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

/** Time of the active edge-snap guide while a bar drag is locked on. */
const snapGuideTime = ref<number | null>(null);

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

  // Bars take the same modifier clicks as layer names: shift extends, cmd/ctrl
  // toggles, plain click on an unselected bar selects it. A plain press on an
  // already selected bar keeps the selection so the group can be dragged.
  // selectLayer returns the fresh set; the models still hold last tick's value.
  let selection = selectedLayerIds.value;
  if (e.shiftKey || e.metaKey || e.ctrlKey || !selection.has(layer.id)) {
    selection = selectLayer(layer.id, e) ?? selection;
  }
  // A cmd/ctrl press can deselect the pressed bar; nothing to drag then.
  if (!selection.has(layer.id)) return;

  const startX = e.clientX;
  const startIn = layerInPoint(layer);
  const startOut = layerOutPoint(layer);
  const frame = 1 / settings.fps;
  let dragging = false;

  // Moving a bar moves every selected bar together; trims stay on the pressed layer.
  const movedLayers = mode === "move" ? layers.value.filter((l) => selection.has(l.id)) : [layer];
  const movedIds = new Set(movedLayers.map((l) => l.id));
  const startWindows = new Map(
    movedLayers.map((l) => [l.id, { in: layerInPoint(l), out: layerOutPoint(l) }]),
  );
  const startWindowList = [...startWindows.values()];

  // Edge snapping like the canvas: comp bounds, playhead, other bars' edges.
  const snapTargets = collectBarSnapTargets(
    layers.value.map((l) => ({ id: l.id, in: layerInPoint(l), out: layerOutPoint(l) })),
    movedIds,
    settings.duration,
    currentTime.value,
  );
  const snapThreshold = () => TIMELINE_SNAP_THRESHOLD_PX / pxPerSecond.value;
  const snapRelease = () => TIMELINE_SNAP_RELEASE_PX / pxPerSecond.value;
  // The currently held target (hysteresis), kept across pointermoves.
  let snapLock: number | null = null;

  // Moving a bar shifts the layer in time: keyframes travel with it.
  const startKeyTimes = new Map(
    tracks.value
      .filter((t) => movedIds.has(t.layerId))
      .map((t) => [`${t.layerId}\u0000${t.paramName}`, t.keys.map((k) => k.time)]),
  );

  function shiftLayerKeyframes(delta: number) {
    if (startKeyTimes.size === 0) return;
    tracks.value = tracks.value.map((track) => {
      const startTimes = startKeyTimes.get(`${track.layerId}\u0000${track.paramName}`);
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
    // Frames quantize the drag; an edge snap in range takes over. Holding
    // ⌥/Alt bypasses snapping for this move. When the clamp then moves the
    // result, the guide would lie, so it is dropped.
    const snapActive = snapping.value && !ev.altKey;
    if (!snapActive) snapLock = null;
    let guide: number | null = null;
    if (mode === "move") {
      let delta = snapTime(startIn + deltaTime) - startIn;
      if (snapActive) {
        const snapped = snapBarMoveDelta(
          deltaTime,
          startWindowList,
          snapTargets,
          snapThreshold(),
          snapLock,
          snapRelease(),
        );
        if (snapped.guide !== null) {
          delta = snapped.delta;
          guide = snapped.guide;
        }
      }
      snapLock = guide;
      // Clamp one shared delta so every moved bar keeps a grabbable slice
      // inside the composition.
      const clamped = clampGroupBarMoveDelta(delta, startWindowList, settings.duration);
      if (clamped !== delta) guide = null;
      for (const moved of movedLayers) {
        const w = startWindows.get(moved.id)!;
        writeLayerTiming(moved, w.in + clamped, w.out + clamped);
      }
      shiftLayerKeyframes(clamped);
    } else if (mode === "in") {
      let nextIn = snapTime(startIn + deltaTime);
      if (snapActive) {
        const snapped = snapEdgeTime(
          startIn + deltaTime,
          snapTargets,
          snapThreshold(),
          snapLock,
          snapRelease(),
        );
        if (snapped.guide !== null) {
          nextIn = snapped.time;
          guide = snapped.guide;
        }
      }
      snapLock = guide;
      // Trim stops at 0 as before, but keeps an existing left overhang reachable.
      const clamped = Math.max(
        Math.min(0, startIn),
        Math.min(nextIn, startOut - frame, settings.duration - frame),
      );
      if (clamped !== nextIn) guide = null;
      writeLayerTiming(layer, clamped, startOut);
    } else {
      let nextOut = snapTime(startOut + deltaTime);
      if (snapActive) {
        const snapped = snapEdgeTime(
          startOut + deltaTime,
          snapTargets,
          snapThreshold(),
          snapLock,
          snapRelease(),
        );
        if (snapped.guide !== null) {
          nextOut = snapped.time;
          guide = snapped.guide;
        }
      }
      snapLock = guide;
      // The out point may pass the composition end; that tail never plays.
      const clamped = Math.max(nextOut, startIn + frame, frame);
      if (clamped !== nextOut) guide = null;
      writeLayerTiming(layer, startIn, clamped);
    }
    snapGuideTime.value = guide;
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    snapGuideTime.value = null;
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

// --- Property row selection (AE: click a property = select it + all its keys) ---

/** Selected property rows (row keys). Cleared when layers/keys are picked elsewhere. */
const selectedRowKeys = ref<Set<string>>(new Set());

function rowKeySelections(row: TimelineRow): KeyframeSelection[] {
  return axesFor(row.owner, row.def.name).flatMap((axis) =>
    (findPropertyTrack(tracks.value, row.owner, axis)?.keys ?? []).map((k) => ({
      layerId: row.owner,
      paramName: axis,
      time: k.time,
    })),
  );
}

function onPropertyRowClick(row: TimelineRow, e: MouseEvent) {
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const next = new Set(additive ? selectedRowKeys.value : []);
  if (additive && next.has(row.key)) next.delete(row.key);
  else next.add(row.key);
  selectedRowKeys.value = next;

  // Keep the owning layer selected (inspector follows), keys of every picked row.
  selectLayerForOwner(row.owner);
  const layerId = selectedLayerId.value;
  if (layerId && !selectedLayerIds.value.has(layerId)) selectedLayerIds.value = new Set([layerId]);
  const rows = layers.value.flatMap((l) => rowsForLayer(l)).filter((r) => next.has(r.key));
  selectedKeyframes.value = rows.flatMap(rowKeySelections);
}

function isRowSelected(row: TimelineRow): boolean {
  return selectedRowKeys.value.has(row.key);
}

// Any other selection change (layer click, key click, marquee) drops row selection.
watch(selectedKeyframes, (keys) => {
  if (selectedRowKeys.value.size === 0) return;
  const expected = layers.value
    .flatMap((l) => rowsForLayer(l))
    .filter((r) => selectedRowKeys.value.has(r.key))
    .flatMap(rowKeySelections);
  const same = keys.length === expected.length
    && expected.every((x) => keys.some((k) => k.layerId === x.layerId && k.paramName === x.paramName && Math.abs(k.time - x.time) < 1e-6));
  if (!same) selectedRowKeys.value = new Set();
});

/**
 * Returns the resulting selection so pointerdown handlers can use it right
 * away: the selection models are defineModel and only sync back next tick.
 */
function selectLayer(id: string, e?: MouseEvent): Set<string> | null {
  selectedRowKeys.value = new Set();
  const index = layerIndex(id);
  if (index === -1) return null;

  let next: Set<string>;
  if (e?.shiftKey) {
    const anchorId = selectionAnchorId.value ?? selectedLayerId.value;
    const anchorIndex = anchorId ? layerIndex(anchorId) : index;
    const lo = Math.min(anchorIndex, index);
    const hi = Math.max(anchorIndex, index);
    next = new Set(layers.value.slice(lo, hi + 1).map((l) => l.id));
    selectedLayerIds.value = next;
  } else if (e?.metaKey || e?.ctrlKey) {
    next = new Set(selectedLayerIds.value);
    const adding = !next.has(id);
    if (adding) next.add(id);
    else next.delete(id);
    selectedLayerIds.value = next;
    selectionAnchorId.value = id;
    selectedKeyframes.value = [];
    if (next.size === 0) {
      selectedLayerId.value = null;
      history?.record();
      return next;
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
    return next;
  } else {
    next = new Set([id]);
    selectedLayerIds.value = next;
    selectionAnchorId.value = id;
  }

  selectedLayerId.value = id;
  selectedKeyframes.value = [];
  history?.record();
  return next;
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
  <div class="flex h-full min-h-0 select-none flex-col bg-[var(--s-tile)]">
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- Header row -->
      <div class="flex shrink-0 min-w-0">
        <!-- AE-style header: time, search, view toggles; column labels below. -->
        <div
          class="flex h-[60px] shrink-0 flex-col border-b border-r border-[var(--s-frame)] bg-[var(--s-tile)]"
          :style="{ width: `${labelWidth}px` }"
        >
          <div class="flex h-9 items-center gap-1.5 px-2">
            <span
              class="w-16 shrink-0 tabular-nums text-[var(--s-value)]"
              :title="`${formatTime(currentTime)} / ${formatTime(settings.duration)} · ${settings.fps} fps`"
            >{{ formatTime(currentTime) }}</span>
            <StudioInput v-model="search" class="min-w-0 flex-1" placeholder="Search">
              <template #leading><StudioIcon name="search" /></template>
            </StudioInput>

            <StudioButton square :active="animatedOnly" aria-label="Animated properties only" title="Animated properties only (U)" @click="toggleAnimatedOnly">
              <StudioIcon :name="animatedOnly ? 'key-filled' : 'key'" />
            </StudioButton>
            <StudioButton square :active="snapping" aria-label="Snapping" :title="snapping ? 'Snapping on (hold ⌥ to bypass)' : 'Snapping off'" @click="snapping = !snapping">
              <StudioIcon name="magnet" />
            </StudioButton>
          </div>
          <!-- Column labels use the exact slots + padding of the layer row cells,
               so they line up by construction (no pixel offsets). -->
          <div class="flex h-6 items-center gap-0.5 px-1 text-xs text-neutral-weak select-none">
            <span class="w-[60px] shrink-0" />
            <span class="size-5 shrink-0" />
            <span class="size-3 shrink-0" />
            <span class="min-w-0 flex-1 px-1">Layer</span>
            <span class="flex w-28 shrink-0 items-center">
              <span class="size-5 shrink-0" />
              <span class="px-1.5">Parent</span>
            </span>
          </div>
        </div>

        <div
          ref="rulerScrollRef"
          class="h-[60px] min-w-0 flex-1 cursor-ew-resize touch-none overflow-x-auto overflow-y-hidden border-b border-[var(--s-frame)] bg-[var(--s-tile)] select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  class="pl-1 tabular-nums text-xs text-neutral-subtle"
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
          class="relative shrink-0 overflow-hidden border-r border-[var(--s-frame)] bg-[var(--s-tile)]"
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
              v-show="layerMatchesSearch(layer)"
              class="layer-group relative"
              :class="[
                !layer.enabled && 'opacity-50',
                draggingIndices.has(i) && 'z-50 scale-[1.01] shadow-lg',
              ]"
            >
              <!-- No hover (Live): rows are split by a dark line; selected = raised. -->
              <div
                class="w-full"
                :class="isLayerSelected(layer.id) || draggingIndices.has(i) ? 'bg-[var(--s-raise)]' : 'bg-[var(--s-tile)]'"
              >
                <div
                  data-drag-handle
                  class="flex h-7 w-full cursor-default items-center gap-0.5 border-b border-[var(--s-frame)] px-1 select-none"
                  :data-layer-id="layer.id"
                  :class="pickWhip && pickWhipTargetId === layer.id && 'ring-1 ring-inset ring-accent'"
                  :title="layer.type === 'composition' ? 'Double-click to open the composition' : undefined"
                  @click="selectLayer(layer.id, $event)"
                  @dblclick.capture="onLayerRowDblClick(layer, $event)"
                >
                  <!-- Same 60px block as the property rows' key navigator, so the
                       chevrons and names line up as a tree. -->
                  <div class="flex w-[60px] shrink-0 items-center">
                    <button
                      type="button"
                      data-drag-exclude
                      class="flex size-6 shrink-0 items-center justify-center rounded-none outline-none transition-colors hover:bg-[var(--s-inset-hover)]"
                      :class="layer.enabled ? 'text-neutral-subtle hover:text-neutral-strong' : 'text-neutral-weak'"
                      :aria-label="layer.enabled ? 'Hide layer' : 'Show layer'"
                      @click.stop="toggleLayerEnabled(layer)"
                    >
                      <StudioIcon :name="layer.enabled ? 'eye' : 'eye-off'" />
                    </button>
                  </div>
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
                  <span class="flex size-3 shrink-0 items-center justify-center">
                    <component
                      :is="layerTypeIcon(layer)"
                      v-if="layerTypeIcon(layer)"
                      class="size-3 text-neutral-subtle"
                      aria-hidden="true"
                    />
                  </span>
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
                  <div class="flex w-28 shrink-0 items-center" data-drag-exclude @click.stop @pointerdown.stop>
                    <!-- AE pick-whip: drag onto another layer row to parent. -->
                    <button
                      type="button"
                      class="flex size-5 shrink-0 cursor-default items-center justify-center rounded-none transition-colors"
                      :class="pickWhip?.childId === layer.id
                        ? 'bg-accent text-on-accent'
                        : 'text-neutral-subtle hover:bg-[var(--s-inset-hover)] hover:text-neutral-strong'"
                      aria-label="Pick whip: drag onto a layer to parent"
                      title="Drag onto a layer to parent"
                      @pointerdown.stop.prevent="startPickWhip(layer.id, $event)"
                    >
                      <StudioIcon name="pickwhip" />
                    </button>
                    <div class="relative min-w-0 flex-1">
                      <select
                        class="h-6 w-full cursor-default appearance-none truncate rounded-none bg-transparent py-0 pr-5 pl-1.5 text-xs outline-none transition-colors hover:bg-[var(--s-inset-hover)]"
                        :class="layer.parent ? 'text-neutral-strong' : 'text-neutral-weak'"
                        :value="layer.parent ?? ''"
                        @change="emit('set-parent', layer.id, ($event.target as HTMLSelectElement).value || null); ($event.target as HTMLSelectElement).blur()"
                      >
                        <option v-for="opt in parentOptionsFor(layer)" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                      </select>
                      <svg width="7" height="5" viewBox="0 0 7 5" class="pointer-events-none absolute top-1/2 right-[5px] -translate-y-1/2 text-[var(--s-dim)]" aria-hidden="true"><path d="M0 0h7L3.5 5z" fill="currentColor" /></svg>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-for="row in rowsForLayer(layer)"
                :key="row.key"
                class="flex h-6 w-full cursor-default items-center gap-0.5 border-t border-[var(--s-frame)] px-1 select-none transition-colors"
                :class="isRowSelected(row) ? 'bg-[var(--s-raise)]' : row.kind !== 'property' ? 'bg-[var(--s-tile)] hover:bg-[var(--s-inset-hover)]' : 'hover:bg-[var(--s-inset-hover)]'"
                @click="onPropertyRowClick(row, $event)"
              >
                <!-- AE keyframe navigator: ◂ previous · ◆ add/remove · next ▸ -->
                <div class="flex w-[60px] shrink-0 items-center justify-center" data-drag-exclude>
                  <template v-if="trackEnabled(row.owner, row.def.name)">
                    <button
                      type="button"
                      class="flex size-5 items-center justify-center rounded text-neutral-subtle transition-colors hover:text-neutral-strong disabled:opacity-25"
                      :disabled="!hasKeyBefore(row.owner, row.def.name)"
                      aria-label="Previous keyframe"
                      @pointerdown.stop
                      @click.stop="jumpToKey(row.owner, row.def.name, -1)"
                    ><StudioIcon name="key-prev" /></button>
                    <UiKeyframeButton
                      :active="isKeyedAtPlayhead(row.owner, row.def.name)"
                      @toggle="onRowKeyframe(row)"
                    />
                    <button
                      type="button"
                      class="flex size-5 items-center justify-center rounded text-neutral-subtle transition-colors hover:text-neutral-strong disabled:opacity-25"
                      :disabled="!hasKeyAfter(row.owner, row.def.name)"
                      aria-label="Next keyframe"
                      @pointerdown.stop
                      @click.stop="jumpToKey(row.owner, row.def.name, 1)"
                    ><StudioIcon name="key-next" /></button>
                  </template>
                </div>
                <!-- Tree indent: one chevron width (20px) per level, AE-style:
                     layer chevron → property chevron → stopwatch / axis label. -->
                <div class="flex min-w-0 flex-1 items-center gap-0.5 pr-1" :class="row.kind === 'property' ? 'pl-5' : 'pl-10'">
                  <button
                    v-if="row.kind === 'property' && row.def.name === POSITION_GROUP"
                    type="button"
                    data-drag-exclude
                    class="flex size-5 shrink-0 items-center justify-center rounded-none text-neutral-subtle transition-colors hover:text-neutral-strong"
                    :title="axisRowsOpen.has(row.owner) ? 'Hide X / Y' : 'Show X / Y separately'"
                    @pointerdown.stop
                    @click.stop="toggleAxisRows(row.owner)"
                  >
                    <ChevronRightIcon class="size-3 transition-transform" :class="axisRowsOpen.has(row.owner) && 'rotate-90'" />
                  </button>
                  <span v-else-if="row.kind === 'property'" class="w-5 shrink-0" />
                  <UiStopwatchButton
                    v-if="row.kind !== 'axis'"
                    data-drag-exclude
                    :active="trackEnabled(row.owner, row.def.name)"
                    @toggle="onRowStopwatch(row)"
                  />
                  <button
                    v-if="row.kind === 'link'"
                    type="button"
                    data-drag-exclude
                    class="flex size-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--s-inset-hover)]"
                    :title="`Edit ${row.prefix}`"
                    @pointerdown.stop
                    @click.stop="emit('select-modulator', row.link!.sourceId)"
                  >
                    <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" />
                  </button>
                  <span
                    class="min-w-0 flex-1 truncate text-copy-xs text-neutral-subtle"
                    :style="row.kind === 'axis' ? { color: row.color } : undefined"
                  >
                    {{ row.def.label }}
                  </span>
                  <button
                    v-if="row.kind === 'property' && isModulated(row.owner, row.def.name)"
                    type="button"
                    data-drag-exclude
                    class="flex h-4 shrink-0 items-center gap-0.5 rounded-full px-1 transition-colors hover:bg-[var(--s-inset-hover)]"
                    :class="isLinkRowsOpen(row.owner, row.def.name) && 'bg-[var(--s-inset)]'"
                    :title="`${modTitle(propertyModSources(row.owner, row.def.name)).replace(' — click to edit', '')} — click to show links`"
                    @pointerdown.stop
                    @click.stop="toggleLinkRows(row.owner, row.def.name)"
                  >
                    <span
                      v-for="src in propertyModSources(row.owner, row.def.name)"
                      :key="src.id"
                      class="size-1.5 shrink-0 rounded-full"
                      :style="{ backgroundColor: src.color }"
                    />
                  </button>
                </div>
                <!-- Linked Position: one scrubbable number per axis (AE style). -->
                <!-- Value column: left-aligned, blue (AE). -->
                <div class="flex w-24 shrink-0 items-center">
                <div v-if="row.def.name === POSITION_GROUP" class="flex items-center pl-0.5">
                  <template v-for="(axis, ai) in positionAxisRows(row)" :key="axis.key">
                    <span v-if="ai > 0" class="text-copy-xs text-neutral-subtle/50">,</span>
                    <input
                      v-if="isEditingValue(axis.key)"
                      :ref="focusValueInput"
                      v-model="editingValue!.text"
                      data-drag-exclude
                      class="w-12 shrink-0 rounded-none bg-[var(--s-inset)] px-1 text-left tabular-nums text-[var(--s-bright)] outline-none shadow-[inset_0_0_0_1px_var(--s-ring)]"
                      spellcheck="false"
                      @keydown.enter.stop.prevent="commitValueEditor(axis)"
                      @keydown.esc.stop.prevent="cancelValueEditor"
                      @keydown.stop
                      @blur="commitValueEditor(axis)"
                      @pointerdown.stop
                    />
                    <span
                      v-else
                      data-drag-exclude
                      class="shrink-0 cursor-ew-resize rounded-none px-0.5 tabular-nums text-[var(--s-value)] hover:bg-[var(--s-inset-hover)] hover:text-[var(--s-bright)]"
                      :title="`${axis.def.label}: drag to scrub, click to type (⇧ fine)`"
                      @pointerdown.stop.prevent="onValuePointerDown(axis, $event)"
                    >
                      {{ formatRowValue(axis) }}
                    </span>
                  </template>
                </div>
                <input
                  v-else-if="isEditingValue(row.key)"
                  :ref="focusValueInput"
                  v-model="editingValue!.text"
                  data-drag-exclude
                  class="w-16 shrink-0 rounded-none bg-[var(--s-inset)] px-1 text-left tabular-nums text-[var(--s-bright)] outline-none shadow-[inset_0_0_0_1px_var(--s-ring)]"
                  spellcheck="false"
                  @keydown.enter.stop.prevent="commitValueEditor(row)"
                  @keydown.esc.stop.prevent="cancelValueEditor"
                  @keydown.stop
                  @blur="commitValueEditor(row)"
                  @pointerdown.stop
                />
                <span
                  v-else
                  data-drag-exclude
                  class="shrink-0 rounded-none px-1 tabular-nums text-[var(--s-value)] hover:bg-[var(--s-inset-hover)] hover:text-[var(--s-bright)]"
                  :class="row.def.type === 'bool' ? 'cursor-default' : 'cursor-ew-resize'"
                  :title="row.def.type === 'bool' ? 'Click to toggle' : 'Drag to scrub, click to type (⇧ fine)'"
                  @pointerdown.stop.prevent="onValuePointerDown(row, $event)"
                >
                  {{ formatRowValue(row) }}
                </span>
                </div>
              </div>
            </div>
            <div v-if="modulatorEntries.length" class="border-t border-[var(--s-frame)]">
              <div class="flex h-7 items-center gap-1 border-b border-[var(--s-frame)] bg-[var(--s-tile)] px-1 select-none">
                <button
                  type="button"
                  class="flex size-5 shrink-0 items-center justify-center rounded-none text-neutral-subtle hover:text-neutral-strong"
                  :title="modGroupOpen ? 'Collapse modulators' : 'Expand modulators'"
                  @click.stop="modGroupOpen = !modGroupOpen"
                >
                  <ChevronRightIcon class="size-3.5 transition-transform" :class="modGroupOpen && 'rotate-90'" />
                </button>
                <span class="min-w-0 flex-1 truncate text-copy-sm text-neutral-subtle">Modulators</span>
                <span class="flex gap-0.5 pr-1">
                  <span
                    v-for="entry in modulatorEntries"
                    :key="entry.source.id"
                    class="size-1.5 rounded-full"
                    :style="{ backgroundColor: entry.source.color }"
                  />
                </span>
              </div>
              <template v-if="modGroupOpen">
                <template v-for="entry in modulatorEntries" :key="entry.source.id">
                  <div class="flex h-6 w-full items-center gap-1 border-t border-[var(--s-frame)] px-1 pl-4 select-none">
                    <button
                      type="button"
                      class="flex size-4 shrink-0 items-center justify-center text-neutral-subtle hover:text-neutral-strong"
                      @click.stop="toggleSourceRows(entry.source.id)"
                    >
                      <ChevronRightIcon
                        class="size-3 transition-transform"
                        :class="sourceRowsOpen.has(entry.source.id) && 'rotate-90'"
                      />
                    </button>
                    <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: entry.source.color }" />
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left text-copy-xs text-neutral-subtle hover:text-neutral-strong"
                      :title="`Edit ${entry.source.label}`"
                      @click.stop="emit('select-modulator', entry.source.id)"
                    >
                      {{ entry.source.label }}
                    </button>
                    <span class="shrink-0 pr-1 text-copy-xs text-neutral-subtle/60">
                      {{ entry.kind === "lfo" ? "LFO" : "Envelope" }}
                    </span>
                  </div>
                  <template v-if="sourceRowsOpen.has(entry.source.id)">
                    <div
                      v-for="row in sourceRows(entry)"
                      :key="row.key"
                      class="flex h-6 w-full cursor-default items-center gap-0.5 border-t border-[var(--s-frame)] px-1 select-none"
                      :class="row.kind !== 'property' && 'bg-[var(--s-tile)]'"
                    >
                      <div class="flex w-[60px] shrink-0 items-center justify-center">
                        <UiKeyframeButton
                          v-if="trackEnabled(row.owner, row.def.name)"
                          data-drag-exclude
                          :active="isKeyedAtPlayhead(row.owner, row.def.name)"
                          @toggle="onRowKeyframe(row)"
                        />
                      </div>
                      <div class="flex min-w-0 flex-1 items-center gap-0.5 px-1" :class="row.kind !== 'property' && 'pl-3'">
                        <UiStopwatchButton
                          data-drag-exclude
                          :active="trackEnabled(row.owner, row.def.name)"
                          @toggle="onRowStopwatch(row)"
                        />
                        <button
                          v-if="row.kind === 'link'"
                          type="button"
                          data-drag-exclude
                          class="flex size-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--s-inset-hover)]"
                          :title="`Edit ${row.prefix}`"
                          @pointerdown.stop
                          @click.stop="emit('select-modulator', row.link!.sourceId)"
                        >
                          <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" />
                        </button>
                        <span class="min-w-0 flex-1 truncate text-copy-xs text-neutral-subtle">
                          {{ row.def.label }}
                        </span>
                        <button
                          v-if="row.kind === 'property' && isModulated(row.owner, row.def.name)"
                          type="button"
                          data-drag-exclude
                          class="flex h-4 shrink-0 items-center gap-0.5 rounded-full px-1 transition-colors hover:bg-[var(--s-inset-hover)]"
                          :class="isLinkRowsOpen(row.owner, row.def.name) && 'bg-[var(--s-inset)]'"
                          :title="`${modTitle(propertyModSources(row.owner, row.def.name)).replace(' — click to edit', '')} — click to show links`"
                          @pointerdown.stop
                          @click.stop="toggleLinkRows(row.owner, row.def.name)"
                        >
                          <span
                            v-for="src in propertyModSources(row.owner, row.def.name)"
                            :key="src.id"
                            class="size-1.5 shrink-0 rounded-full"
                            :style="{ backgroundColor: src.color }"
                          />
                        </button>
                      </div>
                      <div class="flex w-24 shrink-0 items-center">
                      <input
                        v-if="isEditingValue(row.key)"
                        :ref="focusValueInput"
                        v-model="editingValue!.text"
                        data-drag-exclude
                        class="w-16 shrink-0 rounded-none bg-[var(--s-inset)] px-1 text-left tabular-nums text-[var(--s-bright)] outline-none shadow-[inset_0_0_0_1px_var(--s-ring)]"
                        spellcheck="false"
                        @keydown.enter.stop.prevent="commitValueEditor(row)"
                        @keydown.esc.stop.prevent="cancelValueEditor"
                        @keydown.stop
                        @blur="commitValueEditor(row)"
                        @pointerdown.stop
                      />
                      <span
                        v-else
                        data-drag-exclude
                        class="shrink-0 rounded-none px-1 tabular-nums text-[var(--s-value)] hover:bg-[var(--s-inset-hover)] hover:text-[var(--s-bright)]"
                        :class="row.def.type === 'bool' ? 'cursor-default' : 'cursor-ew-resize'"
                        :title="row.def.type === 'bool' ? 'Click to toggle' : 'Drag to scrub, click to type (⇧ fine)'"
                        @pointerdown.stop.prevent="onValuePointerDown(row, $event)"
                      >
                        {{ formatRowValue(row) }}
                      </span>
                      </div>
                    </div>
                  </template>
                </template>
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
                v-show="layerMatchesSearch(layer)"
                :key="`t-${layer.id}`"
                class="layer-group"
                :class="!layer.enabled && 'opacity-50'"
              >
                <div class="relative h-7 border-b border-[var(--s-frame)] bg-[var(--s-inset)]">
                  <div
                    class="group/bar absolute inset-y-0 cursor-default rounded-none transition-colors"
                    :class="selectedLayerIds.has(layer.id)
                      ? 'bg-[var(--s-fill)] ring-1 ring-inset ring-[var(--s-select)]'
                      : 'bg-[var(--s-raise)] hover:bg-[#56565c]'"
                    :style="layerBarStyle(layer)"
                    :title="`${layerInPoint(layer).toFixed(2)}s – ${layerOutPoint(layer).toFixed(2)}s (double-click to reset)`"
                    @pointerdown.stop.prevent="onLayerBarPointerDown(layer, 'move', $event)"
                    @dblclick.stop="resetLayerTiming(layer)"
                  >
                    <div
                      v-if="layerModSources(layer).length"
                      class="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 gap-0.5"
                      :title="modTitle(layerModSources(layer))"
                    >
                      <span
                        v-for="src in layerModSources(layer)"
                        :key="src.id"
                        class="size-1.5 rounded-full ring-1 ring-black/30"
                        :style="{ backgroundColor: src.color }"
                      />
                    </div>
                    <div
                      class="absolute inset-y-0 left-0 flex w-2 cursor-ew-resize items-center justify-center rounded-none bg-white/10 opacity-0 transition-opacity group-hover/bar:opacity-100"
                      @pointerdown.stop.prevent="onLayerBarPointerDown(layer, 'in', $event)"
                    >
                      <div class="h-3 w-0.5 rounded-full bg-white/60" />
                    </div>
                    <div
                      class="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center rounded-none bg-white/10 opacity-0 transition-opacity group-hover/bar:opacity-100"
                      @pointerdown.stop.prevent="onLayerBarPointerDown(layer, 'out', $event)"
                    >
                      <div class="h-3 w-0.5 rounded-full bg-white/60" />
                    </div>
                  </div>
                </div>

                <div
                  v-for="row in rowsForLayer(layer)"
                  :key="`t-${row.key}`"
                  class="relative h-6 border-b border-[var(--s-frame)] select-none"
                  :class="row.kind !== 'property' && 'bg-[var(--s-tile)]'"
                >
                  <svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                    <template v-if="row.kind === 'property' && modulationCurve(row.owner, row.def.name)">
                      <path
                        :d="modulationCurve(row.owner, row.def.name)!.base"
                        fill="none"
                        class="stroke-white/15"
                        stroke-width="1"
                        stroke-dasharray="2 2"
                      />
                      <path
                        :d="modulationCurve(row.owner, row.def.name)!.mod"
                        fill="none"
                        :stroke="modulationCurve(row.owner, row.def.name)!.color"
                        stroke-opacity="0.85"
                        stroke-width="1.25"
                        stroke-linejoin="round"
                      />
                    </template>
                    <template v-else-if="row.def.type === 'bool'">
                      <rect
                        v-for="(span, si) in onRanges(row)"
                        :key="`on-${si}`"
                        :x="span.x"
                        :width="span.w"
                        y="7"
                        height="10"
                        rx="2"
                        :fill="row.color"
                        fill-opacity="0.22"
                      />
                    </template>
                    <template v-else>
                      <path
                        v-for="(seg, si) in segmentPaths(row.owner, row.def.name)"
                        :key="`s-${si}`"
                        :d="seg.d"
                        fill="none"
                        :class="!(seg.color || row.color) && 'stroke-accent/40'"
                        :stroke="seg.color ?? row.color"
                        :stroke-opacity="seg.color ? 0.75 : row.color ? 0.6 : undefined"
                        stroke-width="1.5"
                      />
                    </template>
                  </svg>
                  <EditorTimelineKeyStrip
                    :keys="rowKeys(row.owner, row.def.name)"
                    :label="row.prefix ? `${row.prefix} ${row.def.label}` : row.def.label"
                    :left="keyLeft"
                    :is-selected="(t: number) => isKeyframeSelected(row.owner, row.def.name, t)"
                    :at-playhead="isKeyframeAtPlayhead"
                    :easing-id="(t: number) => keyframeEasingId(row.owner, row.def.name, t)"
                    @key-pointerdown="(t: number, e: PointerEvent) => onKeyframePointerDown(row.owner, row.def.name, t, e)"
                    @apply-easing="(t: number, easing: KeyframeEasing | CubicBezierEase) => applyKeyframeEasing(row.owner, row.def.name, t, easing)"
                  />
                </div>
              </div>
              <div v-if="modulatorEntries.length" class="border-t border-[var(--s-frame)]">
                <div class="relative h-7 border-b border-[var(--s-frame)] bg-[var(--s-inset)]" />
                <template v-if="modGroupOpen">
                  <template v-for="entry in modulatorEntries" :key="`t-${entry.source.id}`">
                    <div class="relative h-6 border-b border-[var(--s-frame)]">
                      <svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                        <path
                          :d="sourceCurves.get(entry.source.id)"
                          fill="none"
                          :stroke="entry.source.color"
                          stroke-opacity="0.85"
                          stroke-width="1.25"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </div>
                    <template v-if="sourceRowsOpen.has(entry.source.id)">
                      <div
                        v-for="row in sourceRows(entry)"
                        :key="`t-${row.key}`"
                        class="relative h-6 border-b border-[var(--s-frame)] select-none"
                        :class="row.kind !== 'property' && 'bg-[var(--s-tile)]'"
                      >
                        <svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                          <template v-if="row.kind === 'property' && modulationCurve(row.owner, row.def.name)">
                            <path
                              :d="modulationCurve(row.owner, row.def.name)!.base"
                              fill="none"
                              class="stroke-white/15"
                              stroke-width="1"
                              stroke-dasharray="2 2"
                            />
                            <path
                              :d="modulationCurve(row.owner, row.def.name)!.mod"
                              fill="none"
                              :stroke="modulationCurve(row.owner, row.def.name)!.color"
                              stroke-opacity="0.85"
                              stroke-width="1.25"
                              stroke-linejoin="round"
                            />
                          </template>
                          <template v-else-if="row.def.type === 'bool'">
                            <rect
                              v-for="(span, si) in onRanges(row)"
                              :key="`on-${si}`"
                              :x="span.x"
                              :width="span.w"
                              y="7"
                              height="10"
                              rx="2"
                              :fill="row.color"
                              fill-opacity="0.22"
                            />
                          </template>
                          <template v-else>
                            <path
                              v-for="(seg, si) in segmentPaths(row.owner, row.def.name)"
                              :key="`s-${si}`"
                              :d="seg.d"
                              fill="none"
                              :class="!(seg.color || row.color) && 'stroke-accent/40'"
                              :stroke="seg.color ?? row.color"
                              :stroke-opacity="seg.color ? 0.75 : row.color ? 0.6 : undefined"
                              stroke-width="1.5"
                            />
                          </template>
                        </svg>
                        <EditorTimelineKeyStrip
                          :keys="rowKeys(row.owner, row.def.name)"
                          :label="row.prefix ? `${row.prefix} ${row.def.label}` : row.def.label"
                          :left="keyLeft"
                          :is-selected="(t: number) => isKeyframeSelected(row.owner, row.def.name, t)"
                          :at-playhead="isKeyframeAtPlayhead"
                          :easing-id="(t: number) => keyframeEasingId(row.owner, row.def.name, t)"
                          @key-pointerdown="(t: number, e: PointerEvent) => onKeyframePointerDown(row.owner, row.def.name, t, e)"
                          @apply-easing="(t: number, easing: KeyframeEasing | CubicBezierEase) => applyKeyframeEasing(row.owner, row.def.name, t, easing)"
                        />
                      </div>
                    </template>
                  </template>
                </template>
              </div>
            </div>

            <div
              v-if="marquee"
              class="pointer-events-none absolute z-30 border border-accent/80 bg-accent/10"
              :style="marqueeStyle"
            />

            <div
              v-if="snapGuideTime !== null"
              class="pointer-events-none absolute -top-px bottom-0 z-30 w-px -translate-x-1/2"
              :style="{
                left: `${snapGuideTime * pxPerSecond}px`,
                backgroundColor: TIMELINE_GUIDE_COLOR,
              }"
            />

            <!-- Drilled into a nested comp: dim what the parent does NOT show (Live-style). -->
            <template v-if="usedRange">
              <div
                class="pointer-events-none absolute -top-px bottom-0 left-0 z-[5] bg-black/40"
                :style="{ width: `${Math.max(0, timeToX(usedRange.start))}px` }"
              />
              <div
                class="pointer-events-none absolute -top-px right-0 bottom-0 z-[5] bg-black/40"
                :style="{ left: `${timeToX(usedRange.end)}px` }"
              />
            </template>
            <div
              class="pointer-events-none absolute -top-px bottom-0 z-10 w-px -translate-x-1/2 bg-playhead"
              :style="{ left: `${playheadX}px` }"
            />
          </div>
        </div>
      </div>
      <!-- Pick-whip line while dragging -->
      <svg v-if="pickWhip" class="pointer-events-none fixed inset-0 z-[200] size-full">
        <line
          :x1="pickWhip.x0" :y1="pickWhip.y0" :x2="pickWhip.x" :y2="pickWhip.y"
          class="stroke-accent" stroke-width="1.5" stroke-dasharray="4 3"
        />
        <circle :cx="pickWhip.x" :cy="pickWhip.y" r="3" class="fill-accent" />
      </svg>
      <!-- Bottom bar: zoom under the time area (AE). -->
      <div class="flex h-8 shrink-0 border-t border-[var(--s-frame)] bg-[var(--s-tile)]">
        <div class="shrink-0 border-r border-[var(--s-frame)]" :style="{ width: `${labelWidth}px` }" />
        <div class="flex min-w-0 flex-1 items-center gap-1 px-2">
          <StudioButton variant="ghost" square aria-label="Zoom out" @click="zoomOut"><StudioIcon name="minus" /></StudioButton>
          <StudioSlider v-model="zoomSlider" :min="0" :max="1" class="w-[120px]" aria-label="Timeline zoom" />
          <StudioButton variant="ghost" square aria-label="Zoom in" @click="zoomIn"><StudioIcon name="plus" /></StudioButton>
          <StudioButton title="Fit comp to width (⇧Z)" @click="fitTimeline"><StudioIcon name="fit" /> Fit</StudioButton>
          <span class="ml-auto text-xs text-neutral-weak tabular-nums">{{ formatTime(settings.duration) }} · {{ settings.fps }} fps</span>
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
