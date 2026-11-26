<script setup lang="ts">
import { TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from "reka-ui";

type Props = {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  forceOpen?: boolean;
  disableClosingTrigger?: boolean;
};

const {
  label,
  side = "bottom",
  forceOpen = false,
  disableClosingTrigger = false,
} = defineProps<Props>();
</script>

<template>
  <!-- When forceOpen is true, use controlled mode to keep it open -->
  <TooltipRoot
    v-if="forceOpen"
    :open="true"
    :disable-closing-trigger="disableClosingTrigger"
  >
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side="side"
        :side-offset="4"
        :collision-padding="12"
        data-ui="studio"
        class="z-50 rounded-[var(--s-r-ctl)] bg-[var(--s-band)] px-[6px] py-[3px] text-[var(--s-txt)] shadow-[0_0_0_1px_var(--s-edge),0_4px_12px_#0008]"
      >
        {{ label }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>

  <!-- Default: uncontrolled, reka-ui handles hover state -->
  <TooltipRoot v-else :disable-closing-trigger="disableClosingTrigger">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side="side"
        :side-offset="4"
        :collision-padding="12"
        data-ui="studio"
        class="z-50 rounded-[var(--s-r-ctl)] bg-[var(--s-band)] px-[6px] py-[3px] text-[var(--s-txt)] shadow-[0_0_0_1px_var(--s-edge),0_4px_12px_#0008]"
      >
        {{ label }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
