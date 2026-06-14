<script setup lang="ts">
import {
  ChevronRightIcon,
  PlayIcon,
  PauseIcon,
  MinusIcon,
  PlusIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@heroicons/vue/16/solid";
import { useEventListener } from "@vueuse/core";
import {
  EditorKeyboardPriority,
  useEditorKeyboard,
} from "~/composables/use-editor-keyboard";
import {
  LAYER_TEMPLATES,
  evaluatePropertyTrack,
  findPropertyTrack,
  hasKeyframeAt,
  isKeyframeableUniform,
  isPropertyTrackActive,
  offsetKeyframes,
  type CompositionSettings,
  type LayerInstance,
  type PropertyTrack,
} from "@shader-lab/core";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";
import { layerBlockOverlapsPrevious, layerHeaderBlockRole } from "#shared/editor/layer-block-radius";
import {
  isKeyframeInSelection,
  toggleKeyframeInSelection,
} from "#shared/editor/keyframe-selection";

type Emits = {
  "toggle-stopwatch": [layerId: string, paramName: string];
  "toggle-keyframe": [layerId: string, paramName: string];
  "duplicate-layer": [id: string];
  "remove-layer": [id: string];
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
/** Property value labels — frozen while scrubbing so the playhead stays responsive. */
const displayTime = ref(currentTime.value);
const zoomPercent = computed(() =>
  Math.round((pxPerSecond.value / DEFAULT_PX_PER_SECOND) * 100),
);

watch(currentTime, (t) => {
  if (!scrubbing.value) displayTime.value = t;
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
  return template.uniforms.filter(isKeyframeableUniform);
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  return `${s.toFixed(2)}s`;
}

function scrubFromEvent(e: PointerEvent) {
  currentTime.value = snapTime(timeFromPointerEvent(e));
}

function onRulerPointerDown(e: PointerEvent) {
  e.preventDefault();
  playing.value = false;
  selectedKeyframes.value = [];
  scrubbing.value = true;

  const captureEl = rulerScrollRef.value;
  captureEl?.setPointerCapture(e.pointerId);
  scrubFromEvent(e);

  function onMove(ev: PointerEvent) {
    const events = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [ev];
    scrubFromEvent(events[events.length - 1]!);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
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
  id: "timeline:reveal-keyframes",
  priority: EditorKeyboardPriority.timeline,
  handle(e) {
    if (e.key.toLowerCase() !== "u" || e.metaKey || e.ctrlKey || e.altKey) return false;
    toggleRevealKeyframes();
    return true;
  },
});

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
      <span class="text-copy-xs text-neutral-subtle">/ {{ formatTime(settings.duration) }}</span>
      <div class="ml-auto flex items-center gap-0.5">
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
          class="shrink-0 overflow-hidden border-r border-neutral bg-layer-1"
          :style="{ width: `${labelWidth}px` }"
        >
          <div ref="layerListRef" class="min-h-full">
            <div
              v-for="(layer, i) in layers"
              :key="layer.id"
              class="layer-group"
              :class="[
                !layer.enabled && 'opacity-50',
                draggingIndices.has(i) && 'relative z-50 scale-[1.01] shadow-lg',
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
                  @click="selectLayer(layer.id, $event)"
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
                  <span class="shrink-0 font-mono text-copy-xs text-neutral-subtle">
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
                <div class="h-7 border-b border-neutral/40 bg-layer-1/50" />

                <template v-for="def in visibleProperties(layer)" :key="`t-${layer.id}-${def.name}`">
                  <div
                    v-if="showPropertyRow(layer, def.name)"
                    class="relative h-6 border-b border-neutral/30 select-none"
                  >
                    <button
                      v-for="key in findPropertyTrack(tracks, layer.id, def.name)?.keys ?? []"
                      :key="`${layer.id}-${def.name}-${key.time}`"
                      type="button"
                      class="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-default border-0 bg-transparent p-0 outline-none"
                      :style="{ left: keyLeft(key.time) }"
                      :title="`${def.label} @ ${key.time.toFixed(2)}s`"
                      @pointerdown.stop.prevent="onKeyframePointerDown(layer.id, def.name, key.time, $event)"
                    >
                      <UiKeyframeDiamond
                        class="size-full"
                        :selected="isKeyframeSelected(layer.id, def.name, key.time)"
                        :at-playhead="isKeyframeAtPlayhead(key.time)"
                      />
                    </button>
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
