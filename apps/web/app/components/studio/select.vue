<script setup lang="ts" generic="T extends string | number">
/** Dropdown: inset trigger with a solid triangle; flat grey menu. reka-ui handles keyboard/focus. */
import { SelectContent, SelectItem, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectViewport } from "reka-ui";

const { options, placeholder = "Select", size = "md", variant = "inset" } = defineProps<{
  options: { value: T; label: string; disabled?: boolean }[];
  placeholder?: string;
  size?: "md" | "sm";
  variant?: "inset" | "tile";
}>();
const model = defineModel<T>();
const current = computed(() => options.find((o) => o.value === model.value)?.label);
</script>

<template>
  <SelectRoot v-model="model as any">
    <SelectTrigger
      class="flex min-w-0 cursor-default items-center justify-between gap-2 rounded-[var(--s-r-ctl)] pr-[5px] pl-[5px] text-[var(--s-txt)] outline-none select-none focus-visible:ring-1 focus-visible:ring-[var(--s-accent)] data-[placeholder]:text-[var(--s-dim)]"
      :class="[
        size === 'md' ? 'h-[var(--s-ctl)]' : 'h-[var(--s-ctl-sm)]',
        variant === 'inset' ? 'bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)]' : 'bg-[var(--s-tile)] px-[7px] hover:bg-[var(--s-hover)]',
      ]"
    >
      <span class="min-w-0 truncate" :class="current == null && 'text-[var(--s-dim)]'">{{ current ?? placeholder }}</span>
      <svg width="7" height="5" viewBox="0 0 7 5" class="shrink-0" aria-hidden="true"><path d="M0 0h7L3.5 5z" fill="currentColor" /></svg>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="2"
        data-ui="studio"
        class="z-[1000] min-w-[var(--reka-select-trigger-width)] rounded-[var(--s-r-ctl)] bg-[var(--s-band)] p-[2px] shadow-[0_0_0_1px_var(--s-edge),0_6px_16px_#0008]"
      >
        <SelectViewport>
          <SelectItem
            v-for="opt in options"
            :key="String(opt.value)"
            :value="opt.value"
            :disabled="opt.disabled"
            class="flex h-[var(--s-row)] cursor-default items-center rounded-[1px] px-[6px] text-[var(--s-txt)] outline-none select-none data-[disabled]:text-[var(--s-off)] data-[highlighted]:bg-[var(--s-sel)] data-[highlighted]:text-[var(--s-bright)] data-[state=checked]:text-[var(--s-accent)]"
          >
            <SelectItemText>{{ opt.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
