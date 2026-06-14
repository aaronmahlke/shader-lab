<script setup lang="ts">
import { ChevronRightIcon } from "@heroicons/vue/16/solid";
import type { LayerInstance, LFOSource } from "@shader-lab/core";

type Emits = {
  "remove-layer": [id: string];
  "duplicate-layer": [id: string];
  "drag-start": [lfoId: string, x: number, y: number];
  "duplicate-lfo": [lfoId: string];
  "clear-assignments": [lfoId: string];
  "delete-lfo": [lfoId: string];
};

const layers = defineModel<LayerInstance[]>("layers", { required: true });
const selectedLayerId = defineModel<string | null>("selectedLayerId", { required: true });
const shaderName = defineModel<string>("shaderName", { required: true });
const lfos = defineModel<LFOSource[]>("lfos", { required: true });
const selectedLfoId = defineModel<string | null>("selectedLfoId", { required: true });

const { homeTo = "/", lfoCursorPosition } = defineProps<{
  homeTo?: string;
  lfoCursorPosition?: number;
}>();

const emit = defineEmits<Emits>();

const { containerRef, draggingIndex } = useDragReorder(layers);

function toggleEnabled(layer: LayerInstance) {
  selectedLayerId.value = layer.id;
  layer.enabled = !layer.enabled;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Project header -->
    <div class="flex shrink-0 items-center gap-2 border-b border-neutral p-2">
      <UiHover>
        <NuxtLink
          :to="homeTo"
          class="flex size-8 items-center justify-center text-neutral-subtle outline-none group-hover/h:text-neutral-strong"
          title="Shader Lab"
        >
          <ChevronRightIcon class="size-4 rotate-180" />
        </NuxtLink>
      </UiHover>
      <UiEditableText
        v-model="shaderName"
        fill
        class="min-w-0 flex-1 text-copy-sm text-neutral-strong"
      />
    </div>

    <!-- Layer list -->
    <div
      ref="containerRef"
      class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1"
      @click="selectedLayerId = null"
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

    <!-- LFO list -->
    <EditorLfoList
      v-model:lfos="lfos"
      v-model:selected-lfo-id="selectedLfoId"
      :cursor-position="lfoCursorPosition"
      @drag-start="(id, x, y) => emit('drag-start', id, x, y)"
      @duplicate-lfo="emit('duplicate-lfo', $event)"
      @clear-assignments="emit('clear-assignments', $event)"
      @delete-lfo="emit('delete-lfo', $event)"
    />
  </div>
</template>
