<script setup lang="ts">
/** A grey tile on the dark frame. `split` lays children out with 2px frame lines between them. */
const { split } = defineProps<{ split?: "row" | "col" }>();
</script>

<template>
  <div
    class="min-h-0 min-w-0 overflow-hidden rounded-[var(--s-r)]"
    :class="split
      ? ['grid gap-[2px] bg-[var(--s-frame)] [&>*]:bg-[var(--s-tile)]', split === 'col' ? 'grid-flow-col auto-cols-fr' : 'grid-flow-row']
      : 'bg-[var(--s-tile)]'"
  >
    <slot />
  </div>
</template>
