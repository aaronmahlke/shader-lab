<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";

type Props = {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
};

const {
  side = "bottom",
  align = "center",
  sideOffset = 8,
} = defineProps<Props>();

const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        @open-auto-focus.prevent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :collision-padding="12"
        class="z-50 origin-[var(--reka-popover-content-transform-origin)] rounded-xl border border-neutral bg-layer-1 shadow-panel backdrop-blur-xl outline-none data-[state=open]:data-[side=bottom]:animate-slide-down data-[state=open]:data-[side=top]:animate-slide-up data-[state=open]:data-[side=left]:animate-slide-left data-[state=open]:data-[side=right]:animate-slide-right"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
