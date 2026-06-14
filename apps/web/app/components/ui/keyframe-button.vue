<script setup lang="ts">
type Props = {
  active?: boolean;
  disabled?: boolean;
  title?: string;
};

type Emits = {
  toggle: [];
};

const {
  active = false,
  disabled = false,
  title = "Toggle keyframe at current time",
} = defineProps<Props>();
const emit = defineEmits<Emits>();
</script>

<template>
  <button
    type="button"
    class="flex size-5 shrink-0 items-center justify-center rounded outline-none transition-colors disabled:opacity-40"
    :class="active ? 'text-accent' : 'text-neutral-subtle hover:text-neutral-strong'"
    :disabled="disabled"
    :title="title"
    @click.stop="emit('toggle')"
  >
    <span
      class="size-2 rotate-45 border border-current"
      :class="active ? 'bg-current' : 'bg-transparent'"
    />
  </button>
</template>
