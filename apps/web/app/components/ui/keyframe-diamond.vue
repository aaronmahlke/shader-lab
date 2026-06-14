<script setup lang="ts">
defineOptions({ inheritAttrs: false });

type Props = {
  selected?: boolean;
};

const { selected = false } = defineProps<Props>();
</script>

<template>
  <svg
    v-bind="$attrs"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M8.14258 15.1421L1.07151 8.07107L8.14258 1V15.1421Z"
      :class="selected ? 'fill-accent' : 'fill-white'"
    />
    <path
      d="M8.14258 0.999954L15.2136 8.07102L8.14258 15.1421V0.999954Z"
      :class="selected ? 'fill-accent opacity-50' : 'fill-white opacity-50'"
    />
  </svg>
</template>
