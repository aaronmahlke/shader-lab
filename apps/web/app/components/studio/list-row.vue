<script setup lang="ts">
/** 19px list row (browser / project panel). Icon, label, trailing meta. */
const { selected = false, depth = 0 } = defineProps<{ selected?: boolean; depth?: number }>();
defineSlots<{ icon?: () => unknown; default?: () => unknown; meta?: () => unknown }>();
</script>

<template>
  <div
    class="flex h-[var(--s-row)] cursor-default items-center gap-[6px] pr-[6px] whitespace-nowrap select-none"
    :class="selected ? 'bg-[var(--s-select)] text-[var(--s-select-txt)]' : 'text-[var(--s-txt)] hover:bg-[var(--s-inset-hover)]'"
    :style="{ paddingLeft: `${6 + depth * 12}px` }"
  >
    <span v-if="$slots.icon" class="flex shrink-0 [&>svg]:size-3"><slot name="icon" /></span>
    <span class="min-w-0 flex-1 truncate"><slot /></span>
    <span v-if="$slots.meta" class="shrink-0" :class="selected ? 'text-[var(--s-select-txt)] opacity-60' : 'text-[var(--s-dim)]'"><slot name="meta" /></span>
  </div>
</template>
