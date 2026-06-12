<script setup lang="ts">
import type { Component } from "vue";
import {
  EyeIcon,
  EyeSlashIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  AdjustmentsHorizontalIcon,
  RectangleStackIcon,
} from "@heroicons/vue/16/solid";
import type { LayerInstance, LayerCategory } from "#shared/types/editor";
import LAYER_TEMPLATES from "#shared/editor/layer-templates";

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
  composite: RectangleStackIcon,
  distortion: SpeakerWaveIcon,
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
    <UiHover :active="selected" full-width :class="dragging && 'scale-[1.02] shadow-lg'">
      <div
        class="flex h-9 cursor-default items-center gap-2 p-2 outline-none select-none"
        :class="selected ? 'text-neutral-strong' : 'text-neutral-subtle group-hover/h:text-neutral-strong'"
        @click="!isEditing && emit('select')"
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

        <div class="relative grid min-w-0 flex-1 grid-cols-1 grid-rows-1 items-center justify-items-end">
          <span
            v-if="layer.enabled"
            class="pointer-events-none col-start-1 row-start-1 w-full truncate text-right text-sm leading-none text-neutral-subtle group-hover/h:opacity-0"
          >
            {{ template?.label }}
          </span>
          <UiButton
            variant="ghost"
            size="sm"
            :icon-left="visibilityIcon"
            title="Toggle visibility"
            class="col-start-1 row-start-1 !size-6"
            :class="layer.enabled && 'pointer-events-none opacity-0 group-hover/h:pointer-events-auto group-hover/h:opacity-100'"
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
