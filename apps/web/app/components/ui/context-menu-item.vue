<script setup lang="ts">
import { ContextMenuItem } from "reka-ui";

/** Studio menu row; `danger` for destructive actions. */
const { tone } = defineProps<{ tone?: "danger" }>();
</script>

<template>
  <ContextMenuItem
    class="flex h-[var(--s-row)] cursor-default items-center gap-[6px] rounded-[1px] px-[6px] outline-none select-none data-[highlighted]:bg-[var(--s-select)] data-[highlighted]:text-[var(--s-select-txt)] data-[disabled]:text-[var(--s-off)]"
    :class="tone === 'danger' ? 'text-[var(--s-danger)]' : 'text-[var(--s-txt)]'"
  >
    <slot />
  </ContextMenuItem>
</template>
