<script setup lang="ts">
type Props = {
  active?: boolean;
  title?: string;
};

type Emits = {
  toggle: [];
};

const { active = false, title = "Toggle animation" } = defineProps<Props>();
const emit = defineEmits<Emits>();
</script>

<template>
  <button
    type="button"
    class="flex size-[16px] shrink-0 cursor-default items-center justify-center outline-none hover:bg-[var(--s-inset-hover)]"
    :class="active ? 'text-[var(--s-accent)]' : 'text-[var(--s-dim)] hover:text-[var(--s-txt)]'"
    :title="title"
    @click.stop="emit('toggle')"
  >
    <StudioIcon name="stopwatch" />
  </button>
</template>
