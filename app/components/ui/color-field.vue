<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";

type Props = {
  label?: string;
};

const { label } = defineProps<Props>();

const model = defineModel<string>({ default: "#000000" });

const open = ref(false);
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <span
      v-if="label"
      class="text-copy-sm text-secondary select-none"
    >{{ label }}</span>

    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          class="group flex h-7 items-center gap-2 rounded-lg border border-edge bg-surface-1 px-1.5 transition-colors hover:bg-surface-2"
        >
          <div
            class="size-4 rounded border border-edge-subtle"
            :style="{ backgroundColor: model }"
          />
          <span class="font-mono text-copy-sm text-tertiary uppercase group-hover:text-secondary">
            {{ model }}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          side="left"
          :side-offset="8"
          :avoid-collisions="true"
          :collision-padding="{ top: 16, bottom: 16, left: 16, right: 16 }"
          :sticky="'partial'"
          class="floating-content-enter z-50 w-56 origin-[var(--reka-popover-content-transform-origin)] rounded-xl border border-edge bg-base-1 p-3 shadow-2xl backdrop-blur-xl"
        >
          <UiColorPicker v-model="model" />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
