<script setup lang="ts">
import { ContextMenuRoot, ContextMenuTrigger, ContextMenuPortal, ContextMenuContent } from "reka-ui";

const emit = defineEmits<{
  /** Fired when the menu closes and is about to restore focus to the trigger. Preventable. */
  closeAutoFocus: [event: Event];
}>();
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent
        :collision-padding="12"
        @close-auto-focus="emit('closeAutoFocus', $event)"
        class="floating-content-enter z-[9999] min-w-40 origin-[var(--reka-context-menu-content-transform-origin)] rounded-xl border border-edge bg-base-1 p-1 shadow-2xl backdrop-blur-xl"
      >
        <slot name="menu" />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
