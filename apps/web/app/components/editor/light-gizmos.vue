<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import { projectStagePoint, type LayerInstance, type SceneView } from "@shader-lab/core";
import {
  inverseProjectionJacobian,
  lightStagePoint,
  mapUvDelta,
  type InverseJacobian,
} from "#shared/editor/threed-gizmo";

/**
 * On-canvas icons for light layers: point lights show a dot with a halo,
 * directional lights a sun icon plus a short arrow along the light direction.
 * Click selects the layer; dragging moves layerPositionX/Y through the same
 * keyframe-aware write path the other gizmos use.
 */

type Props = {
  layers: LayerInstance[];
  selectedLayerIds: string[];
  /** Scene view of the light's 3D group (drive-3D camera or identity). */
  getView: (layerId: string) => SceneView;
  /** Evaluated (keyframed) numeric param read. */
  getParam: (layerId: string, paramName: string, fallback: number) => number;
  /** Keyframe-aware write (same path as the multi gizmo). */
  applyParam: (layerId: string, paramName: string, value: number) => void;
  /** Viewport zoom of the scaled artboard; keeps icons constant on screen. */
  zoom?: number;
};

type Emits = {
  select: [layerId: string, additive: boolean];
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const history = useEditorHistory();
const stageRef = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(stageRef);
const aspect = computed(() => (height.value > 0 ? width.value / height.value : 1));

/** Inverse zoom: the artboard is CSS-scaled, so chrome divides by zoom. */
const gz = computed(() => 1 / Math.max(props.zoom ?? 1, 0.0001));

const DEG = Math.PI / 180;
const POSITION_LIMIT = 1;

type Vec2 = { x: number; y: number };

type LightIcon = {
  id: string;
  isPoint: boolean;
  point: Vec2; // CSS px
  /** Directional only: arrow tail (CSS px), pointing toward the icon. */
  arrowFrom: Vec2 | null;
  selected: boolean;
};

function toScreen(p: { x: number; y: number }): Vec2 {
  return { x: p.x * width.value, y: (1 - p.y) * height.value };
}

const lightIcons = computed<LightIcon[]>(() => {
  const out: LightIcon[] = [];
  if (width.value < 1 || height.value < 1) return out;
  for (const layer of props.layers) {
    if (layer.type !== "light" || !layer.enabled) continue;
    const view = props.getView(layer.id);
    const posX = props.getParam(layer.id, "layerPositionX", 0);
    const posY = props.getParam(layer.id, "layerPositionY", 0);
    const posZ = props.getParam(layer.id, "layerPositionZ", 0);
    const stage = lightStagePoint(posX, posY, posZ, aspect.value);
    const projected = projectStagePoint(stage, view, aspect.value);
    if (!projected) continue; // behind the camera

    const isPoint = Number(layer.values.lightType ?? 0) === 1;
    let arrowFrom: Vec2 | null = null;
    if (!isPoint) {
      // Direction TOWARD the light (matches render-passes); the arrow runs
      // from stagePos − 0.35·dir to the icon — light travels into the scene.
      const az = props.getParam(layer.id, "azimuth", -35) * DEG;
      const el = props.getParam(layer.id, "elevation", 35) * DEG;
      const dir = [
        Math.sin(az) * Math.cos(el),
        Math.sin(el),
        Math.cos(az) * Math.cos(el),
      ] as const;
      const tail = projectStagePoint(
        [stage[0] - 0.35 * dir[0], stage[1] - 0.35 * dir[1], stage[2] - 0.35 * dir[2]],
        view,
        aspect.value,
      );
      if (tail) arrowFrom = toScreen(tail);
    }

    out.push({
      id: layer.id,
      isPoint,
      point: toScreen(projected),
      arrowFrom,
      selected: props.selectedLayerIds.includes(layer.id),
    });
  }
  return out;
});

/** Arrowhead triangle at the icon end of the direction arrow. */
function arrowHead(icon: LightIcon): string {
  if (!icon.arrowFrom) return "";
  const dx = icon.point.x - icon.arrowFrom.x;
  const dy = icon.point.y - icon.arrowFrom.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = 5 * gz.value;
  // Stop the head just short of the icon so it doesn't cover it.
  const tipX = icon.point.x - ux * 9 * gz.value;
  const tipY = icon.point.y - uy * 9 * gz.value;
  const bx = tipX - ux * size;
  const by = tipY - uy * size;
  const px = -uy;
  const py = ux;
  return `M ${tipX} ${tipY} L ${bx + px * size * 0.6} ${by + py * size * 0.6} L ${bx - px * size * 0.6} ${by - py * size * 0.6} Z`;
}

// --- Dragging ---

let dragId: string | null = null;
let dragStartUv: Vec2 | null = null; // GL uv
let dragStartPos = { x: 0, y: 0 };
let dragJacobian: InverseJacobian | null = null;

function pointerUv(e: PointerEvent): Vec2 | null {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: 1 - (e.clientY - rect.top) / rect.height,
  };
}

