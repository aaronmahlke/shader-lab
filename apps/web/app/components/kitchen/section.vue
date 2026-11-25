<script setup lang="ts">
/**
 * One labelled example. Without a title it's the page's main example (taller).
 * `on="frame"` shows the example on the dark frame (for tile-variant controls),
 * default is on a grey tile (where most controls live).
 */
const { title, description, on = "tile", align = "center" } = defineProps<{
  title?: string;
  description?: string;
  on?: "tile" | "frame";
  align?: "center" | "start";
}>();
</script>

<template>
  <section class="flex flex-col gap-[8px]">
    <div v-if="title || description" class="flex flex-col gap-[3px]">
      <h2 v-if="title" class="text-[14px] font-semibold text-[var(--s-bright)]">{{ title }}</h2>
      <p v-if="description" class="leading-[1.5] text-[var(--s-dim)]">{{ description }}</p>
    </div>
    <div
      class="flex flex-wrap gap-[8px] rounded-[var(--s-r)] p-[20px] shadow-[inset_0_0_0_1px_#ffffff0d]"
      :class="[
        on === 'tile' ? 'bg-[var(--s-tile)]' : 'bg-[var(--s-frame)]',
        align === 'center' ? 'items-center justify-center' : 'items-start justify-start',
        title ? 'min-h-[96px]' : 'min-h-[160px]',
      ]"
    >
      <slot />
    </div>
  </section>
</template>
