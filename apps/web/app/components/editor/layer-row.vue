<script setup lang="ts">
import type { Component } from "vue";
import {
  EyeIcon,
  EyeSlashIcon,
  SparklesIcon,
  ArrowsPointingOutIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/vue/16/solid";
import type { LayerInstance, LayerCategory } from "@shader-lab/core";
import { LAYER_TEMPLATES } from "@shader-lab/core";

type Props = {
  layer: LayerInstance;
  selected: boolean;
  dragging?: boolean;
};

type Emits = {
  select: [];
  "toggle-enabled": [];
  duplicate: [];
  remove: [];
  "update:name": [name: string];
};

const { layer, selected, dragging = false } = defineProps<Props>();
const emit = defineEmits<Emits>();

const template = computed(() => LAYER_TEMPLATES[layer.type]);
const displayName = computed({
  get: () => layer.name ?? template.value?.label ?? layer.type,
  set: (v: string) => emit("update:name", v),
});

const categoryIcons: Record<LayerCategory, Component> = {
  generator: SparklesIcon,
  distortion: ArrowsPointingOutIcon,
  effect: AdjustmentsHorizontalIcon,
};

const categoryIcon = computed(() => {
  if (!template.value) return null;
  return categoryIcons[template.value.category];
});

const editableRef = ref<{ startEditing: () => void; editing: boolean } | null>(null);
const isEditing = computed(() => editableRef.value?.editing ?? false);

const visibilityIcon = computed(() => (layer.enabled ? EyeIcon : EyeSlashIcon));
</script>

<template>
  <UiContextMenu>
    <UiHover
      solid
      :active="selected || dragging"
      class-name="bg-layer-1 group-hover/h:bg-control"
      active-class-name="bg-control"
      full-width
      :class="dragging && 'scale-[1.02] shadow-lg'"
    >
      <div
        data-drag-handle
        class="flex h-9 cursor-default items-center gap-2 p-2 outline-none select-none"
        :class="selected ? 'text-neutral-strong' : 'text-neutral-subtle group-hover/h:text-neutral-strong'"
        @click.stop="!isEditing && emit('select')"
      >
        <span
          v-if="categoryIcon"
          class="flex size-5 shrink-0 items-center justify-center"
        >
          <component
            :is="categoryIcon"
            class="size-4 text-neutral-subtle"
            :class="!layer.enabled && 'opacity-50'"
          />
        </span>

        <UiEditableText
          ref="editableRef"
          v-model="displayName"
          fill
          class="min-w-0 flex-1 text-copy-sm"
          :class="!layer.enabled && 'text-neutral-weak'"
        />

        <div class="relative flex min-w-0 flex-1 items-center justify-end">
          <span
            v-if="layer.enabled"
            class="pointer-events-none absolute right-0 max-w-full truncate text-copy-sm text-neutral-subtle group-hover/h:opacity-0"
          >
            {{ template?.label }}
          </span>
          <UiButton
            variant="ghost"
            size="sm"
            :icon-left="visibilityIcon"
            title="Toggle visibility"
            data-drag-exclude
            class="relative z-10 !size-6"
            :class="layer.enabled && 'opacity-0 group-hover/h:opacity-100'"
            @click.stop="emit('toggle-enabled')"
          />
        </div>
      </div>
    </UiHover>

    <template #menu>
      <UiContextMenuItem @click="editableRef?.startEditing()">Rename</UiContextMenuItem>
      <UiContextMenuItem @click="emit('duplicate')">Duplicate</UiContextMenuItem>
      <UiContextMenuItem @click="emit('toggle-enabled')">{{ layer.enabled ? 'Hide' : 'Show' }}</UiContextMenuItem>
      <UiContextMenuSeparator />
      <UiContextMenuItem @click="emit('remove')">Delete</UiContextMenuItem>
    </template>
  </UiContextMenu>
</template>