function clampPos(v: number): number {
  return Math.min(POSITION_LIMIT, Math.max(-POSITION_LIMIT, Number(v.toFixed(6))));
}

function onIconPointerDown(id: string, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const uv = pointerUv(e);
  if (!uv) return;

  emit("select", id, e.shiftKey);

  dragId = id;
  dragStartUv = uv;
  dragStartPos = {
    x: props.getParam(id, "layerPositionX", 0),
    y: props.getParam(id, "layerPositionY", 0),
  };
  const posZ = props.getParam(id, "layerPositionZ", 0);
  const view = props.getView(id);
  // Jacobian of the projected light position: pointer-UV delta → pos delta.
  dragJacobian = inverseProjectionJacobian((dx, dy) =>
    projectStagePoint(
      lightStagePoint(dragStartPos.x + dx, dragStartPos.y + dy, posZ, aspect.value),
      view,
      aspect.value,
    ),
  );
  history?.beginGesture();
  document.body.style.cursor = "move";
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function onWindowPointerMove(e: PointerEvent) {
  if (!dragId || !dragStartUv) return;
  const uv = pointerUv(e);
  if (!uv) return;
  const du = uv.x - dragStartUv.x;
  const dv = uv.y - dragStartUv.y;
  const delta = dragJacobian ? mapUvDelta(dragJacobian, du, dv) : { x: du, y: dv };
  props.applyParam(dragId, "layerPositionX", clampPos(dragStartPos.x + delta.x));
  props.applyParam(dragId, "layerPositionY", clampPos(dragStartPos.y + delta.y));
}

function onWindowPointerUp() {
  if (!dragId) return;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  dragId = null;
  dragStartUv = null;
  dragJacobian = null;
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
    aria-label="Light gizmos"
  >
    <svg
      v-if="width > 0 && height > 0 && lightIcons.length > 0"
      class="absolute inset-0 size-full overflow-visible"
      :viewBox="`0 0 ${width} ${height}`"
    >
      <g
        v-for="icon in lightIcons"
        :key="icon.id"
        :class="icon.selected ? 'text-accent' : 'text-white/80'"
      >
        <!-- Directional: short arrow along the light direction, toward the icon -->
        <template v-if="icon.arrowFrom">
          <line
            :x1="icon.arrowFrom.x"
            :y1="icon.arrowFrom.y"
            :x2="icon.point.x"
            :y2="icon.point.y"
            stroke="currentColor"
            :stroke-width="1.5 * gz"
            stroke-opacity="0.7"
            vector-effect="non-scaling-stroke"
            class="pointer-events-none"
          />
          <path :d="arrowHead(icon)" fill="currentColor" fill-opacity="0.9" class="pointer-events-none" />
        </template>

        <!-- Point light: filled dot + subtle halo ring -->
        <template v-if="icon.isPoint">
          <circle
            :cx="icon.point.x"
            :cy="icon.point.y"
            :r="7 * gz"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.4"
            :stroke-width="1.25 * gz"
            class="pointer-events-none"
          />
          <circle
            :cx="icon.point.x"
            :cy="icon.point.y"
            :r="3.25 * gz"
            fill="currentColor"
            class="pointer-events-none"
          />
        </template>

        <!-- Directional light: small sun (disc + rays) -->
        <template v-else>
          <circle
            :cx="icon.point.x"
            :cy="icon.point.y"
            :r="3 * gz"
            fill="currentColor"
            class="pointer-events-none"
          />
          <line
            v-for="ray in 8"
            :key="`ray-${ray}`"
            :x1="icon.point.x + Math.cos((ray * Math.PI) / 4) * 4.5 * gz"
            :y1="icon.point.y + Math.sin((ray * Math.PI) / 4) * 4.5 * gz"
            :x2="icon.point.x + Math.cos((ray * Math.PI) / 4) * 7 * gz"
            :y2="icon.point.y + Math.sin((ray * Math.PI) / 4) * 7 * gz"
            stroke="currentColor"
            :stroke-width="1.25 * gz"
            stroke-linecap="round"
            class="pointer-events-none"
          />
        </template>

        <!-- Hit area: click selects, drag moves layerPositionX/Y -->
        <circle
          :cx="icon.point.x"
          :cy="icon.point.y"
          :r="10 * gz"
          class="pointer-events-auto cursor-move fill-transparent"
          @pointerdown="onIconPointerDown(icon.id, $event)"
        />
      </g>
    </svg>
  </div>
</template>
