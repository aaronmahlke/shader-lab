<script setup lang="ts">
import type { LayerType, LayerCategory } from "#shared/types/editor";
import LAYER_TEMPLATES from "#shared/editor/layer-templates";

type Props = {
  category: LayerCategory;
};

type Emits = {
  select: [type: LayerType];
};

const { category } = defineProps<Props>();
const emit = defineEmits<Emits>();

const items = computed(() =>
  Object.entries(LAYER_TEMPLATES)
    .filter(([, tpl]) => tpl.category === category)
    .map(([type, tpl]) => ({
      type: type as LayerType,
      label: tpl.label,
      description: tpl.description,
    })),
);
</script>

<template>
  <div class="flex w-56 flex-col gap-0.5 p-2">
    <button
      v-for="item in items"
      :key="item.type"
      class="flex cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-1 active:bg-surface-2"
      @click="emit('select', item.type)"
    >
      <span class="text-copy-sm text-primary select-none">{{ item.label }}</span>
      <span class="text-copy-sm text-tertiary select-none">{{ item.description }}</span>
    </button>
  </div>
</template>
