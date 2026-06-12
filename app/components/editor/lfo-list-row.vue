<script setup lang="ts">
import { SignalIcon } from "@heroicons/vue/16/solid";
import type { LFOSource } from "#shared/types/editor";

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
      <UiHover :active="selected" full-width>
        <div
          class="flex h-9 cursor-default items-center gap-2 p-2 outline-none select-none"
          :class="selected ? 'text-neutral-strong' : 'text-neutral-subtle group-hover/h:text-neutral-strong'"
          @pointerdown="onPointerDown"
        >
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-full"
            :class="selected ? 'bg-tint' : 'bg-tint-subtle'"
          >
            <SignalIcon class="size-4" :style="{ color: lfo.color }" />
          </span>
          <UiEditableText
            ref="editableRef"
            v-model="label"
            fill
            class="min-w-0 flex-1 text-copy-sm"
            :class="selected ? 'text-neutral-strong' : 'text-neutral'"
          />
        </div>
      </UiHover>

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
