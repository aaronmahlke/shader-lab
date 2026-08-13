<script setup lang="ts">
import { PlusIcon } from "@heroicons/vue/16/solid";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
} from "reka-ui";
import type { LayerType } from "@shader-lab/core";

type Emits = {
  select: [type: LayerType];
};

const emit = defineEmits<Emits>();

const open = ref(false);

function openPanel() {
  open.value = true;
}

function onSelect(type: LayerType | null) {
  if (!type) return;
  emit("select", type);
  open.value = false;
}

defineExpose({ open, openPanel });
</script>

<template>
  <div
    class="flex gap-1 rounded-xl border border-neutral bg-layer-1 p-1 shadow-panel backdrop-blur-xl"
  >
    <ComboboxRoot
      :model-value="undefined"
      :open="open"
      ignore-filter
      :reset-search-term-on-select="false"
      :reset-search-term-on-blur="false"
      @update:open="open = $event"
      @update:model-value="onSelect"
    >
      <ComboboxAnchor as-child>
        <UiTooltip label="Add layer" side="bottom" disable-closing-trigger>
          <UiHover
            :active="open"
            class-name="bg-layer-1 border border-neutral group-hover/h:bg-tint"
          >
            <ComboboxTrigger
              class="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-neutral-strong outline-none transition-colors duration-100 ease-out-expo"
              aria-label="Add layer"
            >
              <PlusIcon class="size-4 shrink-0" aria-hidden="true" />
            </ComboboxTrigger>
          </UiHover>
        </UiTooltip>
      </ComboboxAnchor>

      <ComboboxPortal>
        <!-- Fixed, screen-centered (cmd+k style) rather than anchored to the
             + trigger, which sat off-center in the toolbar. -->
        <ComboboxContent
          position="inline"
          class="floating-content-enter fixed top-[14%] left-1/2 z-[9999] flex h-[min(60vh,28rem)] w-[min(92vw,36rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-neutral bg-layer-1 shadow-panel backdrop-blur-xl outline-none"
          @open-auto-focus.prevent
        >
          <EditorLayerAddBarPanel />
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </div>
</template>
