<script setup lang="ts">
import type { Component } from "vue";
import { EyeIcon, EyeOffIcon, Trash2Icon, ImageIcon, TypeIcon, LayersIcon, VideoIcon } from "lucide-vue-next";
import type { ArtworkLayer } from "#shared/types/artwork";

type Props = {
  layer: ArtworkLayer;
  label: string;
  selected: boolean;
  dragging?: boolean;
};

const { layer, label, selected, dragging = false } = defineProps<Props>();

const emit = defineEmits<{
  select: [];
  "toggle-enabled": [];
  remove: [];
}>();

const typeIcon = computed<Component>(() => {
  if (layer.type === "shader") return LayersIcon;
  if (layer.type === "text") return TypeIcon;
  if (layer.type === "video") return VideoIcon;
  return ImageIcon;
});
</script>

<template>
  <div
    class="group flex cursor-default items-center gap-2 rounded-lg px-2 py-2 transition-colors duration-150 select-none"
    :class="[
      selected
        ? 'bg-surface-1 text-primary'
        : 'text-secondary hover:bg-surface-1 hover:text-primary',
      dragging && 'scale-[1.02] bg-surface-2 shadow-lg',
    ]"
    @click="emit('select')"
  >
    <component
      :is="layer.enabled ? typeIcon : EyeOffIcon"
      class="size-3.5 shrink-0 text-tertiary"
    />

    <span
      class="min-w-0 flex-1 truncate text-copy-sm"
      :class="!layer.enabled && 'text-tertiary'"
    >
      {{ label }}
    </span>

    <button
      class="flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary opacity-0 transition-all duration-150 hover:bg-surface-1 hover:text-secondary"
      :class="(selected || !layer.enabled) ? 'opacity-100' : 'group-hover:opacity-100'"
      title="Toggle visibility"
      @click.stop="emit('toggle-enabled')"
    >
      <EyeIcon v-if="layer.enabled" class="size-3.5" />
      <EyeOffIcon v-else class="size-3.5" />
    </button>

    <button
      class="flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary opacity-0 transition-all duration-150 hover:bg-surface-1 hover:text-secondary"
      :class="selected ? 'opacity-100' : 'group-hover:opacity-100'"
      title="Remove layer"
      @click.stop="emit('remove')"
    >
      <Trash2Icon class="size-3.5" />
    </button>
  </div>
</template>
