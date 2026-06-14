<script setup lang="ts">
type Props = {
  active?: boolean;
};

const { active = false } = defineProps<Props>();
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    :class="active ? 'size-3' : 'size-2.5'"
  >
    <circle
      cx="12"
      cy="12"
      :r="active ? 3 : 2"
      :class="active ? 'fill-accent' : 'fill-current opacity-50'"
    />
  </svg>
</template>
