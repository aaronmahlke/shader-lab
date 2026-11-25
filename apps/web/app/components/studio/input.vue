<script setup lang="ts">
/** Text field: dark inset. Optional leading icon slot (e.g. search). */
const { placeholder, size = "md" } = defineProps<{ placeholder?: string; size?: "md" | "sm" }>();
const model = defineModel<string>({ default: "" });
defineSlots<{ leading?: () => unknown }>();
</script>

<template>
  <label
    class="flex min-w-0 items-center gap-[5px] rounded-[var(--s-r-ctl)] bg-[var(--s-inset)] px-[5px] shadow-[inset_0_0_0_1px_var(--s-edge)] focus-within:shadow-[inset_0_0_0_1px_var(--s-accent)]"
    :class="size === 'md' ? 'h-[var(--s-ctl)]' : 'h-[var(--s-ctl-sm)]'"
  >
    <span v-if="$slots.leading" class="flex shrink-0 text-[var(--s-dim)] [&>svg]:size-3"><slot name="leading" /></span>
    <input
      v-model="model"
      :placeholder="placeholder"
      spellcheck="false"
      class="h-full min-w-0 flex-1 bg-transparent text-[var(--s-bright)] outline-none placeholder:text-[var(--s-dim)]"
      @keydown.stop
    />
  </label>
</template>
