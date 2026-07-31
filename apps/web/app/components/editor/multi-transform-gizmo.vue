<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import type { LayerInstance } from "@shader-lab/core";
import {
  compUvToScreen,
  layerBoundsInCompUv,
  rotateAroundInCompUv,
  screenToCompUv,
  shortestAngleDelta,
  transformCenter,
  unionBounds,
  type LayerBounds,
  type LayerTransformValues,
  type Vec2,
} from "#shared/editor/layer-transform";
import { findSnap, type SnapTargets } from "#shared/editor/snapping";

/**
 * Group gizmo for multi-selection: an axis-aligned box around the union of
 * the selected layers' bounds. Move translates every layer, scale resizes
 * each about the group center, rotate spins each layer and orbits its
 * center — all through the keyframe-aware `applyParam` callback.
 */

type Props = {
  layers: LayerInstance[];
  getTransform: (layer: LayerInstance) => LayerTransformValues;
  applyParam: (layerId: string, paramName: string, value: number) => void;
  snapTargets?: SnapTargets;
  /** Topmost pickable layer at a comp UV point (click-to-collapse). */
  pickAt?: (uv: Vec2, aspect: number) => string | null;
};

type Emits = {
  /** Click without drag: collapse to (or shift-toggle) the clicked layer. */
  pick: [layerId: string, additive: boolean];
  "gesture-start": [];
  "gesture-end": [];
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const stageRef = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(stageRef);
const aspect = computed(() => (height.value > 0 ? width.value / height.value : 1));

const POSITION_LIMIT = 1;
const SCALE_MIN = 0;
const SCALE_MAX = 400;
const ROTATION_LIMIT = 360;
const SNAP_THRESHOLD_PX = 6;
const GUIDE_COLOR = "#FF5D8F";

const groupBounds = computed<LayerBounds | null>(() =>
  unionBounds(props.layers.map((l) => layerBoundsInCompUv(props.getTransform(l), aspect.value))),
);

function boundsCorners(b: LayerBounds): Vec2[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

const cornerPoints = computed(() => {
  const b = groupBounds.value;
  if (!b) return [];
  return boundsCorners(b).map((uv) => compUvToScreen(uv, width.value, height.value));
});

const polygonPoints = computed(() =>
  cornerPoints.value.map((p) => `${p.x},${p.y}`).join(" "),
);

const centerPoint = computed(() => {
  const b = groupBounds.value;
  if (!b) return { x: 0, y: 0 };
  return compUvToScreen({ x: b.centerX, y: b.centerY }, width.value, height.value);
});

const ROTATION_ZONE_OFFSET = 11;
const ROTATION_ZONE_RADIUS = 14;

const rotationZones = computed(() =>
  cornerPoints.value.map((corner) => {
    const dx = corner.x - centerPoint.value.x;
    const dy = corner.y - centerPoint.value.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: corner.x + (dx / len) * ROTATION_ZONE_OFFSET,
      y: corner.y + (dy / len) * ROTATION_ZONE_OFFSET,
    };
  }),
);

function resizeCursorFor(p: Vec2): string {
  const dx = p.x - centerPoint.value.x;
  const dy = p.y - centerPoint.value.y;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return "ew-resize";
  if (deg < 67.5) return "nwse-resize";
  if (deg < 112.5) return "ns-resize";
  return "nesw-resize";
}

function rotateCursorFor(zone: Vec2): string {
  const deg = Math.round(
    (Math.atan2(zone.y - centerPoint.value.y, zone.x - centerPoint.value.x) * 180) / Math.PI + 135,
  );
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'>` +
    `<g transform='rotate(${deg} 11 11)'>` +
    `<path d='M5.5 13 A 6.5 6.5 0 0 1 13 5.5' fill='none' stroke='black' stroke-width='4' stroke-linecap='round'/>` +
    `<path d='M5.5 13 A 6.5 6.5 0 0 1 13 5.5' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round'/>` +
    `<path d='M12.6 1.8 L17.4 5.5 L12.6 9.2 Z' fill='white' stroke='black' stroke-width='1.2'/>` +
    `<path d='M1.8 12.6 L5.5 17.4 L9.2 12.6 Z' fill='white' stroke='black' stroke-width='1.2'/>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 11 11, crosshair`;
}

// --- Dragging ---

type DragMode = "move" | "scale" | "rotate";

type LayerSnapshot = {
  id: string;
  values: LayerTransformValues;
  center: Vec2;
};

const dragMode = ref<DragMode | null>(null);
const activeGuides = ref<{ x: number | null; y: number | null }>({ x: null, y: null });
let snapshots: LayerSnapshot[] = [];
let startBounds: LayerBounds | null = null;
let startPointer: Vec2 | null = null;
let startDistance = 0;
let startAngle = 0;
let dragged = false;

function pointerCompUv(e: PointerEvent): Vec2 | null {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return screenToCompUv(
    { x: e.clientX - rect.left, y: e.clientY - rect.top },
    rect.width,
    rect.height,
  );
}

function aspectDistance(a: Vec2, b: Vec2): number {
  return Math.hypot((a.x - b.x) * aspect.value, a.y - b.y);
}

function screenAngle(p: Vec2, center: Vec2): number {
  return (Math.atan2(-(p.y - center.y), (p.x - center.x) * aspect.value) * 180) / Math.PI;
}

function onHandlePointerDown(mode: DragMode, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const uv = pointerCompUv(e);
  const bounds = groupBounds.value;
  if (!uv || !bounds) return;

  dragMode.value = mode;
  dragged = false;
  startPointer = uv;
  startBounds = { ...bounds };
  snapshots = props.layers.map((layer) => {
    const values = props.getTransform(layer);
    return { id: layer.id, values, center: transformCenter(values) };
  });
  const groupCenter = { x: bounds.centerX, y: bounds.centerY };
  startDistance = Math.max(aspectDistance(uv, groupCenter), 1e-4);
  startAngle = screenAngle(uv, groupCenter);

  emit("gesture-start");
  if (mode === "move") {
    document.body.style.cursor = "move";
  } else if (e.target instanceof Element) {
    document.body.style.cursor = getComputedStyle(e.target).cursor;
  }

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function clampPos(v: number): number {
  return Math.min(POSITION_LIMIT, Math.max(-POSITION_LIMIT, Number(v.toFixed(6))));
}

function onWindowPointerMove(e: PointerEvent) {
  const mode = dragMode.value;
  const bounds = startBounds;
  if (!mode || !bounds || !startPointer) return;

  const uv = pointerCompUv(e);
  if (!uv) return;
  dragged = true;

  const groupCenter = { x: bounds.centerX, y: bounds.centerY };

  if (mode === "move") {
    let dx = uv.x - startPointer.x;
    let dy = uv.y - startPointer.y;
    if (e.shiftKey) {
      if (Math.abs(dx * aspect.value) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    let guideX: number | null = null;
    let guideY: number | null = null;
    if (props.snapTargets) {
      const rect = stageRef.value?.getBoundingClientRect();
      if (rect && rect.width > 1 && rect.height > 1) {
        const moved = {
          minX: bounds.minX + dx,
          maxX: bounds.maxX + dx,
          centerX: bounds.centerX + dx,
          minY: bounds.minY + dy,
          maxY: bounds.maxY + dy,
          centerY: bounds.centerY + dy,
        };
        const snapX = findSnap(
          [moved.minX, moved.centerX, moved.maxX],
          props.snapTargets.x,
          SNAP_THRESHOLD_PX / rect.width,
        );
        const snapY = findSnap(
          [moved.minY, moved.centerY, moved.maxY],
          props.snapTargets.y,
          SNAP_THRESHOLD_PX / rect.height,
        );
        if (snapX) {
          dx += snapX.delta;
          guideX = snapX.target;
        }
        if (snapY) {
          dy += snapY.delta;
          guideY = snapY.target;
        }
      }
    }

    activeGuides.value = { x: guideX, y: guideY };
    for (const snap of snapshots) {
      props.applyParam(snap.id, "layerPositionX", clampPos(snap.values.positionX + dx));
      props.applyParam(snap.id, "layerPositionY", clampPos(snap.values.positionY + dy));
    }
    return;
  }

  if (mode === "scale") {
    const ratio = aspectDistance(uv, groupCenter) / startDistance;
    for (const snap of snapshots) {
      const nextScale = Math.min(
        SCALE_MAX,
        Math.max(SCALE_MIN, Number((snap.values.scale * ratio).toFixed(4))),
      );
      // Orbit the layer center away from the group center by the same ratio.
      const cx = groupCenter.x + (snap.center.x - groupCenter.x) * ratio;
      const cy = groupCenter.y + (snap.center.y - groupCenter.y) * ratio;
      props.applyParam(snap.id, "layerScale", nextScale);
      props.applyParam(snap.id, "layerPositionX", clampPos(cx - snap.values.anchorX));
      props.applyParam(snap.id, "layerPositionY", clampPos(cy - snap.values.anchorY));
    }
    return;
  }

  // Rotate the group about its center.
  let delta = shortestAngleDelta(screenAngle(uv, groupCenter) - startAngle);
  if (e.shiftKey) delta = Math.round(delta / 15) * 15;
  for (const snap of snapshots) {
    const nextRotation = Math.min(
      ROTATION_LIMIT,
      Math.max(-ROTATION_LIMIT, Number((snap.values.rotation + delta).toFixed(2))),
    );
    const orbited = rotateAroundInCompUv(snap.center, groupCenter, delta, aspect.value);
    props.applyParam(snap.id, "layerRotation", nextRotation);
    props.applyParam(snap.id, "layerPositionX", clampPos(orbited.x - snap.values.anchorX));
    props.applyParam(snap.id, "layerPositionY", clampPos(orbited.y - snap.values.anchorY));
  }
}

function onWindowPointerUp(e: PointerEvent) {
  if (!dragMode.value) return;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);

  const wasMove = dragMode.value === "move";
  dragMode.value = null;
  activeGuides.value = { x: null, y: null };
  document.body.style.cursor = "";
  emit("gesture-end");

  // Plain click inside the group: collapse to (or shift-toggle) that layer.
  if (!dragged && wasMove && props.pickAt) {
    const uv = pointerCompUv(e);
    if (uv) {
      const hit = props.pickAt(uv, aspect.value);
      if (hit) emit("pick", hit, e.shiftKey);
    }
  }
  snapshots = [];
  startBounds = null;
  startPointer = null;
}

onUnmounted(() => {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  document.body.style.cursor = "";
});
</script>

<template>
  <div
    ref="stageRef"
    class="pointer-events-none absolute inset-0 z-10 touch-none select-none"
    aria-label="Multi-selection gizmo"
  >
    <svg
      v-if="width > 0 && height > 0 && groupBounds"
      class="absolute inset-0 size-full overflow-visible"
      :viewBox="`0 0 ${width} ${height}`"
    >
      <!-- Smart guides while snapped -->
      <g class="pointer-events-none" aria-hidden="true">
        <line
          v-if="activeGuides.x !== null"
          :x1="activeGuides.x * width"
          y1="0"
          :x2="activeGuides.x * width"
          :y2="height"
          :stroke="GUIDE_COLOR"
          stroke-width="1"
        />
        <line
          v-if="activeGuides.y !== null"
          x1="0"
          :y1="(1 - activeGuides.y) * height"
          :x2="width"
          :y2="(1 - activeGuides.y) * height"
          :stroke="GUIDE_COLOR"
          stroke-width="1"
        />
      </g>

      <!-- Rotation zones outside the corners -->
      <circle
        v-for="(zone, i) in rotationZones"
        :key="`r-${i}`"
        :cx="zone.x"
        :cy="zone.y"
        :r="ROTATION_ZONE_RADIUS"
        class="pointer-events-auto fill-transparent"
        :style="{ cursor: rotateCursorFor(zone) }"
        @pointerdown="onHandlePointerDown('rotate', $event)"
      />

      <!-- Group bounds -->
      <polygon
        :points="polygonPoints"
        class="pointer-events-auto fill-transparent stroke-accent"
        stroke-width="2"
        stroke-dasharray="6 4"
        @pointerdown="onHandlePointerDown('move', $event)"
      />

      <!-- Corner scale handles -->
      <rect
        v-for="(corner, i) in cornerPoints"
        :key="`c-${i}`"
        :x="corner.x - 4.5"
        :y="corner.y - 4.5"
        width="9"
        height="9"
        rx="1"
        class="pointer-events-auto fill-white stroke-accent"
        :style="{ cursor: resizeCursorFor(corner) }"
        stroke-width="1.5"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />
    </svg>
  </div>
</template>
