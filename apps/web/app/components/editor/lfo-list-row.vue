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

const editableRef = ref<{ startEditing: () => void; editing: boolean } | null>(null);
const rowRef = ref<HTMLElement | null>(null);

defineExpose({ rowEl: rowRef });

const label = computed({
  get: () => lfo.label,
  set: (v: string) => { lfo.label = v; },
});

const isEditing = computed(() => editableRef.value?.editing ?? false);

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (isEditing.value) return;
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
</script>

<template>
  <div ref="rowRef">
    <UiContextMenu>
      <div
        class="flex h-[var(--s-row)] cursor-default items-center gap-[6px] px-[6px] outline-none select-none"
        :class="selected ? 'bg-[var(--s-select)] text-[var(--s-select-txt)]' : 'text-[var(--s-txt)] hover:bg-[var(--s-inset-hover)]'"
        @pointerdown="onPointerDown"
      >
        <UiLfoSineIcon class="h-1.5 w-4 shrink-0" :style="{ color: lfo.color }" />
        <UiEditableText
          ref="editableRef"
          v-model="label"
          fill
          class="min-w-0 flex-1 !text-[length:var(--s-fs)]"
        />
      </div>

      <template #menu>
        <UiContextMenuItem @click="editableRef?.startEditing()">Rename</UiContextMenuItem>
        <UiContextMenuItem @click="emit('duplicate')">Duplicate</UiContextMenuItem>
        <UiContextMenuItem @click="emit('clear-assignments')">Remove all assignments</UiContextMenuItem>
        <UiContextMenuSeparator />
        <UiContextMenuItem @click="emit('delete')">Delete</UiContextMenuItem>
      </template>
    </UiContextMenu>
  </div>
</template>
