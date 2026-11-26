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
      class="select-none"
    >{{ label }}</span>

    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          class="group flex h-[var(--s-ctl)] cursor-default items-center gap-[5px] px-[3px] bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)]"
        >
          <div
            class="size-4 rounded border border-edge-subtle"
            :style="{ backgroundColor: model }"
          />
          <span class="tabular-nums text-[var(--s-dim)] uppercase group-hover:text-[var(--s-txt)]">
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
          data-ui="studio"
          class="w-56 z-50 rounded-[var(--s-r-ctl)] bg-[var(--s-band)] p-[6px] shadow-[0_0_0_1px_var(--s-edge),0_6px_16px_#0008]"
        >
          <UiColorPicker v-model="model" />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
