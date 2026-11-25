<script setup lang="ts">
/** Grey tab boxes on the dark frame (comp tabs). Middle-click closes. */
const { tabs, closable = false } = defineProps<{
  tabs: { id: string; label: string }[];
  closable?: boolean;
}>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ close: [id: string]; add: [] }>();
</script>

<template>
  <div class="flex min-w-0 items-center gap-[2px]" role="tablist">
    <div
      v-for="tab in tabs"
      :key="tab.id"
      role="tab"
      :aria-selected="model === tab.id"
      class="group flex h-[18px] shrink-0 cursor-default items-center gap-[4px] rounded-[var(--s-r-ctl)] pr-[3px] pl-[7px] select-none"
      :class="model === tab.id ? 'bg-[var(--s-raise)] text-[var(--s-bright)]' : 'bg-[var(--s-tile)] text-[var(--s-dim)] hover:text-[var(--s-txt)]'"
      @click="model = tab.id"
      @pointerdown.middle.prevent="closable && emit('close', tab.id)"
    >
      <span class="pr-[4px]">{{ tab.label }}</span>
      <button
        v-if="closable"
        type="button"
        class="flex size-[12px] cursor-default items-center justify-center rounded-[1px] opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-[var(--s-hover)]"
        :class="model === tab.id && 'opacity-70'"
        :aria-label="`Close ${tab.label}`"
        @click.stop="emit('close', tab.id)"
      >
        <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><path d="M1 1l5 5M6 1 1 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <StudioButton variant="tile" square size="md" class="!h-[18px] !w-[18px]" aria-label="New tab" @click="emit('add')">
      <d-icon-plus />
    </StudioButton>
  </div>
</template>
