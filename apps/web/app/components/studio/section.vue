<script setup lang="ts">
/**
 * Device-style section: header band (LED, title, actions) over content.
 * The LED toggles the section (e.g. effect on/off) when `enabled` is bound.
 */
const { title, collapsible = false } = defineProps<{ title: string; collapsible?: boolean }>();
const enabled = defineModel<boolean | undefined>("enabled", { default: undefined });
const open = defineModel<boolean>("open", { default: true });
defineSlots<{ default?: () => unknown; actions?: () => unknown }>();
</script>

<template>
  <section class="bg-[var(--s-tile)]">
    <header class="flex h-[var(--s-row)] items-center gap-[6px] bg-[var(--s-band)] pr-[3px] pl-[5px]">
      <button
        v-if="enabled !== undefined"
        type="button"
        class="size-[9px] shrink-0 cursor-default rounded-full outline-none"
        :class="enabled ? 'bg-[var(--s-accent)]' : 'bg-[var(--s-off)]'"
        :aria-label="enabled ? `Turn ${title} off` : `Turn ${title} on`"
        @click="enabled = !enabled"
      />
      <button
        v-if="collapsible"
        type="button"
        class="flex cursor-default items-center gap-[5px] text-[var(--s-txt)] outline-none"
        @click="open = !open"
      >
        <svg width="7" height="7" viewBox="0 0 7 7" :class="!open && '-rotate-90'" aria-hidden="true"><path d="M0 1.5h7L3.5 6z" fill="currentColor" /></svg>
        {{ title }}
      </button>
      <span v-else class="text-[var(--s-txt)]">{{ title }}</span>
      <span class="flex-1" />
      <slot name="actions" />
    </header>
    <div v-if="open" class="px-[6px] pt-[5px] pb-[7px]"><slot /></div>
  </section>
</template>
