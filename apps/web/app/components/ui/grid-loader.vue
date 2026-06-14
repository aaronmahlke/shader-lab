<script setup lang="ts">
type Props = {
  small?: boolean;
};

const { small = false } = defineProps<Props>();
</script>

<template>
  <div
    :class="
      small
        ? 'grid size-[10px] grid-cols-3 gap-px'
        : 'grid size-4 grid-cols-3 gap-0.5'
    "
  >
    <div
      v-for="i in 9"
      :key="i"
      :class="
        small
          ? 'size-[2px] rounded-[0.5px] bg-current animate-grid-dot-fast'
          : 'size-[3px] rounded-[0.5px] bg-current animate-grid-dot'
      "
      :style="{ animationDelay: `${(i - 1) * (small ? 60 : 80)}ms` }"
    />
  </div>
</template>
