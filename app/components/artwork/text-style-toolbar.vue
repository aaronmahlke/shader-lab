<script setup lang="ts">
import { BoldIcon, ItalicIcon, UnderlineIcon } from "lucide-vue-next";
import type { ArtworkTextLayer } from "#shared/types/artwork";

const props = defineProps<{
  layer: ArtworkTextLayer;
  hasSelection: boolean;
}>();

const emit = defineEmits<{
  bold: [];
  italic: [];
  underline: [];
  color: [value: string];
}>();
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-1 rounded-lg border border-edge bg-surface-1 p-1"
    :class="!hasSelection && 'opacity-50'"
    data-keeps-text-edit
    @mousedown.prevent
  >
    <button
      type="button"
      class="flex size-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-base-1 hover:text-primary disabled:pointer-events-none"
      :disabled="!hasSelection"
      title="Bold selection"
      @click="emit('bold')"
    >
      <BoldIcon class="size-3.5" />
    </button>
    <button
      type="button"
      class="flex size-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-base-1 hover:text-primary disabled:pointer-events-none"
      :disabled="!hasSelection"
      title="Italic selection"
      @click="emit('italic')"
    >
      <ItalicIcon class="size-3.5" />
    </button>
    <button
      type="button"
      class="flex size-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-base-1 hover:text-primary disabled:pointer-events-none"
      :disabled="!hasSelection"
      title="Underline selection"
      @click="emit('underline')"
    >
      <UnderlineIcon class="size-3.5" />
    </button>
    <div class="mx-0.5 h-5 w-px bg-edge" />
    <UiColorField
      :model-value="layer.color"
      label=""
      class="min-w-0 [&>span:first-child]:hidden"
      @update:model-value="emit('color', $event)"
    />
  </div>
</template>
