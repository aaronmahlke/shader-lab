<script setup lang="ts" generic="T extends string | number | boolean">
/** Word toggles side by side ("In | Auto | Off"). One active, accent fill. */
const { options, size = "md" } = defineProps<{
  options: { value: T; label: string; disabled?: boolean }[];
  size?: "md" | "sm";
}>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="inline-flex gap-[2px]" role="radiogroup">
    <StudioButton
      v-for="opt in options"
      :key="String(opt.value)"
      role="radio"
      :aria-checked="model === opt.value"
      :size="size"
      :active="model === opt.value"
      :disabled="opt.disabled"
      @click="model = opt.value"
    >
      {{ opt.label }}
    </StudioButton>
  </div>
</template>
