<script setup lang="ts">
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
} from "reka-ui";

type Props = {
  options: { value: string | number; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  label?: string;
};

const { options, placeholder = "Select...", disabled = false } = defineProps<Props>();
const model = defineModel<string | number | null>();
const open = ref(false);

// Highlight events let parents live-preview an option before it is committed
// (e.g. blend modes). `highlight` fires when an option is hovered or keyboard-
// focused; `highlight-end` fires when the pointer leaves the list or the
// dropdown closes. `select` always fires on selection, unlike
// `update:model-value` which reka-ui skips when the value is unchanged - and
// with a live preview the document value already equals the clicked option.
// `select` is emitted before `highlight-end`, so a committed value is never
// reverted by the preview.
const emit = defineEmits<{
  highlight: [value: string | number];
  "highlight-end": [];
  select: [value: string | number];
}>();

watch(open, (isOpen) => {
  if (!isOpen) emit("highlight-end");
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-[3px]">
    <span v-if="label" class="truncate select-none">{{ label }}</span>
    <SelectRoot v-model="model" :open="open" @update:open="open = $event">
      <SelectTrigger
        :disabled="disabled"
        class="flex h-[var(--s-ctl)] min-w-0 cursor-default items-center justify-between gap-2 bg-[var(--s-inset)] px-[5px] text-[var(--s-txt)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none select-none focus-visible:shadow-[inset_0_0_0_1px_var(--s-ring)] data-[state=open]:shadow-[inset_0_0_0_1px_var(--s-ring)]"
        :class="disabled ? 'opacity-50' : 'hover:bg-[var(--s-inset-hover)]'"
      >
        <span class="min-w-0 truncate"><SelectValue :placeholder="placeholder" /></span>
        <svg width="7" height="5" viewBox="0 0 7 5" class="shrink-0" aria-hidden="true"><path d="M0 0h7L3.5 5z" fill="currentColor" /></svg>
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          position="popper"
          side="bottom"
          align="start"
          :side-offset="2"
          :collision-padding="12"
          data-ui="studio"
          class="z-[9999] min-w-[var(--reka-select-trigger-width)] bg-[var(--s-band)] p-[2px] shadow-[0_0_0_1px_var(--s-edge),0_6px_16px_#0008]"
          @pointerleave="emit('highlight-end')"
        >
          <SelectViewport class="max-h-64 overflow-auto">
            <SelectItem
              v-for="option in options"
              :key="String(option.value)"
              :value="option.value as string | number"
              class="flex h-[var(--s-row)] cursor-default items-center justify-between px-[6px] text-[var(--s-txt)] outline-none select-none data-[state=checked]:text-[var(--s-accent)] data-[highlighted]:bg-[var(--s-select)] data-[highlighted]:text-[var(--s-select-txt)]"
              @pointerenter="emit('highlight', option.value)"
              @focus="emit('highlight', option.value)"
              @select="emit('select', option.value)"
            >
              <SelectItemText>
                {{ option.label }}
              </SelectItemText>
              <SelectItemIndicator>
                
              </SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
