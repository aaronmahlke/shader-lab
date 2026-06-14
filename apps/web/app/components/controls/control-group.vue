<script setup lang="ts">
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui";
import { ChevronRightIcon, CubeIcon } from "@heroicons/vue/16/solid";

type Props = {
  label: string;
  defaultOpen?: boolean;
};

type Emits = {
  randomize: [];
};

const { label, defaultOpen = true } = defineProps<Props>();
const emit = defineEmits<Emits>();

const open = ref(defaultOpen);
</script>

<template>
  <CollapsibleRoot v-model:open="open">
    <div class="flex w-full items-center justify-between pr-2">
      <CollapsibleTrigger
        class="flex flex-1 cursor-default items-center gap-1.5 px-3 py-2 text-copy-sm text-secondary transition-colors select-none hover:text-primary"
      >
        <ChevronRightIcon
          :class="[
            'size-4 text-tertiary transition-transform duration-150 ease-out-expo',
            open && 'rotate-90',
          ]"
        />
        {{ label }}
      </CollapsibleTrigger>
      <UiButton
        variant="ghost"
        size="sm"
        :icon-left="CubeIcon"
        title="Randomize"
        @click="emit('randomize')"
      />
    </div>
    <CollapsibleContent
      class="overflow-hidden data-[state=closed]:animate-collapse data-[state=open]:animate-expand"
    >
      <div class="flex flex-col gap-2.5 px-3 pb-3">
        <slot />
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
