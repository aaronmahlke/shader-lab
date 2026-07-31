<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import type { LayerInstance } from "@shader-lab/core";
import {
  compUvToScreen,
  isPointInLayer,
  layerCornersInCompUv,
  screenToCompUv,
  type LayerTransformValues,
  type Vec2,
} from "#shared/editor/layer-transform";

/**
 * Canvas selection surface: hover a layer for a light outline, click to
 * select it, click empty space to deselect. Sits underneath the gizmos so
 * their handles win pointer events.
 */

type Props = {
  layers: LayerInstance[];
  selectedLayerId: string | null;
  getTransform: (layer: LayerInstance) => LayerTransformValues;
};

type Emits = {
  select: [layerId: string | null];
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const stageRef = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(stageRef);
const aspect = computed(() => (height.value > 0 ? width.value / height.value : 1));

/** Full-frame effects are not pickable; generators are. */
const PICKABLE_TYPES = new Set<LayerInstance["type"]>([
  "gradient",
  "solid",
  "noise",
  "waveFill",
  "bandFill",
  "mesh",
]);

const hoveredLayerId = ref<string | null>(null);

function pointerCompUv(e: PointerEvent | MouseEvent): Vec2 | null {
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return screenToCompUv(
    { x: e.clientX - rect.left, y: e.clientY - rect.top },
    rect.width,
    rect.height,
  );
}

/** Topmost pickable layer under the point (layers are stored top-first). */
function layerAt(uv: Vec2): LayerInstance | null {
  for (const layer of props.layers) {
    if (!layer.enabled || !PICKABLE_TYPES.has(layer.type)) continue;
    if (isPointInLayer(uv, props.getTransform(layer), aspect.value)) return layer;
  }
  return null;
}

function onPointerMove(e: PointerEvent) {
  const uv = pointerCompUv(e);
  const hit = uv ? layerAt(uv) : null;
  hoveredLayerId.value = hit && hit.id !== props.selectedLayerId ? hit.id : null;
}

function onPointerLeave() {
  hoveredLayerId.value = null;
}

function onClick(e: MouseEvent) {
  const uv = pointerCompUv(e);
  if (!uv) return;
  const hit = layerAt(uv);
  emit("select", hit?.id ?? null);
  if (hit) hoveredLayerId.value = null;
}

const hoverOutline = computed(() => {
  if (!hoveredLayerId.value) return null;
  const layer = props.layers.find((l) => l.id === hoveredLayerId.value);
  if (!layer) return null;
  return layerCornersInCompUv(props.getTransform(layer), aspect.value)
    .map((uv) => {
      const p = compUvToScreen(uv, width.value, height.value);
      return `${p.x},${p.y}`;
    })
    .join(" ");
});
</script>

<template>
  <div
    ref="stageRef"
    class="absolute inset-0 touch-none select-none"
    aria-label="Canvas layer picker"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @click="onClick"
  >
    <svg
      v-if="hoverOutline"
      class="pointer-events-none absolute inset-0 size-full overflow-visible"
      :viewBox="`0 0 ${width} ${height}`"
      aria-hidden="true"
    >
      <polygon :points="hoverOutline" class="fill-transparent stroke-accent/60" stroke-width="1.5" />
    </svg>
  </div>
</template>
