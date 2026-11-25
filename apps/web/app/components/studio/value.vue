<script setup lang="ts">
/**
 * Number box: drag up/down (or left/right) to change, click to type,
 * Shift = fine, double-click resets. With min + max it shows a fill bar
 * (Ableton's slider-in-a-box). Arrow keys step when focused.
 */
const {
  min,
  max,
  step = 0.01,
  precision = 2,
  unit = "",
  label,
  fill = true,
  defaultValue,
  size = "md",
  align = "center",
} = defineProps<{
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  /** Short label inside the box, left (e.g. "X") */
  label?: string;
  /** Show the fill bar when min/max are set */
  fill?: boolean;
  defaultValue?: number;
  size?: "md" | "sm";
  align?: "center" | "left";
}>();
const model = defineModel<number>({ required: true });
const emit = defineEmits<{ "gesture-start": []; "gesture-end": [] }>();

const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
const ratio = computed(() =>
  min != null && max != null && max > min ? (clamp(model.value) - min) / (max - min) : null,
);
const text = computed(() => `${model.value.toFixed(precision)}${unit ? ` ${unit}` : ""}`);

const editing = ref(false);
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

function startEdit() {
  draft.value = model.value.toFixed(precision);
  editing.value = true;
  nextTick(() => inputRef.value?.select());
}
function commit() {
  const n = Number.parseFloat(draft.value);
  if (Number.isFinite(n)) model.value = clamp(n);
  editing.value = false;
}

let start = { x: 0, y: 0, v: 0, moved: false };
function onPointerDown(e: PointerEvent) {
  if (editing.value || e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  start = { x: e.clientX, y: e.clientY, v: model.value, moved: false };
}
function onPointerMove(e: PointerEvent) {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
  const dx = e.clientX - start.x;
  const dy = start.y - e.clientY;
  if (!start.moved && Math.hypot(dx, dy) < 3) return;
  if (!start.moved) {
    start.moved = true;
    emit("gesture-start");
  }
  // Range-relative speed when bounded (200px = full range), else `step` per px.
  const perPx = ratio.value != null ? (max! - min!) / 200 : step;
  const delta = (Math.abs(dy) >= Math.abs(dx) ? dy : dx) * perPx * (e.shiftKey ? 0.1 : 1);
  const snapped = Math.round((start.v + delta) / step) * step;
  model.value = clamp(Number(snapped.toFixed(6)));
}
function onPointerUp(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement;
  if (!el.hasPointerCapture(e.pointerId)) return;
  el.releasePointerCapture(e.pointerId);
  if (start.moved) emit("gesture-end");
  else startEdit();
}
function onKey(e: KeyboardEvent) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
  model.value = clamp(Number((model.value + d).toFixed(6)));
}
function reset() {
  if (defaultValue != null) model.value = defaultValue;
}
</script>

<template>
  <div
    class="s-num relative flex min-w-0 touch-none items-center overflow-hidden rounded-[var(--s-r-ctl)] bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none select-none focus-visible:ring-1 focus-visible:ring-[var(--s-accent)]"
    :class="[size === 'md' ? 'h-[var(--s-ctl)]' : 'h-[var(--s-ctl-sm)]', align === 'center' ? 'justify-center' : 'justify-start px-[5px]']"
    tabindex="0"
    role="spinbutton"
    :aria-valuenow="model"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @dblclick="reset"
    @keydown="onKey"
  >
    <div
      v-if="fill && ratio != null"
      class="pointer-events-none absolute inset-y-px left-px bg-[var(--s-fill)]"
      :style="{ width: `calc((100% - 2px) * ${ratio})` }"
    />
    <span v-if="label" class="relative mr-auto pl-[5px] text-[var(--s-dim)]">{{ label }}</span>
    <input
      v-if="editing"
      ref="inputRef"
      v-model="draft"
      class="s-num relative h-full w-full bg-transparent px-[5px] text-[var(--s-bright)] outline-none"
      :class="align === 'center' && 'text-center'"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="editing = false"
      @keydown.stop
      @blur="commit"
      @pointerdown.stop
    />
    <span
      v-else
      class="relative"
      :class="[label && 'mr-auto', fill && ratio != null ? 'text-[var(--s-fill-txt)]' : 'text-[var(--s-txt)]']"
    >{{ text }}</span>
  </div>
</template>
