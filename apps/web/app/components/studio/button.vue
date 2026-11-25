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
  size = "md",
  active = false,
  disabled = false,
  square = false,
} = defineProps<{
  variant?: "inset" | "tile" | "ghost";
  size?: "md" | "sm";
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
    class="inline-flex shrink-0 cursor-default items-center justify-center gap-1 whitespace-nowrap rounded-[var(--s-r-ctl)] outline-none select-none focus-visible:ring-1 focus-visible:ring-[var(--s-accent)] disabled:text-[var(--s-off)] [&>svg]:size-3 [&>svg]:shrink-0"
    :class="[
      size === 'md' ? 'h-[var(--s-ctl)]' : 'h-[var(--s-ctl-sm)]',
      square ? (size === 'md' ? 'w-[var(--s-ctl)]' : 'w-[var(--s-ctl-sm)]') : variant === 'tile' ? 'px-[7px]' : 'px-[5px]',
      active && !disabled
        ? 'bg-[var(--s-accent)] text-[var(--s-on-txt)]'
        : variant === 'inset'
          ? 'bg-[var(--s-inset)] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] hover:text-[var(--s-bright)]'
          : variant === 'tile'
            ? 'bg-[var(--s-tile)] text-[var(--s-txt)] hover:bg-[var(--s-hover)]'
            : 'text-[var(--s-txt)] hover:bg-[var(--s-hover)]',
    ]"
  >
    <slot />
  </button>
</template>
