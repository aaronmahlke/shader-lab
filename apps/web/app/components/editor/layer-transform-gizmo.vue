<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import {
  anchorPointInCompUv,
  angleAroundCenter,
  clampValue,
  compToLayerUv,
  compUvToScreen,
  distanceFromCenter,
  layerBoundsInCompUv,
  layerCornersInCompUv,
  positionForAnchorMove,
  screenToCompUv,
  shortestAngleDelta,
  snapValue,
  type ContentExtent,
  type LayerTransformValues,
  type Vec2,
} from "#shared/editor/layer-transform";
import { findSnap, type SnapTargets } from "#shared/editor/snapping";
import {
  inversePositionJacobian,
  mapUvDelta,
  projectGizmoAnchor,
  projectGizmoQuad,
  type InverseJacobian,
  type ThreeDGizmoData,
} from "#shared/editor/threed-gizmo";

type Props = {
  /** The layer this gizmo controls. */
  layerId: string;
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
  anchorMin?: number;
  anchorMax?: number;
  /** Topmost pickable layer at a comp UV point — lets clicks fall through to layers above. */
  pickAt?: (uv: Vec2, aspect: number) => string | null;
  /** Snap lines (frame + other layers) for smart-guide snapping while moving. */
  snapTargets?: SnapTargets;
  /**
   * Rect the layer's pixels actually occupy in its unit square (component/
   * text draw a smaller centered rect). Display/hit bounds only — drags
   * still write the same universal transform values.
   */
  contentExtent?: ContentExtent;
  /** Viewport zoom of the scaled artboard; keeps gizmo chrome constant on screen. */
  zoom?: number;
  /**
   * Present for 3D layers (is3D generators, object3d): transform + scene view
   * so the outline/handles land on the projected quad, matching the render.
   */
  threeD?: ThreeDGizmoData | null;
};

