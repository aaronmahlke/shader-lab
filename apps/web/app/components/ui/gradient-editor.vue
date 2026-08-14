<script setup lang="ts">
import type { GradientStop } from "@shader-lab/core";
import { isDeleteKey, useFocusedKeyboardScope } from "~/composables/use-editor-keyboard";

const model = defineModel<GradientStop[]>({ required: true });

const history = useEditorHistory();
const rootRef = ref<HTMLElement | null>(null);
const selectedIndex = ref<number>(0);
const draggingIndex = ref<number | null>(null);
const trackRef = ref<HTMLDivElement | null>(null);

const gradientCSS = computed(() => {
  const sorted = [...model.value].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return "transparent";
  if (sorted.length === 1) return sorted[0].color;
  const stops = sorted.map((s) => `${s.color} ${s.position * 100}%`).join(", ");
  return `linear-gradient(to right, ${stops})`;
});

const selectedColor = computed({
  get() {
    return model.value[selectedIndex.value]?.color ?? "#000000";
  },
  set(color: string) {
    const newStops = [...model.value];
    newStops[selectedIndex.value] = { ...newStops[selectedIndex.value], color };
    model.value = newStops;
  },
});

function focusRoot() {
  rootRef.value?.focus({ preventScroll: true });
}

function getPositionFromEvent(e: PointerEvent): number {
  if (!trackRef.value) return 0;
  const rect = trackRef.value.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

function onTrackDoubleClick(e: MouseEvent) {
  if (!trackRef.value) return;
  focusRoot();
  const rect = trackRef.value.getBoundingClientRect();
  const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const color = sampleGradientColor(position);
  const newStops = [...model.value, { color, position }];
  model.value = newStops;
  selectedIndex.value = newStops.length - 1;
  history?.record();
}

function sampleGradientColor(position: number): string {
  const sorted = [...model.value].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return "#ffffff";
  if (sorted.length === 1) return sorted[0].color;
  if (position <= sorted[0].position) return sorted[0].color;
  if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].color;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (position >= sorted[i].position && position <= sorted[i + 1].position) {
      const t = (position - sorted[i].position) / (sorted[i + 1].position - sorted[i].position);
      return lerpColor(sorted[i].color, sorted[i + 1].color, t);
    }
  }
  return "#ffffff";
}

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function onStopPointerDown(e: PointerEvent, index: number) {
  e.preventDefault();
  e.stopPropagation();
  focusRoot();
  selectedIndex.value = index;
  draggingIndex.value = index;
  history?.beginGesture();

  const onMove = (e: PointerEvent) => {
    if (draggingIndex.value === null) return;
    const position = getPositionFromEvent(e);
    const newStops = [...model.value];
    newStops[draggingIndex.value] = { ...newStops[draggingIndex.value], position };
    model.value = newStops;
  };

  const onUp = () => {
    draggingIndex.value = null;
    history?.commitGesture();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onColorPointerDown() {
  history?.beginGesture();
  window.addEventListener(
    "pointerup",
    () => {
      history?.commitGesture();
    },
    { once: true },
  );
}

function deleteSelected() {
  if (model.value.length <= 2) return false;
  const idx = selectedIndex.value;
  const newStops = model.value.filter((_, i) => i !== idx);
  model.value = newStops;
  selectedIndex.value = Math.min(idx, newStops.length - 1);
  history?.record();
  return true;
}

useFocusedKeyboardScope(rootRef, {
  handle(e) {
    if (!isDeleteKey(e)) return false;
    return deleteSelected();
  },
});
</script>

<template>
  <div
    ref="rootRef"
    class="flex flex-col gap-3 outline-none"
    tabindex="0"
  >
    <!-- Gradient bar with stop handles -->
    <div class="relative">
      <!-- Track -->
      <div
        ref="trackRef"
        class="h-6 cursor-crosshair rounded-lg"
        :style="{ background: gradientCSS }"
        @dblclick="onTrackDoubleClick"
      />

      <!-- Stop handles -->
      <div class="relative h-4 mt-0.5">
        <button
          v-for="(stop, index) in model"
          :key="index"
          :class="[
            'group absolute top-0 flex -translate-x-1/2 flex-col items-center',
            draggingIndex === index ? 'cursor-grabbing' : 'cursor-grab',
          ]"
          :style="{ left: `${stop.position * 100}%` }"
          @pointerdown="onStopPointerDown($event, index)"
        >
          <!-- Arrow -->
          <div
            :class="[
              'size-0 border-x-[5px] border-b-[5px] border-x-transparent transition-colors',
              selectedIndex === index
                ? 'border-b-primary'
                : 'border-b-tertiary group-hover:border-b-secondary',
            ]"
          />
          <!-- Color dot -->
          <div
            :class="[
              'size-2.5 rounded-full border transition-all',
              selectedIndex === index
                ? 'border-primary scale-125'
                : 'border-edge-strong group-hover:border-secondary',
            ]"
            :style="{ backgroundColor: stop.color }"
          />
        </button>
      </div>
    </div>

    <!-- Color picker for selected stop. The picker emits continuously while
         dragging; the gesture makes one drag = one undo step. -->
    <div class="h-px bg-edge" />
    <div @pointerdown="onColorPointerDown">
      <UiColorPicker v-model="selectedColor" />
    </div>

    <!-- Hint -->
    <p class="text-copy-sm text-tertiary text-center select-none">
      Double-click bar to add &#183; Select + Delete to remove
    </p>
  </div>
</template>
