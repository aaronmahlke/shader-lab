<script setup lang="ts">
import { PlusIcon } from "lucide-vue-next";
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";
import type { ArtworkLayer } from "#shared/types/artwork";

const layers = defineModel<ArtworkLayer[]>("layers", { required: true });
const selectedLayerId = defineModel<string | null>("selectedLayerId", { required: true });

const props = defineProps<{
  layerLabel: (layer: ArtworkLayer) => string;
}>();

const emit = defineEmits<{
  addText: [];
  addImage: [];
  addVideo: [];
  pickShader: [];
  removeLayer: [id: string];
}>();

const pickerOpen = ref(false);
const { containerRef, draggingIndex } = useDragReorder(layers);

function selectLayer(id: string) {
  selectedLayerId.value = id;
}

function toggleEnabled(layer: ArtworkLayer) {
  layer.enabled = !layer.enabled;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2.5">
        <span class="text-copy-sm text-primary select-none">Layers</span>
        <PopoverRoot v-model:open="pickerOpen">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="flex size-6 cursor-default items-center justify-center rounded-md text-tertiary transition-colors duration-150 hover:bg-surface-1 hover:text-secondary"
              title="Add layer"
            >
              <PlusIcon class="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              side="right"
              :side-offset="12"
              :collision-padding="12"
              class="z-50 flex min-w-[8rem] flex-col gap-0.5 rounded-xl border border-edge bg-base-1 p-2 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
            >
              <button
                type="button"
                class="rounded-lg px-2 py-1.5 text-left text-copy-sm text-primary hover:bg-surface-1"
                @click="emit('pickShader'); pickerOpen = false"
              >
                Shader
              </button>
              <button
                type="button"
                class="rounded-lg px-2 py-1.5 text-left text-copy-sm text-primary hover:bg-surface-1"
                @click="emit('addText'); pickerOpen = false"
              >
                Text
              </button>
              <button
                type="button"
                class="rounded-lg px-2 py-1.5 text-left text-copy-sm text-primary hover:bg-surface-1"
                @click="emit('addImage'); pickerOpen = false"
              >
                Image
              </button>
              <button
                type="button"
                class="rounded-lg px-2 py-1.5 text-left text-copy-sm text-primary hover:bg-surface-1"
                @click="emit('addVideo'); pickerOpen = false"
              >
                Video
              </button>
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>

      <div
        ref="containerRef"
        class="flex-1 overflow-y-auto p-2"
      >
        <p
          v-if="layers.length === 0"
          class="px-2 py-6 text-center text-copy-sm text-tertiary"
        >
          No layers yet. Use + to add a shader, text, image, or video.
        </p>
        <ArtworkLayerRow
          v-for="(layer, i) in layers"
          :key="layer.id"
          :layer="layer"
          :label="props.layerLabel(layer)"
          :selected="selectedLayerId === layer.id"
          :dragging="draggingIndex === i"
          @select="selectLayer(layer.id)"
          @toggle-enabled="toggleEnabled(layer)"
          @remove="emit('removeLayer', layer.id)"
        />
      </div>
    </div>
  </div>
</template>
