<script setup lang="ts">
import {
  SparklesIcon,
  ArrowsPointingOutIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/vue/16/solid";
import type { Component } from "vue";
import type { LayerCategory, LayerType } from "#shared/types/editor";

type Emits = {
  select: [type: LayerType];
};

const emit = defineEmits<Emits>();

type CategoryEntry = {
  key: LayerCategory;
  label: string;
  icon: Component;
};

const categories: CategoryEntry[] = [
  { key: "generator", label: "Generators", icon: SparklesIcon },
  { key: "distortion", label: "Distortions", icon: ArrowsPointingOutIcon },
  { key: "effect", label: "Effects", icon: AdjustmentsHorizontalIcon },
];

const open = reactive<Record<LayerCategory, boolean>>({
  generator: false,
  distortion: false,
  effect: false,
});

function handleSelect(type: LayerType, category: LayerCategory) {
  open[category] = false;
  emit("select", type);
}
</script>

<template>
  <div
    class="flex gap-1 rounded-xl border border-neutral bg-layer-1 p-1 shadow-panel backdrop-blur-xl"
  >
    <UiPopover
      v-for="category in categories"
      :key="category.key"
      v-model:open="open[category.key]"
      side="bottom"
      align="center"
    >
      <template #trigger>
        <EditorLayerAddTrigger
          :label="category.label"
          :icon="category.icon"
        />
      </template>
      <EditorLayerPicker
        :category="category.key"
        @select="handleSelect($event, category.key)"
      />
    </UiPopover>
  </div>
</template>
