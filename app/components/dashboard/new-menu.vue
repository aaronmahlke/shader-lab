<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";
import { ChevronDownIcon, PlusIcon } from "@heroicons/vue/16/solid";
import { SHADER_PRESETS } from "#shared/editor/shader-presets";
import { ARTWORK_PRESETS } from "#shared/editor/artwork-presets";

const open = ref(false);

function startShader(presetId: string) {
  open.value = false;
  navigateTo({ path: "/shader", query: { preset: presetId } });
}

function startArtwork(presetId: string) {
  open.value = false;
  const preset = ARTWORK_PRESETS.find((p) => p.id === presetId);
  navigateTo({
    path: "/artwork",
    query: { preset: presetId, shaderPreset: preset?.shaderPresetId ?? "blank" },
  });
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <UiButton variant="action" :icon-left="PlusIcon" :icon-right="ChevronDownIcon">
        New
      </UiButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="8"
        :collision-padding="12"
        class="z-50 w-56 rounded-xl border border-edge bg-base-1 p-1 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
      >
        <div class="px-2.5 py-1.5">
          <span class="text-copy-sm text-tertiary select-none">Shader</span>
        </div>
        <button
          v-for="preset in SHADER_PRESETS"
          :key="preset.id"
          type="button"
          class="flex w-full cursor-default flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-surface-1"
          @click="startShader(preset.id)"
        >
          <span class="text-copy-sm text-primary">{{ preset.name }}</span>
          <span class="line-clamp-1 text-copy-sm text-tertiary">{{ preset.description }}</span>
        </button>

        <div class="my-1 h-px bg-surface-1" />

        <div class="px-2.5 py-1.5">
          <span class="text-copy-sm text-tertiary select-none">Artwork</span>
        </div>
        <button
          v-for="preset in ARTWORK_PRESETS"
          :key="preset.id"
          type="button"
          class="flex w-full cursor-default flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-surface-1"
          @click="startArtwork(preset.id)"
        >
          <span class="text-copy-sm text-primary">{{ preset.name }}</span>
          <span class="line-clamp-1 text-copy-sm text-tertiary">{{ preset.description }}</span>
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
