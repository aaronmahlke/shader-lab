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
        data-ui="studio"
        class="z-[9999] min-w-[160px] rounded-[var(--s-r-ctl)] bg-[var(--s-band)] p-[2px] text-[var(--s-txt)] shadow-[0_0_0_1px_var(--s-edge),0_6px_16px_#0008] outline-none"
      >
        <slot name="menu" />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
