<script setup lang="ts">
import type { LFOSource } from "@shader-lab/core";

type Props = {
  lfo: LFOSource;
  selected: boolean;
};

type Emits = {
  select: [];
  "drag-start": [x: number, y: number];
  duplicate: [];
  "clear-assignments": [];
  delete: [];
};

const { lfo, selected } = defineProps<Props>();
const emit = defineEmits<Emits>();

let startX = 0;
let startY = 0;
let isDragging = false;

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (editableRef.value?.editing) return;
  startX = e.clientX;
  startY = e.clientY;
  isDragging = false;

  function onMove(ev: PointerEvent) {
    if (!isDragging && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
      isDragging = true;
      emit("drag-start", ev.clientX, ev.clientY);
    }
  }

  function onUp() {
    if (!isDragging) {
      emit("select");
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

const editableRef = ref<{ startEditing: () => void; editing: boolean } | null>(null);

const label = computed({
  get: () => lfo.label,
  set: (v: string) => { lfo.label = v; },
});
</script>

<template>
  <UiContextMenu>
    <button
      class="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-copy-sm transition-all duration-150 select-none"
      :class="selected
        ? 'border-edge bg-surface-1 text-primary'
        : 'border-transparent bg-surface-1/50 text-secondary hover:bg-surface-1 hover:text-primary'"
      @pointerdown="onPointerDown"
    >
      <span class="size-2.5 rounded-full" :style="{ backgroundColor: lfo.color }" />
      <UiEditableText
        ref="editableRef"
        v-model="label"
        class="text-copy-sm"
      />
    </button>

    <template #menu>
      <UiContextMenuItem @click="editableRef?.startEditing()">Rename</UiContextMenuItem>
      <UiContextMenuItem @click="emit('duplicate')">Duplicate</UiContextMenuItem>
      <UiContextMenuItem @click="emit('clear-assignments')">Remove all assignments</UiContextMenuItem>
      <UiContextMenuSeparator />
      <UiContextMenuItem @click="emit('delete')">Delete</UiContextMenuItem>
    </template>
  </UiContextMenu>
</template>
