<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import type { ProjectedPoint } from "@shader-lab/core";
import { clampValue, snapValue, type Vec2 } from "#shared/editor/layer-transform";
import { axisScreenDerivative, type AxisKey, type AxisOffset } from "#shared/editor/threed-gizmo";

/**
 * DCC-style axis triad for translating a 3D point (layer anchor or light):
 * three fixed-screen-length arrows along the STAGE-space X/Y/Z axes as seen
 * through the current camera view. Dragging an arrow moves exactly ONE
 * position param, resolved by least squares along the axis' screen direction.
 * A Z axis that degenerates on screen (pointing at the camera) renders as a
 * filled circle at the anchor; dragging it maps vertical motion to Z.
 */

type Props = {
  /**
   * Projects the controlled point with position-param offsets applied — the
   * host owns the transform/view (layer anchor or light stage point).
   */
  project: (offset: AxisOffset, aspect: number) => ProjectedPoint | null;
  x: number;
  y: number;
  z: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  /** Viewport zoom of the scaled artboard; keeps arrows constant on screen. */
  zoom?: number;
};

type Emits = {
  "update:x": [value: number];
  "update:y": [value: number];
  "update:z": [value: number];
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const history = useEditorHistory();
const stageRef = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(stageRef);
const aspect = computed(() => (height.value > 0 ? width.value / height.value : 1));

/** Inverse zoom: the artboard is CSS-scaled, so chrome divides by zoom. */
const gz = computed(() => 1 / Math.max(props.zoom ?? 1, 0.0001));

const AXES: { key: AxisKey; color: string }[] = [
  { key: "x", color: "#ef4444" },
  { key: "y", color: "#22c55e" },
  { key: "z", color: "#3b82f6" },
];

/** Arrow length on screen (canvas px, zoom-compensated via gz). */
const ARROW_LENGTH = 56;
/** Gap between the anchor and the arrow tail so the pivot stays visible. */
const ARROW_GAP = 10;
const HEAD_LENGTH = 10;
const HEAD_HALF_WIDTH = 4.5;
/** Aspect-corrected UV per param unit below which an axis is edge-on. */
const DEGENERATE_UV = 0.05;
/** Position params snap like the other gizmos' position drags. */
const POSITION_STEP = 0.001;
/** Degenerate Z drag: 120 canvas px of vertical motion ≈ 0.5 posZ. */
const Z_FALLBACK_PER_PX = 0.5 / 120;

const ZERO_OFFSET: AxisOffset = { x: 0, y: 0, z: 0 };

function toScreen(p: { x: number; y: number }): Vec2 {
  return { x: p.x * width.value, y: (1 - p.y) * height.value };
}

/** Projected pivot in comp UV; null hides the triad (behind camera). */
const anchorUv = computed<ProjectedPoint | null>(() =>
  width.value > 0 && height.value > 0 ? props.project(ZERO_OFFSET, aspect.value) : null,
);

const anchorPx = computed<Vec2 | null>(() => {
  const uv = anchorUv.value;
  return uv ? toScreen(uv) : null;
});

type AxisRender = {
  key: AxisKey;
  color: string;
  /** Arrow geometry in canvas px; null for the degenerate-Z circle handle. */
  tail: Vec2;
  end: Vec2;
  tip: Vec2;
  headPath: string;
  degenerate: boolean;
};

/**
 * Screen direction of each stage axis: project the anchor and the anchor
 * nudged by ε along ONE position param (same direction as the stage axis —
 * posX/Y/Z map to stage x/y/z by positive scales), normalize the UV delta.
 */
const axisRenders = computed<AxisRender[]>(() => {
  const anchor = anchorPx.value;
  if (!anchor) return [];
  const out: AxisRender[] = [];
  for (const { key, color } of AXES) {
    const deriv = axisScreenDerivative((o) => props.project(o, aspect.value), key);
    const uvLen = deriv ? Math.hypot(deriv.du * aspect.value, deriv.dv) : 0;
    if (!deriv || uvLen < DEGENERATE_UV) {
      // Edge-on axis: Z (facing the camera) still gets a circle handle at the
      // anchor; a degenerate X/Y is skipped outright.
      if (key !== "z") continue;
      out.push({
        key,
        color,
        tail: anchor,
        end: anchor,
        tip: anchor,
        headPath: "",
        degenerate: true,
      });
      continue;
    }
    // Comp UV (y up) → canvas px (y down) direction.
    const dx = deriv.du * width.value;
    const dy = -deriv.dv * height.value;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tail = {
      x: anchor.x + ux * ARROW_GAP * gz.value,
      y: anchor.y + uy * ARROW_GAP * gz.value,
    };
    const end = {
      x: anchor.x + ux * ARROW_LENGTH * gz.value,
      y: anchor.y + uy * ARROW_LENGTH * gz.value,
    };
    const tip = {
      x: end.x + ux * HEAD_LENGTH * gz.value,
      y: end.y + uy * HEAD_LENGTH * gz.value,
    };
    const px = -uy;
    const py = ux;
    const w = HEAD_HALF_WIDTH * gz.value;
    const headPath = `M ${tip.x} ${tip.y} L ${end.x + px * w} ${end.y + py * w} L ${end.x - px * w} ${end.y - py * w} Z`;
    out.push({ key, color, tail, end, tip, headPath, degenerate: false });
  }
  return out;
});

const hoveredAxis = ref<AxisKey | null>(null);

// --- Dragging (one axis → one param) ---

const draggingAxis = ref<AxisKey | null>(null);
let dragStartPointer: Vec2 | null = null; // comp uv (y up)
let dragStartValue = 0;
/** Gesture-start screen derivative in canvas px per param unit (like the free-drag's start jacobian). */
let dragDerivPx: Vec2 | null = null;
let dragDegenerate = false;

function pointerUv(e: PointerEvent): Vec2 | null {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: 1 - (e.clientY - rect.top) / rect.height,
  };
}

