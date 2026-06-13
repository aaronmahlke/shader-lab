<script setup lang="ts">
import { PlusIcon } from "@heroicons/vue/16/solid";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
} from "reka-ui";
import type { LayerType } from "#shared/types/editor";

type Emits = {
  select: [type: LayerType];
};

const emit = defineEmits<Emits>();

const open = ref(false);

function onSelect(type: LayerType | null) {
  if (!type) return;
  emit("select", type);
  open.value = false;
}
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
        <ComboboxContent
          position="popper"
          side="bottom"
          align="center"
          :side-offset="10"
          :collision-padding="12"
          class="floating-content-enter z-[9999] flex h-[min(60vh,28rem)] w-[min(92vw,36rem)] origin-[var(--reka-combobox-content-transform-origin)] flex-col overflow-hidden rounded-2xl border border-neutral bg-layer-1 shadow-panel backdrop-blur-xl outline-none"
          @open-auto-focus.prevent
        >
          <EditorLayerAddBarPanel />
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </div>
</template>
