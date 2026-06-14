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
        :side-offset="8"
        :collision-padding="12"
        class="z-50 rounded-lg border border-edge bg-base-1 px-2.5 py-1.5 text-copy-sm text-secondary shadow-lg backdrop-blur-xl animate-contentShow"
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
        :side-offset="8"
        :collision-padding="12"
        class="z-50 rounded-lg border border-edge bg-base-1 px-2.5 py-1.5 text-copy-sm text-secondary shadow-lg backdrop-blur-xl data-[state=delayed-open]:animate-contentShow"
      >
        {{ label }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
