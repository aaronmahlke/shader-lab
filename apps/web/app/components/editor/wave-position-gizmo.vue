<script setup lang="ts">
import {
  clientToShaderNorm,
  dragWaveGizmo,
  hitWaveGizmoHandle,
  WAVE_GIZMO_STEPS,
  waveGizmoVisualCycleWidth,
  waveGizmoVisualHalfWidth,
  waveShaderYToCssPercent,
  type DragMode,
  type WaveGizmoRanges,
  type WaveGizmoValues,
} from "#shared/editor/wave-position";

type Props = {
  cycleX: number;
  centerY: number;
  amplitude: number;
  cycleWidth: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  ampMin: number;
  ampMax: number;
  widthMin: number;
  widthMax: number;
  /** Viewport zoom of the scaled artboard; keeps gizmo chrome constant on screen. */
  zoom?: number;
};

type Emits = {
  "update:cycleX": [value: number];
  "update:centerY": [value: number];
  "update:amplitude": [value: number];
  "update:cycleWidth": [value: number];
};

const {
  cycleX,
  centerY,
  amplitude,
  cycleWidth,
  xMin,
  xMax,
  yMin,
  yMax,
  ampMin,
  ampMax,
  widthMin,
  widthMax,
  zoom = 1,
} = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Inverse zoom: the artboard is CSS-scaled, so chrome divides by zoom to stay constant. */
const gz = computed(() => 1 / Math.max(zoom, 0.0001));

const ringBorderStyle = computed(() => ({ borderWidth: `${gz.value}px` }));
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
const dragMode = ref<DragMode | null>(null);
const moveOffset = ref<{ x: number; y: number } | null>(null);
const dragStart = ref<WaveGizmoValues | null>(null);

const values = computed<WaveGizmoValues>(() => ({
  cycleX,
  centerY,
  amplitude,
  cycleWidth,
}));

const ranges = computed<WaveGizmoRanges>(() => ({
  xMin,
  xMax,
  yMin,
  yMax,
  xStep: WAVE_GIZMO_STEPS.position,
  yStep: WAVE_GIZMO_STEPS.position,
  ampMin,
  ampMax,
  ampStep: WAVE_GIZMO_STEPS.amplitude,
  widthMin,
  widthMax,
  widthStep: WAVE_GIZMO_STEPS.cycleWidth,
}));

const centerStyle = computed(() => ({
  left: `${cycleX * 100}%`,
  top: `${waveShaderYToCssPercent(centerY)}%`,
}));

const ellipseStyle = computed(() => ({
  left: `${cycleX * 100}%`,
  top: `${waveShaderYToCssPercent(centerY)}%`,
  width: `${waveGizmoVisualCycleWidth(cycleWidth) * 100}%`,
  height: `${amplitude * 2 * 100}%`,
}));

const CARDINAL_HANDLES = ["n", "s", "e", "w"] as const;

const handleStyles = computed(() => ({
  n: {
    left: `${cycleX * 100}%`,
    top: `${waveShaderYToCssPercent(centerY + amplitude)}%`,
  },
  s: {
    left: `${cycleX * 100}%`,
    top: `${waveShaderYToCssPercent(centerY - amplitude)}%`,
  },
  e: {
    left: `${(cycleX + waveGizmoVisualHalfWidth(cycleWidth)) * 100}%`,
    top: `${waveShaderYToCssPercent(centerY)}%`,
  },
  w: {
    left: `${(cycleX - waveGizmoVisualHalfWidth(cycleWidth)) * 100}%`,
    top: `${waveShaderYToCssPercent(centerY)}%`,
  },
}));

const DRAG_CURSOR: Record<DragMode, string> = {
  move: "cursor-grab",
  n: "cursor-ns-resize",
  s: "cursor-ns-resize",
  e: "cursor-ew-resize",
  w: "cursor-ew-resize",
};

const stageCursor = computed(() => {
  if (!dragMode.value) return "cursor-grab";
  return dragMode.value === "move" ? "cursor-grabbing" : DRAG_CURSOR[dragMode.value];
});

function emitValues(next: WaveGizmoValues) {
  if (next.cycleX !== cycleX) emit("update:cycleX", next.cycleX);
  if (next.centerY !== centerY) emit("update:centerY", next.centerY);
  if (next.amplitude !== amplitude) emit("update:amplitude", next.amplitude);
  if (next.cycleWidth !== cycleWidth) emit("update:cycleWidth", next.cycleWidth);
}

function pointerNorm(clientX: number, clientY: number) {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return null;
  return clientToShaderNorm(clientX, clientY, rect);
}

function applyDrag(clientX: number, clientY: number, shiftKey: boolean) {
  const mode = dragMode.value;
  if (!mode) return;

  const norm = pointerNorm(clientX, clientY);
  if (!norm) return;

  const target =
    mode === "move" && moveOffset.value
      ? { x: norm.x - moveOffset.value.x, y: norm.y - moveOffset.value.y }
      : norm;

  emitValues(
    dragWaveGizmo(mode, target, values.value, ranges.value, {
      proportional: shiftKey && mode !== "move",
      dragStart: dragStart.value ?? values.value,
    }),
  );
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();

  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return;

  const norm = clientToShaderNorm(e.clientX, e.clientY, rect);
  if (!norm) return;

  dragMode.value = hitWaveGizmoHandle(norm, rect, values.value);
  dragStart.value = { ...values.value };
  history?.beginGesture();
  if (dragMode.value === "move") {
    moveOffset.value = { x: norm.x - cycleX, y: norm.y - centerY };
  } else {
    moveOffset.value = null;
  }
  stageRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragMode.value) return;
  applyDrag(e.clientX, e.clientY, e.shiftKey);
}

function onPointerUp(e: PointerEvent) {
  if (!dragMode.value) return;
  history?.commitGesture();
  dragMode.value = null;
  moveOffset.value = null;
  dragStart.value = null;
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
    aria-label="Drag to adjust wave position and size"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div
      class="pointer-events-none absolute rounded-[50%] border border-gizmo-ring"
      :style="[ellipseStyle, ringBorderStyle]"
      style="transform: translate(-50%, -50%)"
      aria-hidden="true"
    />

    <div
      v-for="cardinal in CARDINAL_HANDLES"
      :key="cardinal"
      class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      :style="[handleStyles[cardinal], handleSizeStyle]"
      aria-hidden="true"
    >
      <div class="absolute inset-0 rounded-full bg-gizmo-handle-outer shadow-sm" />
      <div class="absolute rounded-full bg-gizmo-handle shadow-sm" :style="handleInnerStyle" />
    </div>

    <div
      class="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      :class="dragMode === 'move' && 'scale-110'"
      :style="[centerStyle, centerSizeStyle]"
      aria-hidden="true"
    >
      <div class="absolute inset-0 rounded-full bg-gizmo-handle-outer" />
      <div class="relative rounded-full bg-gizmo-handle shadow-sm" :style="centerDotStyle" />
    </div>
  </div>
</template>
