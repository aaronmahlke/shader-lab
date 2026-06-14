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
    class="flex size-5 shrink-0 items-center justify-center rounded outline-none transition-colors"
    :class="active ? 'text-accent' : 'text-neutral-subtle hover:text-neutral-strong'"
    :title="title"
    @click.stop="emit('toggle')"
  >
    <svg viewBox="0 0 16 16" class="size-3.5" fill="currentColor" aria-hidden="true">
      <path
        d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.25a.75.75 0 0 1 .75.75v2.44l1.72 1a.75.75 0 1 1-.75 1.3l-2.1-1.22A.75.75 0 0 1 7.25 8V4.5a.75.75 0 0 1 .75-.75Z"
        :opacity="active ? 1 : 0.85"
      />
    </svg>
  </button>
</template>
