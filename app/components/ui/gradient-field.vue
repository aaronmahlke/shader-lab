<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverContent, PopoverPortal } from "reka-ui";
import type { GradientStop } from "#shared/types";

type Props = {
  label?: string;
};

const { label } = defineProps<Props>();

const model = defineModel<GradientStop[]>({ required: true });

const open = ref(false);

const gradientCSS = computed(() => {
  const sorted = [...model.value].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return "transparent";
  if (sorted.length === 1) return sorted[0].color;
  const stops = sorted.map((s) => `${s.color} ${s.position * 100}%`).join(", ");
  return `linear-gradient(to right, ${stops})`;
});
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span
      v-if="label"
      class="text-copy-sm text-secondary select-none"
    >{{ label }}</span>

    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          class="h-7 w-full cursor-pointer rounded-lg transition-all hover:ring-1 hover:ring-edge"
          :style="{ background: gradientCSS }"
        />
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          side="left"
          :side-offset="8"
          :avoid-collisions="true"
          :collision-padding="{ top: 16, bottom: 16, left: 16, right: 16 }"
          :sticky="'partial'"
          class="floating-content-enter z-50 w-64 origin-[var(--reka-popover-content-transform-origin)] rounded-xl border border-edge bg-base-1 p-3 shadow-2xl backdrop-blur-xl"
        >
          <UiGradientEditor v-model="model" />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
