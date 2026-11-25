<script setup lang="ts">
type Props = {
  label?: string;
  disabled?: boolean;
};

const { label, disabled = false } = defineProps<Props>();

const model = defineModel<boolean>({ default: false });
</script>

<template>
  <!-- Studio: label left, On | Off word toggles right (see /kitchen/segmented). -->
  <div class="flex min-h-[var(--s-ctl)] items-center justify-between gap-2" :class="disabled && 'pointer-events-none opacity-50'">
    <span v-if="label" class="truncate select-none">{{ label }}</span>
    <StudioSegmented
      :model-value="model"
      :options="[{ value: true, label: 'On' }, { value: false, label: 'Off' }]"
      role="switch"
      :aria-checked="model"
      @update:model-value="model = $event"
    />
  </div>
</template>
