<script setup lang="ts">
/**
 * Figma-style inspector section: an always-visible (non-collapsible) header
 * with the section title and a right-aligned icon-button slot, content below.
 * The container keeps the chrome the inspector blocks already used
 * (p-3, border-b, flex column with gap-2.5) so wrapping existing blocks
 * doesn't shift their layout.
 */
defineProps<{ title: string }>();
</script>

<template>
  <!-- Studio device section: header band + content; sections are separated by the frame. -->
  <section class="flex shrink-0 flex-col border-b-[var(--s-gap)] border-[var(--s-frame)]">
    <div class="flex h-[var(--s-row)] items-center justify-between gap-2 bg-[var(--s-band)] pr-[2px] pl-[6px]">
      <h3 class="select-none">{{ title }}</h3>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-[2px]">
        <slot name="actions" />
      </div>
    </div>
    <div class="flex flex-col gap-[6px] px-[6px] pt-[6px] pb-[8px]">
      <slot />
    </div>
  </section>
</template>
