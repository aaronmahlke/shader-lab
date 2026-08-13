<script setup lang="ts">
import { STAGE_LAYER_ID_KEY } from "~/utils/export-clock";

/**
 * Provides the owning component layer id to a staged subtree so its timed
 * sequences can be driven by the timeline with the layer's own time offset.
 */
const props = defineProps<{ layerId: string }>();

provide(STAGE_LAYER_ID_KEY, props.layerId);
</script>

<template>
  <slot />
</template>
