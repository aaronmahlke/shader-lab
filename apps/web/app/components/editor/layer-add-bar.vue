<script setup lang="ts">
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
  <div class="flex">
    <ComboboxRoot
      :model-value="undefined"
      :open="open"
      ignore-filter
      :reset-search-term-on-select="false"
      :reset-search-term-on-blur="false"
      @update:open="open = $event"
      @update:model-value="onSelect"
    >
      <d-tooltip content="Add layer">
        <ComboboxAnchor as-child>
          <ComboboxTrigger
            class="flex size-8 cursor-pointer items-center justify-center rounded-lg text-neutral-subtle outline-none transition-colors hover:bg-tint hover:text-neutral-strong data-[state=open]:bg-tint data-[state=open]:text-neutral-strong"
            aria-label="Add layer"
          >
            <d-icon-plus class="size-4 shrink-0" aria-hidden="true" />
          </ComboboxTrigger>
        </ComboboxAnchor>
      </d-tooltip>

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
