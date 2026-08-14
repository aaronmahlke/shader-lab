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
  <section class="flex shrink-0 flex-col gap-2.5 border-b border-neutral p-3">
    <div class="flex h-6 items-center justify-between gap-2">
      <h3 class="text-copy-sm text-secondary select-none">
        {{ title }}
      </h3>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-0.5">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>
