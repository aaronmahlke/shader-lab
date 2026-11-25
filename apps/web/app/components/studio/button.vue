<script setup lang="ts">
/**
 * Studio button. Variants:
 * - inset (default): dark field with an edge, for controls inside tiles
 * - tile: grey box sitting on the dark frame (top bar, tabs)
 * - ghost: no background until hover
 * `active` = the "on" state (accent fill), for toggles and the main action.
 */
const {
  variant = "inset",
  active = false,
  disabled = false,
  square = false,
} = defineProps<{
  variant?: "inset" | "tile" | "ghost";
  active?: boolean;
  disabled?: boolean;
  /** Icon-only: square box */
  square?: boolean;
}>();
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-pressed="active || undefined"
    class="inline-flex shrink-0 cursor-default items-center justify-center gap-1 whitespace-nowrap rounded-[var(--s-r-ctl)] outline-none select-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--s-ring)] disabled:text-[var(--s-off)] [&>svg]:size-3 [&>svg]:shrink-0"
    :class="[
      'h-[var(--s-ctl)]',
      square ? 'w-[var(--s-ctl)]' : variant === 'tile' ? 'px-[7px]' : 'px-[5px]',
      active && !disabled
        ? 'bg-[var(--s-accent)] text-[var(--s-on-txt)]'
        : variant === 'inset'
          ? 'bg-[var(--s-inset)] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:bg-[var(--s-inset-hover)] hover:text-[var(--s-bright)]'
          : variant === 'tile'
            ? 'bg-[var(--s-tile)] text-[var(--s-txt)] hover:bg-[var(--s-hover)]'
            : 'text-[var(--s-txt)] hover:bg-[var(--s-hover)]',
    ]"
  >
    <slot />
  </button>
</template>
