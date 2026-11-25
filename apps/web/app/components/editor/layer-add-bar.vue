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
            class="flex size-[var(--s-ctl)] cursor-default items-center justify-center bg-[var(--s-inset)] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none hover:bg-[var(--s-inset-hover)] hover:text-[var(--s-bright)] data-[state=open]:bg-[var(--s-accent)] data-[state=open]:text-[var(--s-on-txt)]"
            aria-label="Add layer"
          >
            <StudioIcon name="plus" />
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
