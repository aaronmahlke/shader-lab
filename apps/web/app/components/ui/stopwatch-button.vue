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
    class="flex size-5 shrink-0 items-center justify-center rounded outline-none"
    :class="active ? '' : 'text-neutral-subtle hover:text-neutral-strong'"
    :title="title"
    @click.stop="emit('toggle')"
  >
    <UiStopwatchDot :active="active" />
  </button>
</template>
