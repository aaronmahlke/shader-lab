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
    class="h-[36px] w-[48px] shrink-0 overflow-hidden bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)]"
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
    <span class="truncate">{{ entry.label }}</span>
    <span class="truncate opacity-60">{{ entry.description }}</span>
  </div>
</template>