type Emits = {
  "update:positionX": [value: number];
  "update:positionY": [value: number];
  "update:scale": [value: number];
  "update:rotation": [value: number];
  "update:anchorX": [value: number];
  "update:anchorY": [value: number];
  /** A different layer sits on top at the clicked point — select it instead (additive = shift). */
  pick: [layerId: string, additive: boolean];
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

/** 3D layers: the projected screen quad (comp UV, y up); null = behind camera. */
const projectedQuad = computed(() =>
  props.threeD ? projectGizmoQuad(props.threeD, aspect.value) : null,
);

/** 3D layers: projected anchor point (falls back to the quad centroid). */
const projectedAnchorUv = computed<Vec2 | null>(() => {
  if (!props.threeD) return null;
  const anchor = projectGizmoAnchor(props.threeD, aspect.value);
  if (anchor) return { x: anchor.x, y: anchor.y };
  const quad = projectedQuad.value;
  if (!quad) return null;
  return {
    x: quad.reduce((sum, p) => sum + p.x, 0) / quad.length,
    y: quad.reduce((sum, p) => sum + p.y, 0) / quad.length,
  };
});

/** Behind-camera 3D layers hide the whole gizmo. */
const gizmoVisible = computed(() => !props.threeD || !!projectedQuad.value);

const cornerPoints = computed(() => {
  if (props.threeD) {
    const quad = projectedQuad.value;
    if (!quad) return [];
    return quad.map((p) => compUvToScreen({ x: p.x, y: p.y }, width.value, height.value));
  }
  return layerCornersInCompUv(values.value, aspect.value, props.contentExtent).map((uv) =>
    compUvToScreen(uv, width.value, height.value),
  );
});

const polygonPoints = computed(() =>
  cornerPoints.value.map((p) => `${p.x},${p.y}`).join(" "),
);

/** The anchor/pivot on screen — also where the anchor handle renders. */
const centerPoint = computed(() => {
  if (props.threeD) {
    const anchor = projectedAnchorUv.value;
    if (anchor) return compUvToScreen(anchor, width.value, height.value);
    return { x: 0, y: 0 };
  }
  return compUvToScreen(anchorPointInCompUv(values.value, aspect.value), width.value, height.value);
});

/** Corner handle squares align with layerRotation only in 2D. */
const handleRotation = computed(() => (props.threeD ? 0 : props.rotation));

/**
 * Figma-style rotation zones: invisible circular hit areas just outside each
 * corner. Rendered under the corner squares so scaling wins where they overlap.
 */
const ROTATION_ZONE_OFFSET = 11;
const ROTATION_ZONE_RADIUS = 14;

/** Inverse zoom: the artboard is CSS-scaled, so chrome divides by zoom to stay constant. */
const gz = computed(() => 1 / Math.max(props.zoom ?? 1, 0.0001));

const rotationZones = computed(() =>
  cornerPoints.value.map((corner) => {
    const dx = corner.x - centerPoint.value.x;
    const dy = corner.y - centerPoint.value.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: corner.x + (dx / len) * ROTATION_ZONE_OFFSET * gz.value,
      y: corner.y + (dy / len) * ROTATION_ZONE_OFFSET * gz.value,
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

/** Figma-style curved-arrow rotate cursor wrapping around its corner (concave side faces the box). */
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

type DragMode = "move" | "scale" | "rotate" | "anchor";

const dragMode = ref<DragMode | null>(null);
let dragStartValues: LayerTransformValues | null = null;
let dragStartPointer: Vec2 | null = null; // comp uv
let dragStartDistance = 0;
let dragStartAngle = 0;
/** 3D move drags: screen-UV delta → position delta (recomputed per drag start). */
let drag3DJacobian: InverseJacobian | null = null;
/** 3D scale/rotate drags pivot around the projected anchor (comp uv). */
let drag3DCenter: Vec2 | null = null;

/** Aspect-corrected distance from the projected 3D pivot. */
function distanceFrom3DCenter(uv: Vec2): number {
  const c = drag3DCenter;
  if (!c) return 1e-4;
  return Math.hypot((uv.x - c.x) * aspect.value, uv.y - c.y);
}

/** Screen-clockwise angle around the projected 3D pivot, like angleAroundCenter. */
function angleAround3DCenter(uv: Vec2): number {
  const c = drag3DCenter;
  if (!c) return 0;
  return (Math.atan2(-(uv.y - c.y), (uv.x - c.x) * aspect.value) * 180) / Math.PI;
}

const POSITION_STEP = 0.001;
const SCALE_STEP = 0.1;
const ROTATION_STEP = 0.1;
const ROTATION_SNAP = 15;
const ANCHOR_STEP = 0.001;
const ANCHOR_SNAP_TARGETS = [0, 0.5, 1];
const SNAP_THRESHOLD_PX = 6;
const GUIDE_COLOR = "#FF5D8F";

/** Snap an anchor axis to 0 / 0.5 / 1 within a threshold (layer UV units). */
function snapAnchorAxis(value: number, threshold: number): number {
  for (const target of ANCHOR_SNAP_TARGETS) {
    if (Math.abs(value - target) <= threshold) return target;
  }
  return value;
}

/** Smart-guide lines shown while a move drag is snapped, in comp UV. */
const activeGuides = ref<{ x: number | null; y: number | null }>({ x: null, y: null });

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

  // Figma behavior: when a different layer sits on top at this point, the
  // click selects it; shift+click adds the clicked layer to the selection.
  if (mode === "move" && !e.altKey && props.pickAt) {
    const topId = props.pickAt(uv, aspect.value);
    if (topId && (e.shiftKey || topId !== props.layerId)) {
      emit("pick", topId, e.shiftKey);
      return;
    }
  }

  // 3D layers: the anchor's pan-behind math is 2D-only; skip the drag there.
  if (mode === "anchor" && props.threeD) return;

  // Alt-drag on the body rotates — the rotation stem can sit outside the
  // clipped canvas when the layer fills the frame.
  dragMode.value = mode === "move" && e.altKey ? "rotate" : mode;
  dragStartValues = { ...values.value };
  dragStartPointer = uv;
  if (props.threeD) {
    // Jacobian of the projected anchor: maps pointer-UV deltas to position
    // deltas so the layer tracks the cursor at its depth. Per drag start is
    // accurate enough (the camera does not move during the drag).
    drag3DJacobian = inversePositionJacobian(props.threeD, aspect.value);
    drag3DCenter = projectedAnchorUv.value;
    dragStartDistance = Math.max(distanceFrom3DCenter(uv), 1e-4);
    dragStartAngle = angleAround3DCenter(uv);
  } else {
    drag3DJacobian = null;
    drag3DCenter = null;
    dragStartDistance = Math.max(distanceFromCenter(uv, dragStartValues, aspect.value), 1e-4);
    dragStartAngle = angleAroundCenter(uv, dragStartValues, aspect.value);
  }
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

    if (props.threeD) {
      // Map the pointer's screen delta to a position delta at the layer's
      // depth. Smart guides are 2D bounds — skipped for 3D layers.
      const delta = drag3DJacobian ? mapUvDelta(drag3DJacobian, dx, dy) : { x: dx, y: dy };
      emit(
        "update:positionX",
        clampValue(
          snapValue(start.positionX + delta.x, POSITION_STEP),
          props.positionMin,
          props.positionMax,
        ),
      );
      emit(
        "update:positionY",
        clampValue(
          snapValue(start.positionY + delta.y, POSITION_STEP),
          props.positionMin,
          props.positionMax,
        ),
      );
      return;
    }

    let nextX = snapValue(start.positionX + dx, POSITION_STEP);
    let nextY = snapValue(start.positionY + dy, POSITION_STEP);
    let guideX: number | null = null;
    let guideY: number | null = null;

    if (props.snapTargets) {
      const rect = stageRef.value?.getBoundingClientRect();
      if (rect && rect.width > 1 && rect.height > 1) {
        const bounds = layerBoundsInCompUv(
          { ...start, positionX: nextX, positionY: nextY },
          aspect.value,
          props.contentExtent,
        );
        const snapX = findSnap(
          [bounds.minX, bounds.centerX, bounds.maxX],
          props.snapTargets.x,
          SNAP_THRESHOLD_PX / rect.width,
        );
        const snapY = findSnap(
          [bounds.minY, bounds.centerY, bounds.maxY],
          props.snapTargets.y,
          SNAP_THRESHOLD_PX / rect.height,
        );
        if (snapX) {
          nextX = Number((nextX + snapX.delta).toFixed(6));
          guideX = snapX.target;
        }
        if (snapY) {
          nextY = Number((nextY + snapY.delta).toFixed(6));
          guideY = snapY.target;
        }
      }
    }

    activeGuides.value = { x: guideX, y: guideY };
    emit("update:positionX", clampValue(nextX, props.positionMin, props.positionMax));
    emit("update:positionY", clampValue(nextY, props.positionMin, props.positionMax));
    return;
  }

  if (mode === "anchor") {
    // New anchor = pointer in layer UV under the START transform: the content
    // stays fixed, so the start map keeps describing where its pixels render.
    const luv = compToLayerUv(uv, start, aspect.value);
    const rect = stageRef.value?.getBoundingClientRect();
    const s = Math.max(start.scale / 100, 1e-4);
    // Same pixel threshold as move snapping, converted to layer UV per axis
    // (one layer unit spans scale × stage size on screen, rotation aside).
    const tx = rect ? SNAP_THRESHOLD_PX / (rect.width * s) : 0.01;
    const ty = rect ? SNAP_THRESHOLD_PX / (rect.height * s) : 0.01;
    const anchorMin = props.anchorMin ?? 0;
    const anchorMax = props.anchorMax ?? 1;
    const nextAnchor = {
      x: clampValue(snapValue(snapAnchorAxis(luv.x, tx), ANCHOR_STEP), anchorMin, anchorMax),
      y: clampValue(snapValue(snapAnchorAxis(luv.y, ty), ANCHOR_STEP), anchorMin, anchorMax),
    };
    // AE "pan behind": shift position by the transformed anchor delta so the
    // rendered rect does not move.
    const pos = positionForAnchorMove(start, nextAnchor, aspect.value);
    emit("update:anchorX", nextAnchor.x);
    emit("update:anchorY", nextAnchor.y);
    emit(
      "update:positionX",
      clampValue(snapValue(pos.x, POSITION_STEP), props.positionMin, props.positionMax),
    );
    emit(
      "update:positionY",
      clampValue(snapValue(pos.y, POSITION_STEP), props.positionMin, props.positionMax),
    );
    return;
  }

  if (mode === "scale") {
    // 3D: measure from the projected pivot so the ratio matches the screen.
    const distance = props.threeD
      ? distanceFrom3DCenter(uv)
      : distanceFromCenter(uv, start, aspect.value);
    const ratio = distance / dragStartDistance;
    emit(
      "update:scale",
      clampValue(snapValue(start.scale * ratio, SCALE_STEP), props.scaleMin, props.scaleMax),
    );
    return;
  }

  const angle = props.threeD
    ? angleAround3DCenter(uv)
    : angleAroundCenter(uv, start, aspect.value);
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
  drag3DJacobian = null;
  drag3DCenter = null;
  activeGuides.value = { x: null, y: null };
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
      v-if="width > 0 && height > 0 && gizmoVisible"
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
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="activeGuides.y !== null"
          x1="0"
          :y1="(1 - activeGuides.y) * height"
          :x2="width"
          :y2="(1 - activeGuides.y) * height"
          :stroke="GUIDE_COLOR"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </g>

      <!-- Rotation zones: invisible hit areas just outside each corner -->
      <circle
        v-for="(zone, i) in rotationZones"
        :key="`r-${i}`"
        :cx="zone.x"
        :cy="zone.y"
        :r="ROTATION_ZONE_RADIUS * gz"
        class="pointer-events-auto fill-transparent"
        :style="{ cursor: rotateCursorFor(zone) }"
        @pointerdown="onHandlePointerDown('rotate', $event)"
      />

      <!-- Bounds: fill drags position, accent outline like a selection box -->
      <polygon
        :points="polygonPoints"
        class="pointer-events-auto fill-transparent stroke-accent"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
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
        :stroke-width="10 * gz"
        class="pointer-events-auto"
        :style="{ cursor: resizeCursorFor(edge.mid), pointerEvents: 'stroke' }"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Corner scale handles: Figma-style white squares, rotated with the box -->
      <rect
        v-for="(corner, i) in cornerPoints"
        :key="`c-${i}`"
        :x="corner.x - 4.5 * gz"
        :y="corner.y - 4.5 * gz"
        :width="9 * gz"
        :height="9 * gz"
        :rx="1 * gz"
        class="pointer-events-auto fill-white stroke-accent"
        :style="{ cursor: resizeCursorFor(corner) }"
        :transform="`rotate(${handleRotation} ${corner.x} ${corner.y})`"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
        @pointerdown="onHandlePointerDown('scale', $event)"
      />

      <!-- Anchor handle: crosshair-in-circle at the pivot; dragging moves the
           anchor and pans position behind so the content stays put -->
      <!-- 3D layers: the anchor dot is display-only (pan-behind math is 2D) -->
      <g
        :class="threeD ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair'"
        aria-label="Anchor handle"
        @pointerdown="onHandlePointerDown('anchor', $event)"
      >
        <circle :cx="centerPoint.x" :cy="centerPoint.y" :r="9 * gz" class="fill-transparent" />
        <line :x1="centerPoint.x - 8 * gz" :y1="centerPoint.y" :x2="centerPoint.x + 8 * gz" :y2="centerPoint.y" class="stroke-accent" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        <line :x1="centerPoint.x" :y1="centerPoint.y - 8 * gz" :x2="centerPoint.x" :y2="centerPoint.y + 8 * gz" class="stroke-accent" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        <circle :cx="centerPoint.x" :cy="centerPoint.y" :r="4.5 * gz" class="fill-white stroke-accent" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </g>
    </svg>
  </div>
</template>
