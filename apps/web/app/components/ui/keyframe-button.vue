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
    class="flex size-[16px] shrink-0 cursor-default items-center justify-center outline-none hover:bg-[var(--s-inset-hover)] disabled:opacity-40"
    :class="active ? 'text-[var(--s-bright)]' : 'text-[var(--s-txt)]'"
    :disabled="disabled"
    :title="title"
    @click.stop="emit('toggle')"
  >
    <StudioIcon :name="active ? 'key-filled' : 'key'" />
  </button>
</template>
