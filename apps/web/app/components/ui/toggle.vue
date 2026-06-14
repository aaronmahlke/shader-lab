<script setup lang="ts">
type Props = {
  label?: string;
  disabled?: boolean;
};

const { label, disabled = false } = defineProps<Props>();

const model = defineModel<boolean>({ default: false });
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <span
      v-if="label"
      class="text-copy-sm text-secondary select-none"
    >{{ label }}</span>
    <button
      role="switch"
      :aria-checked="model"
      :disabled="disabled"
      :class="[
        'relative h-5 w-9 shrink-0 rounded-full border p-0.5 transition-colors duration-150',
        model
          ? 'border-edge bg-inverse'
          : 'border-edge bg-surface-1',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ]"
      @click="model = !model"
    >
      <div
        :class="[
          'size-3.5 rounded-full shadow-sm transition-transform duration-150 ease-out-expo',
          model
            ? 'translate-x-4 bg-base-0'
            : 'translate-x-0 bg-surface-3',
        ]"
      />
    </button>
  </div>
</template>
