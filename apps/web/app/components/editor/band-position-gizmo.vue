<script setup lang="ts">
import {
  bandFeatherHalf,
  bandShaderYToCssPercent,
  BAND_GIZMO_STEPS,
  clientToShaderNorm,
  dragBandGizmo,
  hitBandGizmoHandle,
  type BandDragMode,
  type BandGizmoRanges,
  type BandGizmoValues,
} from "#shared/editor/band-position";

type Props = {
  bandY: number;
  edge: number;
  yMin: number;
  yMax: number;
  edgeMin: number;
  edgeMax: number;
  /** Viewport zoom of the scaled artboard; keeps gizmo chrome constant on screen. */
  zoom?: number;
};

type Emits = {
  "update:bandY": [value: number];
  "update:edge": [value: number];
};

const { bandY, edge, yMin, yMax, edgeMin, edgeMax, zoom = 1 } = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Inverse zoom: the artboard is CSS-scaled, so chrome divides by zoom to stay constant. */
const gz = computed(() => 1 / Math.max(zoom, 0.0001));

const rectBorderStyle = computed(() => ({ borderWidth: `${gz.value}px` }));
const handleSizeStyle = computed(() => ({
  width: `${10 * gz.value}px`,
  height: `${10 * gz.value}px`,
}));
const handleInnerStyle = computed(() => ({ inset: `${2 * gz.value}px` }));
const centerSizeStyle = computed(() => ({
  width: `${40 * gz.value}px`,
  height: `${40 * gz.value}px`,
}));
const centerDotStyle = computed(() => ({
  width: `${12 * gz.value}px`,
  height: `${12 * gz.value}px`,
}));

const history = useEditorHistory();
const stageRef = ref<HTMLElement | null>(null);
const dragMode = ref<BandDragMode | null>(null);
const moveOffsetY = ref<number | null>(null);

const values = computed<BandGizmoValues>(() => ({ bandY, edge }));

const ranges = computed<BandGizmoRanges>(() => ({
  yMin,
  yMax,
  yStep: BAND_GIZMO_STEPS.position,
  edgeMin,
  edgeMax,
  edgeStep: BAND_GIZMO_STEPS.edge,
}));

const featherHalf = computed(() => bandFeatherHalf(edge));

const rectStyle = computed(() => ({
  top: `${bandShaderYToCssPercent(bandY)}%`,
  height: `${featherHalf.value * 2 * 100}%`,
}));

const centerStyle = computed(() => ({
  top: `${bandShaderYToCssPercent(bandY)}%`,
}));

const handleStyles = computed(() => ({
  n: { top: `${bandShaderYToCssPercent(bandY + featherHalf.value)}%` },
  s: { top: `${bandShaderYToCssPercent(bandY - featherHalf.value)}%` },
}));

const DRAG_CURSOR: Record<BandDragMode, string> = {
  move: "cursor-grab",
  n: "cursor-ns-resize",
  s: "cursor-ns-resize",
};

const stageCursor = computed(() => {
  if (!dragMode.value) return "";
  return dragMode.value === "move" ? "cursor-grabbing" : DRAG_CURSOR[dragMode.value];
});

function emitValues(next: BandGizmoValues) {
  if (next.bandY !== bandY) emit("update:bandY", next.bandY);
  if (next.edge !== edge) emit("update:edge", next.edge);
}

function applyDrag(clientX: number, clientY: number) {
  const mode = dragMode.value;
  if (!mode) return;

  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return;

  const norm = clientToShaderNorm(clientX, clientY, rect);
  if (!norm) return;

  emitValues(dragBandGizmo(mode, norm, values.value, ranges.value, moveOffsetY.value));
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;

  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return;

  const norm = clientToShaderNorm(e.clientX, e.clientY, rect);
  if (!norm) return;

  const hit = hitBandGizmoHandle(norm, rect, values.value);
  if (!hit) return;

  e.preventDefault();
  dragMode.value = hit;
  history?.beginGesture();
  moveOffsetY.value = hit === "move" ? norm.y - bandY : null;
  stageRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragMode.value) return;
  applyDrag(e.clientX, e.clientY);
}

function onPointerUp(e: PointerEvent) {
  if (!dragMode.value) return;
  history?.commitGesture();
  dragMode.value = null;
  moveOffsetY.value = null;
  try {
    stageRef.value?.releasePointerCapture(e.pointerId);
  } catch {
    // ignore
  }
}
</script>

<template>
  <div
    ref="stageRef"
    class="absolute inset-0 z-10 touch-none select-none"
    :class="stageCursor"
    aria-label="Drag to adjust band position and edge feather"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div
      class="pointer-events-none absolute inset-x-0 border border-gizmo-ring"
      :style="[rectStyle, rectBorderStyle]"
      style="transform: translateY(-50%)"
      aria-hidden="true"
    />

    <div
      v-for="cardinal in (['n', 's'] as const)"
      :key="cardinal"
      class="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
      :style="[handleStyles[cardinal], handleSizeStyle]"
      aria-hidden="true"
    >
      <div class="absolute inset-0 rounded-full bg-gizmo-handle-outer shadow-sm" />
      <div class="absolute rounded-full bg-gizmo-handle shadow-sm" :style="handleInnerStyle" />
    </div>

    <div
      class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      :class="dragMode === 'move' && 'scale-110'"
      :style="[centerStyle, centerSizeStyle]"
      aria-hidden="true"
    >
      <div class="absolute inset-0 rounded-full bg-gizmo-handle-outer" />
      <div class="relative rounded-full bg-gizmo-handle shadow-sm" :style="centerDotStyle" />
    </div>
  </div>
</template>
