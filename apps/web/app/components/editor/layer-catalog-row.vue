<script setup lang="ts">
import type { LayerCatalogEntry } from "#shared/editor/layer-catalog";
import type { LayerCategory } from "@shader-lab/core";

type Props = {
  entry: LayerCatalogEntry;
};

const { entry } = defineProps<Props>();

const categoryGradients: Record<LayerCategory, string> = {
  generator: "linear-gradient(135deg, #f35a0d 0%, #6b2cff 55%, #0f3839 100%)",
  distortion: "linear-gradient(160deg, #1a1a2e 0%, #3d5a80 45%, #ee6c4d 100%)",
  effect: "linear-gradient(145deg, #2d3436 0%, #636e72 40%, #dfe6e9 100%)",
};

const previewImageFailed = ref(false);
</script>

<template>
  <div
    class="h-12 w-16 shrink-0 overflow-hidden rounded-md border border-edge bg-base-0"
    :style="previewImageFailed ? { background: categoryGradients[entry.category] } : undefined"
  >
    <img
      v-if="!previewImageFailed"
      :src="`/previews/${entry.type}.webp`"
      :alt="`${entry.label} preview`"
      class="size-full object-cover"
      loading="lazy"
      draggable="false"
      @error="previewImageFailed = true"
    />
  </div>

  <div class="flex min-w-0 flex-1 flex-col">
    <span class="truncate text-copy-sm text-primary">{{ entry.label }}</span>
    <span class="truncate text-copy-xs text-tertiary">{{ entry.description }}</span>
  </div>
</template>
