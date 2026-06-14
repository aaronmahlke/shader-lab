<script setup lang="ts">
type Props = {
  class?: string;
  fill?: boolean;
};

const { class: className, fill = false } = defineProps<Props>();

const model = defineModel<string>({ required: true });
const editing = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const measureRef = ref<HTMLSpanElement | null>(null);
const currentText = ref("");
const inputWidth = ref("auto");

function updateWidth() {
  nextTick(() => {
    if (measureRef.value) {
      inputWidth.value = `${measureRef.value.offsetWidth + 4}px`;
    }
  });
}

function startEditing() {
  setTimeout(() => {
    currentText.value = model.value;
    editing.value = true;
    nextTick(() => {
      updateWidth();
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  }, 50);
}

function onInput(e: Event) {
  currentText.value = (e.target as HTMLInputElement).value;
  updateWidth();
}

function commit() {
  if (!editing.value) return;
  const val = currentText.value.trim();
  if (val) model.value = val;
  editing.value = false;
}

function cancel() {
  editing.value = false;
}

defineExpose({ startEditing, editing });
</script>

<template>
  <!-- Fill mode: takes available flex space -->
  <template v-if="fill">
    <input
      v-if="editing"
      ref="inputRef"
      :value="model"
      type="text"
      :class="['min-w-0 flex-1 bg-transparent outline-none', className]"
      @input="onInput"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.escape="cancel"
      @pointerdown.stop
      @click.stop
    />
    <span
      v-else
      :class="['min-w-0 flex-1 truncate', className]"
      @dblclick.stop="startEditing"
    >
      {{ model }}
    </span>
  </template>

  <!-- Grow mode: expands with content -->
  <template v-else>
    <span class="relative inline-flex max-w-40 items-center">
      <input
        v-if="editing"
        ref="inputRef"
        :value="currentText"
        type="text"
        :class="['min-w-[2ch] bg-transparent outline-none', className]"
        :style="{ width: inputWidth }"
        @input="onInput"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.escape="cancel"
        @pointerdown.stop
        @click.stop
      />
      <span
        v-else
        :class="['truncate', className]"
        @dblclick.stop="startEditing"
      >
        {{ model }}
      </span>
      <span
        v-if="editing"
        ref="measureRef"
        :class="['pointer-events-none invisible absolute left-0 top-0 whitespace-pre', className]"
        aria-hidden="true"
      >{{ currentText }}</span>
    </span>
  </template>
</template>
