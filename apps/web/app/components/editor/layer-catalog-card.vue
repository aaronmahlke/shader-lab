<script setup lang="ts">
import { InformationCircleIcon } from "@heroicons/vue/16/solid";
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui";
import type { LayerCatalogEntry } from "#shared/editor/layer-catalog";
import type { LayerCategory } from "@shader-lab/core";

type Props = {
  entry: LayerCatalogEntry;
  active?: boolean;
};

const { entry, active = false } = defineProps<Props>();

// Fallback shown behind (and instead of) the baked thumbnail when the
// /previews/<type>.webp asset is missing or fails to load.
const categoryGradients: Record<LayerCategory, string> = {
  generator: "linear-gradient(135deg, #f35a0d 0%, #6b2cff 55%, #0f3839 100%)",
  distortion: "linear-gradient(160deg, #1a1a2e 0%, #3d5a80 45%, #ee6c4d 100%)",
  effect: "linear-gradient(145deg, #2d3436 0%, #636e72 40%, #dfe6e9 100%)",
};

const previewImageFailed = ref(false);
</script>

<template>
  <div class="flex w-full flex-col gap-1 text-left">
    <div
      class="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-edge bg-base-0 transition-colors duration-150 group-data-[highlighted]:border-edge-strong group-data-[state=checked]:border-edge-strong"
    >
      <DashboardCompositionPreview
        v-if="active"
        :layers="entry.previewLayers"
        :lfos="entry.previewLfos"
        :assignments="entry.previewAssignments"
        active
        class="size-full"
      />
      <div
        v-else
        class="size-full"
        :style="{ background: categoryGradients[entry.category] }"
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
    </div>

    <div class="flex min-w-0 items-center justify-between gap-2">
      <span class="truncate text-copy-sm text-primary">{{ entry.label }}</span>

      <TooltipRoot>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex size-5 shrink-0 cursor-default items-center justify-center rounded-full text-tertiary transition-colors duration-150 hover:text-secondary"
            aria-label="About this layer"
            @click.stop
            @pointerdown.stop
          >
            <InformationCircleIcon class="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            side="top"
            :side-offset="6"
            :collision-padding="12"
            class="z-[10000] max-w-52 rounded-lg border border-edge bg-base-1 px-2.5 py-1.5 text-center text-copy-sm text-secondary shadow-lg backdrop-blur-xl data-[state=delayed-open]:animate-contentShow"
          >
            {{ entry.description }}
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </div>
  </div>
</template>
