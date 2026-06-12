<script setup lang="ts">
import type { MeshPoint } from "#shared/types/mesh";
import {
  aspectRatio,
  clientToShaderNorm,
  dragMeshPoints,
  hitMeshGizmoHandle,
  meshGizmoRadiusSize,
  meshShaderYToCssPercent,
  MESH_GIZMO_STEPS,
  type MeshDragTarget,
  type MeshGizmoRanges,
} from "#shared/editor/mesh-position";

type Props = {
  points: MeshPoint[];
  selectedIndex: number;
  radiusMin: number;
  radiusMax: number;
};

type Emits = {
  "update:points": [value: MeshPoint[]];
  "update:selectedIndex": [index: number];
};

const { points, selectedIndex, radiusMin, radiusMax } = defineProps<Props>();
const emit = defineEmits<Emits>();

const stageRef = ref<HTMLElement | null>(null);
const dragTarget = ref<MeshDragTarget | null>(null);
const moveOffset = ref<{ x: number; y: number } | null>(null);

const ranges = computed<MeshGizmoRanges>(() => ({
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 1,
  xStep: MESH_GIZMO_STEPS.position,
  yStep: MESH_GIZMO_STEPS.position,
  radiusMin,
  radiusMax,
  radiusStep: MESH_GIZMO_STEPS.radius,
}));

const stageCursor = computed(() => {
  if (!dragTarget.value) return "";
  return dragTarget.value.kind === "move" ? "cursor-grabbing" : "cursor-grab";
});

function pointCenterStyle(point: MeshPoint) {
  return {
    left: `${point.x * 100}%`,
    top: `${meshShaderYToCssPercent(point.y)}%`,
  };
}

function pointRingStyle(point: MeshPoint, index: number) {
  const rect = stageRef.value?.getBoundingClientRect();
  const aspect = rect ? aspectRatio(rect) : 1;
  const size = meshGizmoRadiusSize(point.radius, aspect);
  return {
    left: `${point.x * 100}%`,
    top: `${meshShaderYToCssPercent(point.y)}%`,
    width: `${size.widthPct}%`,
    height: `${size.heightPct}%`,
    borderColor: point.color,
    opacity: index === selectedIndex ? 0.7 : 0.35,
  };
}

function emitPoints(next: MeshPoint[]) {
  emit("update:points", next);
}

function pointerNorm(clientX: number, clientY: number) {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return null;
  return clientToShaderNorm(clientX, clientY, rect);
}

function applyDrag(clientX: number, clientY: number) {
  const target = dragTarget.value;
  if (!target) return;

  const rect = stageRef.value?.getBoundingClientRect();
  const norm = pointerNorm(clientX, clientY);
  if (!rect || !norm) return;

  const dragNorm =
    target.kind === "move" && moveOffset.value
      ? { x: norm.x - moveOffset.value.x, y: norm.y - moveOffset.value.y }
      : norm;

  emitPoints(
    dragMeshPoints(target, dragNorm, points, ranges.value, aspectRatio(rect)),
  );
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;

  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return;

  const norm = clientToShaderNorm(e.clientX, e.clientY, rect);
  if (!norm) return;

  const hit = hitMeshGizmoHandle(norm, rect, points);
  if (!hit) return;

  e.preventDefault();
  dragTarget.value = hit;
  emit("update:selectedIndex", hit.index);

  if (hit.kind === "move") {
    const p = points[hit.index]!;
    moveOffset.value = { x: norm.x - p.x, y: norm.y - p.y };
  } else {
    moveOffset.value = null;
  }

  stageRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragTarget.value) return;
  applyDrag(e.clientX, e.clientY);
}

function onPointerUp(e: PointerEvent) {
  if (!dragTarget.value) return;
  dragTarget.value = null;
  moveOffset.value = null;
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
    aria-label="Drag mesh color points"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <template
      v-for="(point, index) in points"
      :key="index"
    >
      <div
        class="pointer-events-none absolute rounded-[50%] border"
        :style="pointRingStyle(point, index)"
        style="transform: translate(-50%, -50%)"
        aria-hidden="true"
      />

      <div
        class="pointer-events-none absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
        :class="index === selectedIndex && dragTarget?.index === index && dragTarget?.kind === 'move' && 'scale-110'"
        :style="pointCenterStyle(point)"
        aria-hidden="true"
      >
        <div
          class="absolute inset-0 rounded-full"
          :style="{ backgroundColor: point.color, opacity: index === selectedIndex ? 0.35 : 0.2 }"
        />
        <div
          class="relative size-3 rounded-full border border-white/60 shadow-sm"
          :style="{ backgroundColor: point.color }"
        />
      </div>
    </template>
  </div>
</template>