function valueFor(axis: AxisKey): number {
  return axis === "x" ? props.x : axis === "y" ? props.y : props.z;
}

function limitsFor(axis: AxisKey): { min: number; max: number } {
  if (axis === "x") return { min: props.xMin, max: props.xMax };
  if (axis === "y") return { min: props.yMin, max: props.yMax };
  return { min: props.zMin, max: props.zMax };
}

function emitAxis(axis: AxisKey, value: number) {
  if (axis === "x") emit("update:x", value);
  else if (axis === "y") emit("update:y", value);
  else emit("update:z", value);
}

function onAxisPointerDown(axis: AxisKey, degenerate: boolean, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const uv = pointerUv(e);
  if (!uv) return;

  dragDegenerate = degenerate;
  dragDerivPx = null;
  if (!degenerate) {
    // v_i at gesture start (matches the free-drag's start-time jacobian).
    const deriv = axisScreenDerivative((o) => props.project(o, aspect.value), axis);
    if (!deriv) return;
    dragDerivPx = { x: deriv.du * width.value, y: -deriv.dv * height.value };
    const lenSq = dragDerivPx.x * dragDerivPx.x + dragDerivPx.y * dragDerivPx.y;
    if (!Number.isFinite(lenSq) || lenSq < 1e-9) return;
  }

  draggingAxis.value = axis;
  dragStartPointer = uv;
  dragStartValue = valueFor(axis);
  history?.beginGesture();
  document.body.style.cursor = "pointer";
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function onWindowPointerMove(e: PointerEvent) {
  const axis = draggingAxis.value;
  const start = dragStartPointer;
  if (!axis || !start) return;
  const uv = pointerUv(e);
  if (!uv) return;

  let dParam: number;
  if (dragDegenerate) {
    // Z facing the camera: vertical motion drives depth, up = toward camera.
    dParam = (uv.y - start.y) * height.value * Z_FALLBACK_PER_PX;
  } else if (dragDerivPx) {
    // Least squares along the axis' screen direction (canvas px space).
    const mx = (uv.x - start.x) * width.value;
    const my = -(uv.y - start.y) * height.value;
    const dot = mx * dragDerivPx.x + my * dragDerivPx.y;
    const lenSq = dragDerivPx.x * dragDerivPx.x + dragDerivPx.y * dragDerivPx.y;
    dParam = dot / lenSq;
  } else {
    return;
  }

  const { min, max } = limitsFor(axis);
  emitAxis(axis, clampValue(snapValue(dragStartValue + dParam, POSITION_STEP), min, max));
}

function onWindowPointerUp() {
  if (!draggingAxis.value) return;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  draggingAxis.value = null;
  dragStartPointer = null;
  dragDerivPx = null;
  dragDegenerate = false;
  document.body.style.cursor = "";
  history?.commitGesture();
}

onUnmounted(() => {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  document.body.style.cursor = "";
});

function axisActive(axis: AxisKey): boolean {
  return hoveredAxis.value === axis || draggingAxis.value === axis;
}
</script>

<template>
  <div
    ref="stageRef"
    class="pointer-events-none absolute inset-0 touch-none select-none"
    aria-label="Axis triad gizmo"
  >
    <svg
      v-if="width > 0 && height > 0 && anchorPx"
      class="absolute inset-0 size-full overflow-visible"
      :viewBox="`0 0 ${width} ${height}`"
    >
      <g
        v-for="axis in axisRenders"
        :key="axis.key"
        :style="{ filter: axisActive(axis.key) ? 'brightness(1.35)' : undefined }"
      >
        <!-- Degenerate Z: filled circle at the anchor, vertical drag = depth -->
        <template v-if="axis.degenerate">
          <circle
            :cx="anchorPx.x"
            :cy="anchorPx.y"
            :r="(axisActive(axis.key) ? 6 : 5) * gz"
            :fill="axis.color"
            stroke="white"
            :stroke-width="1.25 * gz"
            class="pointer-events-none"
          />
          <circle
            :cx="anchorPx.x"
            :cy="anchorPx.y"
            :r="9 * gz"
            class="pointer-events-auto cursor-pointer fill-transparent"
            :aria-label="`Move along ${axis.key.toUpperCase()} axis`"
            @pointerdown="onAxisPointerDown(axis.key, true, $event)"
            @pointerenter="hoveredAxis = axis.key"
            @pointerleave="hoveredAxis = hoveredAxis === axis.key ? null : hoveredAxis"
          />
        </template>

        <!-- Regular axis: line + arrowhead, fixed screen length -->
        <template v-else>
          <line
            :x1="axis.tail.x"
            :y1="axis.tail.y"
            :x2="axis.end.x"
            :y2="axis.end.y"
            :stroke="axis.color"
            :stroke-width="(axisActive(axis.key) ? 3.5 : 2.25) * gz"
            stroke-linecap="round"
            class="pointer-events-none"
          />
          <path :d="axis.headPath" :fill="axis.color" class="pointer-events-none" />
          <!-- Invisible wide hit band over line + head -->
          <line
            :x1="axis.tail.x"
            :y1="axis.tail.y"
            :x2="axis.tip.x"
            :y2="axis.tip.y"
            stroke="transparent"
            :stroke-width="12 * gz"
            stroke-linecap="round"
            class="pointer-events-auto cursor-pointer"
            :style="{ pointerEvents: 'stroke' }"
            :aria-label="`Move along ${axis.key.toUpperCase()} axis`"
            @pointerdown="onAxisPointerDown(axis.key, false, $event)"
            @pointerenter="hoveredAxis = axis.key"
            @pointerleave="hoveredAxis = hoveredAxis === axis.key ? null : hoveredAxis"
          />
        </template>
      </g>
    </svg>
  </div>
</template>
