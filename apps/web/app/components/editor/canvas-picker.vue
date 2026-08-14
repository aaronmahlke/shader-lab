<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import type { LayerInstance } from "@shader-lab/core";
import {
  compUvToScreen,
  layerCornersInCompUv,
  screenToCompUv,
  type ContentExtent,
  type LayerTransformValues,
  type Vec2,
} from "#shared/editor/layer-transform";
import { topLayerAt } from "#shared/editor/canvas-picking";

/**
 * Canvas selection surface: hover a layer for a light outline, click to
 * select it, click empty space to deselect. Sits underneath the gizmos so
 * their handles win pointer events.
 */

type Props = {
  layers: LayerInstance[];
  selectedLayerIds: string[];
  getTransform: (layer: LayerInstance) => LayerTransformValues;
  /** Per-layer content rect (component/text draw less than the full frame). */
  getExtent?: (layer: LayerInstance) => ContentExtent;
};

type Emits = {
  /** Additive = shift held: toggle instead of replace. */
  select: [layerId: string | null, additive: boolean];
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const stageRef = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(stageRef);
const aspect = computed(() => (height.value > 0 ? width.value / height.value : 1));

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

function layerAt(uv: Vec2): LayerInstance | null {
  return topLayerAt(props.layers, uv, aspect.value, props.getTransform, props.getExtent);
}

function onPointerMove(e: PointerEvent) {
  const uv = pointerCompUv(e);
  const hit = uv ? layerAt(uv) : null;
  hoveredLayerId.value =
    hit && !props.selectedLayerIds.includes(hit.id) ? hit.id : null;
}

function onPointerLeave() {
  hoveredLayerId.value = null;
}

function onClick(e: MouseEvent) {
  const uv = pointerCompUv(e);
  if (!uv) return;
  const hit = layerAt(uv);
  if (!hit && e.shiftKey) return; // shift+empty keeps the selection
  emit("select", hit?.id ?? null, e.shiftKey);
  if (hit) hoveredLayerId.value = null;
}

const hoverOutline = computed(() => {
  if (!hoveredLayerId.value) return null;
  const layer = props.layers.find((l) => l.id === hoveredLayerId.value);
  if (!layer) return null;
  return layerCornersInCompUv(props.getTransform(layer), aspect.value, props.getExtent?.(layer))
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
      <polygon :points="hoverOutline" class="fill-transparent stroke-accent/60" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  </div>
</template>
