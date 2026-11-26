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
const { variant = "inset" } = defineProps<{ variant?: "inset" | "tile" }>();

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
        <ComboboxAnchor as-child>
          <ComboboxTrigger
            class="flex cursor-default items-center justify-center text-[var(--s-txt)] outline-none hover:text-[var(--s-bright)] data-[state=open]:bg-[var(--s-accent)] data-[state=open]:text-[var(--s-on-txt)]"
            :class="variant === 'tile'
              ? 'size-[18px] bg-[var(--s-tile)] hover:bg-[var(--s-hover)]'
              : 'size-[var(--s-ctl)] bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)]'"
            aria-label="Add layer"
            title="Add layer"
          >
            <StudioIcon name="plus" />
          </ComboboxTrigger>
        </ComboboxAnchor>

      <ComboboxPortal>
        <!-- Fixed, screen-centered (cmd+k style) rather than anchored to the
             + trigger, which sat off-center in the toolbar. -->
        <ComboboxContent
          position="inline"
          data-ui="studio"
          class="fixed top-[14%] left-1/2 z-[9999] flex h-[min(60vh,28rem)] w-[min(92vw,34rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)] shadow-[0_0_0_1px_var(--s-edge),0_12px_32px_#000b] outline-none"
          @open-auto-focus.prevent
        >
          <EditorLayerAddBarPanel />
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </div>
</template>
