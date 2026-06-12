<script setup lang="ts">
import { ChevronDownIcon } from "@heroicons/vue/16/solid";
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";
import { ARTWORK_PRESETS } from "#shared/editor/artwork-presets";
import type { ArtworkCanvas } from "#shared/types/artwork";

const canvas = defineModel<ArtworkCanvas>("canvas", { required: true });

const open = ref(false);

const presets = ARTWORK_PRESETS.map((p) => ({
  id: p.id,
  label: p.name,
  width: p.canvas.width,
  height: p.canvas.height,
}));

const customWidth = ref(canvas.value.width);
const customHeight = ref(canvas.value.height);

watch(
  canvas,
  (c) => {
    customWidth.value = c.width;
    customHeight.value = c.height;
  },
  { deep: true },
);

const displayLabel = computed(() => `${canvas.value.width}×${canvas.value.height}`);

const activePresetId = computed(() => {
  const match = presets.find(
    (p) => p.width === canvas.value.width && p.height === canvas.value.height,
  );
  return match?.id ?? null;
});

function applyPreset(width: number, height: number) {
  canvas.value = { width, height };
  open.value = false;
}

function clampDimension(n: number): number {
  return Math.max(1, Math.min(8192, Math.round(n)));
}

function applyCustom() {
  canvas.value = {
    width: clampDimension(customWidth.value),
    height: clampDimension(customHeight.value),
  };
  open.value = false;
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex cursor-default items-center gap-1 rounded-lg px-2 py-1 text-copy-sm text-tertiary transition-colors duration-150 hover:bg-surface-1 hover:text-secondary"
        title="Canvas size"
      >
        <span class="select-none tabular-nums">{{ displayLabel }}</span>
        <ChevronDownIcon class="size-4" />
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="center"
        :side-offset="8"
        :collision-padding="12"
        class="z-50 w-56 rounded-xl border border-edge bg-base-1 p-2 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
      >
        <p class="px-2 py-1 text-copy-sm text-tertiary select-none">
          Canvas size
        </p>
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="flex w-full cursor-default items-center justify-between rounded-lg px-2 py-1.5 text-left text-copy-sm transition-colors duration-150 hover:bg-surface-1"
          :class="activePresetId === preset.id ? 'bg-surface-1 text-primary' : 'text-secondary'"
          @click="applyPreset(preset.width, preset.height)"
        >
          <span>{{ preset.label }}</span>
          <span class="text-copy-sm text-tertiary tabular-nums">{{ preset.width }}×{{ preset.height }}</span>
        </button>

        <div class="my-2 h-px bg-surface-1" />

        <p class="px-2 pb-1 text-copy-sm text-tertiary select-none">Custom</p>
        <div class="flex gap-2 px-2">
          <label class="flex flex-1 flex-col gap-0.5">
            <span class="text-copy-sm text-tertiary">W</span>
            <input
              v-model.number="customWidth"
              type="number"
              min="1"
              max="8192"
              class="h-7 w-full rounded-lg border border-edge bg-surface-1 px-2 text-copy-sm text-primary tabular-nums"
            />
          </label>
          <label class="flex flex-1 flex-col gap-0.5">
            <span class="text-copy-sm text-tertiary">H</span>
            <input
              v-model.number="customHeight"
              type="number"
              min="1"
              max="8192"
              class="h-7 w-full rounded-lg border border-edge bg-surface-1 px-2 text-copy-sm text-primary tabular-nums"
            />
          </label>
        </div>
        <UiButton variant="action" size="sm" class="mt-2 w-full" @click="applyCustom">
          Apply
        </UiButton>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
