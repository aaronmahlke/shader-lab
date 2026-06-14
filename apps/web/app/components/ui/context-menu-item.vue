<script setup lang="ts">
import { ContextMenuItem } from "reka-ui";
</script>

<template>
  <ContextMenuItem class="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-copy-sm text-primary select-none hover:bg-surface-1 focus:bg-surface-1 focus:outline-0">
    <slot />
  </ContextMenuItem>
</template>
