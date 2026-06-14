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
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "@heroicons/vue/16/solid";

type Props = {
  options: { value: string | number; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  label?: string;
};

const { options, placeholder = "Select...", disabled = false } = defineProps<Props>();
const model = defineModel<string | number | null>();
const open = ref(false);
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span v-if="label" class="text-copy-sm text-secondary select-none">{{ label }}</span>
    <SelectRoot v-model="model" :open="open" @update:open="open = $event">
      <SelectTrigger
        :disabled="disabled"
        class="flex h-7 cursor-default items-center justify-between rounded-lg border border-edge bg-base-1 px-2.5 text-copy-sm text-primary outline-none transition-colors duration-150 select-none"
        :class="disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-edge hover:bg-surface-1'"
      >
        <SelectValue :placeholder="placeholder" />
        <ChevronDownIcon v-if="!open" class="ml-2 size-4 text-tertiary" />
        <ChevronUpIcon v-else class="ml-2 size-4 text-tertiary" />
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          position="popper"
          side="bottom"
          align="start"
          :side-offset="4"
          :collision-padding="12"
          class="floating-content-enter z-[9999] w-[var(--reka-select-trigger-width)] origin-[var(--reka-select-content-transform-origin)] rounded-xl border border-edge bg-base-1 shadow-2xl backdrop-blur-xl"
        >
          <SelectViewport class="max-h-48 overflow-auto p-1">
            <SelectItem
              v-for="option in options"
              :key="String(option.value)"
              :value="option.value as string | number"
              class="flex cursor-default items-center justify-between rounded-md px-2.5 py-1.5 text-copy-sm text-primary transition-colors duration-150 select-none hover:bg-surface-1 focus:bg-surface-1 focus:outline-0"
            >
              <SelectItemText>
                {{ option.label }}
              </SelectItemText>
              <SelectItemIndicator>
                <CheckIcon class="ml-2 size-4 text-secondary" />
              </SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
