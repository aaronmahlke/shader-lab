<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import {
  angleAroundCenter,
  clampValue,
  compUvToScreen,
  distanceFromCenter,
  layerCornersInCompUv,
  layerToCompUv,
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

const ROTATION_HANDLE_OFFSET = 22;

const rotationHandlePoint = computed<Vec2>(() => {
  // Midpoint of the layer's top edge, pushed outward from the center.
  const topMid = compUvToScreen(
    layerToCompUv({ x: 0.5, y: 1 }, values.value, aspect.value),
    width.value,
    height.value,
  );
  const dx = topMid.x - centerPoint.value.x;
  const dy = topMid.y - centerPoint.value.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: topMid.x + (dx / len) * ROTATION_HANDLE_OFFSET,
    y: topMid.y + (dy / len) * ROTATION_HANDLE_OFFSET,
  };
});

const topMidPoint = computed(() =>
  compUvToScreen(
    layerToCompUv({ x: 0.5, y: 1 }, values.value, aspect.value),
    width.value,
    height.value,
  ),
);

/** Edge midpoint handles (easier to grab than corners when the layer fills the frame). */
const edgeMidPoints = computed(() =>
  [
    { x: 0.5, y: 0 },
    { x: 1, y: 0.5 },
    { x: 0.5, y: 1 },
    { x: 0, y: 0.5 },
  ].map((luv) =>
    compUvToScreen(layerToCompUv(luv, values.value, aspect.value), width.value, height.value),
  ),
);

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
      <!-- Bounds: fill drags position, outline is visual only -->
      <polygon
        :points="polygonPoints"
        class="pointer-events-auto cursor-grab fill-transparent stroke-gizmo-ring"
        stroke-width="1.5"
        @pointerdown="onHandlePointerDown('move', $event)"
      />

      <!-- Rotation handle stem -->
      <line
        :x1="topMidPoint.x"
        :y1="topMidPoint.y"
        :x2="rotationHandlePoint.x"
        :y2="rotationHandlePoint.y"
        class="stroke-gizmo-ring"
        stroke-width="1.5"
      />
      <circle
        :cx="rotationHandlePoint.x"
        :cy="rotationHandlePoint.y"
        r="5.5"
        class="pointer-events-auto cursor-crosshair fill-gizmo-handle stroke-gizmo-handle-outer"
        stroke-width="2.5"
        @pointerdown="onHandlePointerDown('rotate', $event)"
      />

      <!-- Corner scale handles -->
      <rect
        v-for="(corner, i) in cornerPoints"
        :key="`c-${i}`"
        :x="corner.x - 4"
        :y="corner.y - 4"
        width="8"
        height="8"
        rx="1.5"
        class="pointer-events-auto cursor-nwse-resize fill-gizmo-handle stroke-gizmo-handle-outer"
        stroke-width="2.5"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Edge midpoint scale handles -->
      <circle
        v-for="(mid, i) in edgeMidPoints"
        :key="`m-${i}`"
        :cx="mid.x"
        :cy="mid.y"
        r="4"
        class="pointer-events-auto cursor-nwse-resize fill-gizmo-handle stroke-gizmo-handle-outer"
        stroke-width="2"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Anchor / pivot crosshair -->
      <g class="pointer-events-none" aria-hidden="true">
        <circle :cx="centerPoint.x" :cy="centerPoint.y" r="3" class="fill-transparent stroke-gizmo-handle" stroke-width="1.5" />
        <line :x1="centerPoint.x - 7" :y1="centerPoint.y" :x2="centerPoint.x + 7" :y2="centerPoint.y" class="stroke-gizmo-handle" stroke-width="1" />
        <line :x1="centerPoint.x" :y1="centerPoint.y - 7" :x2="centerPoint.x" :y2="centerPoint.y + 7" class="stroke-gizmo-handle" stroke-width="1" />
      </g>
    </svg>
  </div>
</template>
