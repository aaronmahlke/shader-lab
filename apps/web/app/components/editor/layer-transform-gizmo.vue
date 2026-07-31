<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import {
  angleAroundCenter,
  clampValue,
  compUvToScreen,
  distanceFromCenter,
  layerCornersInCompUv,
  screenToCompUv,
  shortestAngleDelta,
  snapValue,
  transformCenter,
  type LayerTransformValues,
  type Vec2,
} from "#shared/editor/layer-transform";

type Props = {
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
  positionMin: number;
  positionMax: number;
  scaleMin: number;
  scaleMax: number;
  rotationMin: number;
  rotationMax: number;
};

type Emits = {
  "update:positionX": [value: number];
  "update:positionY": [value: number];
  "update:scale": [value: number];
  "update:rotation": [value: number];
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const history = useEditorHistory();
const stageRef = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(stageRef);

const values = computed<LayerTransformValues>(() => ({
  positionX: props.positionX,
  positionY: props.positionY,
  scale: props.scale,
  rotation: props.rotation,
  anchorX: props.anchorX,
  anchorY: props.anchorY,
}));

const aspect = computed(() => (height.value > 0 ? width.value / height.value : 1));

const cornerPoints = computed(() =>
  layerCornersInCompUv(values.value, aspect.value).map((uv) =>
    compUvToScreen(uv, width.value, height.value),
  ),
);

const polygonPoints = computed(() =>
  cornerPoints.value.map((p) => `${p.x},${p.y}`).join(" "),
);

const centerPoint = computed(() =>
  compUvToScreen(transformCenter(values.value), width.value, height.value),
);

/**
 * Figma-style rotation zones: invisible circular hit areas just outside each
 * corner. Rendered under the corner squares so scaling wins where they overlap.
 */
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

/** Resize cursor aligned with the drag axis (center → handle), rotation-aware. */
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

/** Figma-style curved-arrow rotate cursor, oriented toward its corner. */
function rotateCursorFor(zone: Vec2): string {
  const deg = Math.round(
    (Math.atan2(zone.y - centerPoint.value.y, zone.x - centerPoint.value.x) * 180) / Math.PI - 45,
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

/** Invisible edge bands for scaling when corners are clipped at full frame. */
const edgeSegments = computed(() => {
  const c = cornerPoints.value;
  return [0, 1, 2, 3].map((i) => {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  });
});

// --- Dragging ---

type DragMode = "move" | "scale" | "rotate";

const dragMode = ref<DragMode | null>(null);
let dragStartValues: LayerTransformValues | null = null;
let dragStartPointer: Vec2 | null = null; // comp uv
let dragStartDistance = 0;
let dragStartAngle = 0;

const POSITION_STEP = 0.001;
const SCALE_STEP = 0.1;
const ROTATION_STEP = 0.1;
const ROTATION_SNAP = 15;

function pointerCompUv(e: PointerEvent): Vec2 | null {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return screenToCompUv(
    { x: e.clientX - rect.left, y: e.clientY - rect.top },
    rect.width,
    rect.height,
  );
}

function onHandlePointerDown(mode: DragMode, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const uv = pointerCompUv(e);
  if (!uv) return;

  // Alt-drag on the body rotates — the rotation stem can sit outside the
  // clipped canvas when the layer fills the frame.
  dragMode.value = mode === "move" && e.altKey ? "rotate" : mode;
  dragStartValues = { ...values.value };
  dragStartPointer = uv;
  dragStartDistance = Math.max(distanceFromCenter(uv, dragStartValues, aspect.value), 1e-4);
  dragStartAngle = angleAroundCenter(uv, dragStartValues, aspect.value);
  history?.beginGesture();

  // Keep the handle's cursor while the pointer roams during the drag.
  if (dragMode.value === "move") {
    document.body.style.cursor = "move";
  } else if (e.target instanceof Element) {
    document.body.style.cursor = getComputedStyle(e.target).cursor;
  }

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function onWindowPointerMove(e: PointerEvent) {
  const mode = dragMode.value;
  const start = dragStartValues;
  const startPointer = dragStartPointer;
  if (!mode || !start || !startPointer) return;

  const uv = pointerCompUv(e);
  if (!uv) return;

  if (mode === "move") {
    let dx = uv.x - startPointer.x;
    let dy = uv.y - startPointer.y;
    if (e.shiftKey) {
      // Constrain to the dominant axis.
      if (Math.abs(dx * aspect.value) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    emit(
      "update:positionX",
      clampValue(snapValue(start.positionX + dx, POSITION_STEP), props.positionMin, props.positionMax),
    );
    emit(
      "update:positionY",
      clampValue(snapValue(start.positionY + dy, POSITION_STEP), props.positionMin, props.positionMax),
    );
    return;
  }

  if (mode === "scale") {
    const distance = distanceFromCenter(uv, start, aspect.value);
    const ratio = distance / dragStartDistance;
    emit(
      "update:scale",
      clampValue(snapValue(start.scale * ratio, SCALE_STEP), props.scaleMin, props.scaleMax),
    );
    return;
  }

  const angle = angleAroundCenter(uv, start, aspect.value);
  let delta = shortestAngleDelta(angle - dragStartAngle);
  let next = start.rotation + delta;
  if (e.shiftKey) next = Math.round(next / ROTATION_SNAP) * ROTATION_SNAP;
  emit(
    "update:rotation",
    clampValue(snapValue(next, ROTATION_STEP), props.rotationMin, props.rotationMax),
  );
}

function onWindowPointerUp() {
  if (!dragMode.value) return;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  dragMode.value = null;
  dragStartValues = null;
  dragStartPointer = null;
  document.body.style.cursor = "";
  history?.commitGesture();
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
    aria-label="Layer transform gizmo"
  >
    <svg
      v-if="width > 0 && height > 0"
      class="absolute inset-0 size-full overflow-visible"
      :viewBox="`0 0 ${width} ${height}`"
    >
      <!-- Rotation zones: invisible hit areas just outside each corner -->
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

      <!-- Bounds: fill drags position, accent outline like a selection box -->
      <polygon
        :points="polygonPoints"
        class="pointer-events-auto fill-transparent stroke-accent"
        stroke-width="2"
        @pointerdown="onHandlePointerDown('move', $event)"
      />

      <!-- Invisible edge bands: scale even when corners are clipped at full frame -->
      <line
        v-for="(edge, i) in edgeSegments"
        :key="`e-${i}`"
        :x1="edge.a.x"
        :y1="edge.a.y"
        :x2="edge.b.x"
        :y2="edge.b.y"
        stroke="transparent"
        stroke-width="10"
        class="pointer-events-auto"
        :style="{ cursor: resizeCursorFor(edge.mid), pointerEvents: 'stroke' }"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Corner scale handles: Figma-style white squares, rotated with the box -->
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
        :transform="`rotate(${rotation} ${corner.x} ${corner.y})`"
        stroke-width="1.5"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Anchor / pivot marker -->
      <g v-if="dragMode" class="pointer-events-none" aria-hidden="true">
        <circle :cx="centerPoint.x" :cy="centerPoint.y" r="3" class="fill-transparent stroke-accent" stroke-width="1.5" />
        <line :x1="centerPoint.x - 7" :y1="centerPoint.y" :x2="centerPoint.x + 7" :y2="centerPoint.y" class="stroke-accent" stroke-width="1" />
        <line :x1="centerPoint.x" :y1="centerPoint.y - 7" :x2="centerPoint.x" :y2="centerPoint.y + 7" class="stroke-accent" stroke-width="1" />
      </g>
    </svg>
  </div>
</template>
