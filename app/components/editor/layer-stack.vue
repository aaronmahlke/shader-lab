<script setup lang="ts">
import { PlusIcon } from "lucide-vue-next";
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";
import type { LayerInstance, LayerType } from "#shared/types/editor";

type Emits = {
  "add-layer": [type: LayerType];
  "remove-layer": [id: string];
  "duplicate-layer": [id: string];
};

const layers = defineModel<LayerInstance[]>("layers", { required: true });
const selectedLayerId = defineModel<string | null>("selectedLayerId", { required: true });
const emit = defineEmits<Emits>();

const pickerOpen = ref(false);

const { containerRef, draggingIndex } = useDragReorder(layers);

function toggleEnabled(layer: LayerInstance) {
  selectedLayerId.value = layer.id;
  layer.enabled = !layer.enabled;
}

function handleAddLayer(type: LayerType) {
  pickerOpen.value = false;
  emit("add-layer", type);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2.5">
        <span class="text-copy-sm text-primary select-none">Layers</span>
        <PopoverRoot v-model:open="pickerOpen">
          <PopoverTrigger as="button" class="flex size-6 cursor-default items-center justify-center rounded-md text-tertiary transition-colors duration-150 hover:bg-surface-1 hover:text-secondary">
            <PlusIcon class="size-3.5" />
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              side="right"
              :side-offset="12"
              :collision-padding="12"
              class="z-50 rounded-xl border border-edge bg-base-1 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
            >
              <EditorLayerPicker @select="handleAddLayer" />
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>

      <div
        ref="containerRef"
        class="flex-1 overflow-y-auto p-2"
      >
        <EditorLayerRow
          v-for="(layer, i) in layers"
          :key="layer.id"
          :layer="layer"
          :selected="selectedLayerId === layer.id"
          :dragging="draggingIndex === i"
          @select="selectedLayerId = layer.id"
          @toggle-enabled="toggleEnabled(layer)"
          @duplicate="emit('duplicate-layer', layer.id)"
          @remove="emit('remove-layer', layer.id)"
          @update:name="layer.name = $event"
        />
      </div>
    </div>
  </div>
</template>
