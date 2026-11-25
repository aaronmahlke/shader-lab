<script setup lang="ts">
/** Label above a control (Ableton device layout). `inline` puts the label left instead. */
const { label, inline = false } = defineProps<{ label: string; inline?: boolean }>();
</script>

<template>
  <div :class="inline ? 'grid grid-cols-[84px_minmax(0,1fr)] items-center gap-[6px]' : 'flex min-w-0 flex-col gap-[3px]'">
    <span class="truncate text-[var(--s-txt)]">{{ label }}</span>
    <slot />
  </div>
</template>
