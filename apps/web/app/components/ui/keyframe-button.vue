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
    class="flex size-5 shrink-0 items-center justify-center rounded outline-none disabled:opacity-40"
    :disabled="disabled"
    :title="title"
    @click.stop="emit('toggle')"
  >
    <UiKeyframeDiamond class="size-2" :selected="active" />
  </button>
</template>
