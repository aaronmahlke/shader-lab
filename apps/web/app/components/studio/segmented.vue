<script setup lang="ts" generic="T extends string | number | boolean">
/** Word toggles side by side ("In | Auto | Off"). One active, accent fill. */
const { options } = defineProps<{
  options: { value: T; label: string; disabled?: boolean }[];
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
      :active="model === opt.value"
      :disabled="opt.disabled"
      @click="model = opt.value"
    >
      {{ opt.label }}
    </StudioButton>
  </div>
</template>
