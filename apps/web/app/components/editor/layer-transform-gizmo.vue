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

/** Diagonal resize cursor per corner (bl, br, tr, tl). */
const CORNER_CURSORS = [
  "cursor-nesw-resize",
  "cursor-nwse-resize",
  "cursor-nesw-resize",
  "cursor-nwse-resize",
] as const;

/** Invisible edge bands for scaling when corners are clipped at full frame. */
const edgeSegments = computed(() => {
  const c = cornerPoints.value;
  return [0, 1, 2, 3].map((i) => ({ a: c[i]!, b: c[(i + 1) % 4]! }));
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
  history?.commitGesture();
}

onUnmounted(() => {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
});

const stageCursor = computed(() => {
  if (dragMode.value === "move") return "cursor-grabbing";
  if (dragMode.value === "scale") return "cursor-nwse-resize";
  if (dragMode.value === "rotate") return "cursor-crosshair";
  return "";
});
</script>

<template>
  <div
    ref="stageRef"
    class="pointer-events-none absolute inset-0 z-10 touch-none select-none"
    :class="stageCursor"
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
        class="pointer-events-auto cursor-crosshair fill-transparent"
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
        class="pointer-events-auto cursor-nwse-resize"
        style="pointer-events: stroke"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Corner scale handles: Figma-style white squares -->
      <rect
        v-for="(corner, i) in cornerPoints"
        :key="`c-${i}`"
        :x="corner.x - 4.5"
        :y="corner.y - 4.5"
        width="9"
        height="9"
        rx="1"
        class="pointer-events-auto fill-white stroke-accent"
        :class="CORNER_CURSORS[i]"
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
