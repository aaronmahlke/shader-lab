<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { LayerInstance } from "@shader-lab/core";
import { componentNameFromValues, componentStageWidthFromValues } from "@shader-lab/core";
import { resolveStageComponent } from "~/utils/stage-components";

/**
 * Off-screen stage for component layers.
 *
 * Each enabled component layer gets a real, laid-out DOM subtree here so the
 * capture pipeline has something to serialize. The host sits far off-screen
 * rather than `display: none` because a hidden element has no layout, no
 * computed styles worth reading, and no running animations — everything the
 * capture depends on.
 */
const props = defineProps<{ layers: LayerInstance[] }>();

const stagedLayers = computed(() =>
  props.layers.filter((layer) => layer.type === "component" && layer.enabled),
);

function stagedComponent(layer: LayerInstance) {
  const name = componentNameFromValues(layer.values);
  return name ? resolveStageComponent(name) : null;
}

const elements = new Map<string, HTMLElement>();

function setElement(layerId: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLElement) {
    elements.set(layerId, el);
  } else {
    elements.delete(layerId);
  }
}

defineExpose({
  /** The laid-out wrapper for a layer, or null while it has not mounted yet. */
  getElement: (layerId: string): HTMLElement | null => elements.get(layerId) ?? null,
});
</script>

<template>
  <div
    aria-hidden="true"
    class="pointer-events-none fixed top-0 left-[-100000px] select-none"
  >
    <div
      v-for="layer in stagedLayers"
      :key="layer.id"
      :ref="(el) => setElement(layer.id, el)"
      :style="{ width: `${componentStageWidthFromValues(layer.values)}px` }"
    >
      <component :is="stagedComponent(layer)" v-if="stagedComponent(layer)" />
    </div>
  </div>
</template>
