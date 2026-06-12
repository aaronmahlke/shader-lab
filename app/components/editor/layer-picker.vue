<script setup lang="ts">
import type { LayerType, LayerCategory } from "#shared/types/editor";
import LAYER_TEMPLATES from "#shared/editor/layer-templates";

type Emits = {
  select: [type: LayerType];
};

const emit = defineEmits<Emits>();

type CategoryGroup = {
  key: LayerCategory;
  label: string;
  items: { type: LayerType; label: string; description: string }[];
};

const categories = computed<CategoryGroup[]>(() => {
  const map: Record<LayerCategory, CategoryGroup> = {
    generator: { key: "generator", label: "Generators", items: [] },
    composite: { key: "composite", label: "Composite", items: [] },
    distortion: { key: "distortion", label: "Distortions", items: [] },
    effect: { key: "effect", label: "Effects", items: [] },
  };

  for (const [type, tpl] of Object.entries(LAYER_TEMPLATES)) {
    map[tpl.category]?.items.push({
      type: type as LayerType,
      label: tpl.label,
      description: tpl.description,
    });
  }

  return Object.values(map).filter((g) => g.items.length > 0);
});
</script>

<template>
  <div class="flex w-64 flex-col gap-3 p-3">
    <div v-for="group in categories" :key="group.key" class="flex flex-col gap-1">
      <span class="px-2 text-copy-sm text-tertiary select-none">
        {{ group.label }}
      </span>
      <div class="flex flex-col">
        <button
          v-for="item in group.items"
          :key="item.type"
          class="flex cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-1 active:bg-surface-2"
          @click="emit('select', item.type)"
        >
          <span class="text-copy-sm text-primary select-none">{{ item.label }}</span>
          <span class="text-copy-sm text-tertiary select-none">{{ item.description }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
