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
  align = "center",
  mods,
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
  align?: "center" | "left";
  /**
   * LFO modulation on this value: each moves it from the base toward
   * base + depth; `live` is the LFO's current output (-1..1 or 0..1).
   * Drawn as a 2px strip per LFO + a marker at the actual value.
   */
  mods?: { id: string; color: string; depth: number; live?: number }[];
}>();
const model = defineModel<number>({ required: true });
const emit = defineEmits<{
  "gesture-start": [];
  "gesture-end": [];
  /** ⌥-drag changes the first modulator's depth */
  "update:depth": [id: string, depth: number];
}>();

const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
const ratio = computed(() =>
  min != null && max != null && max > min ? (clamp(model.value) - min) / (max - min) : null,
);
const pct = (v: number) =>
  min != null && max != null && max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : null;
const modBands = computed(() =>
  (mods ?? []).map((m) => {
    const a = pct(model.value);
    const b = pct(model.value + m.depth);
    return a == null || b == null ? null : { id: m.id, color: m.color, left: Math.min(a, b), width: Math.abs(b - a) };
  }).filter((b): b is NonNullable<typeof b> => b !== null),
);
/** Actual value right now: base + Σ live·depth. */
const liveValue = computed(() => {
  if (!mods?.length || mods.every((m) => m.live == null)) return null;
  return clamp(model.value + mods.reduce((sum, m) => sum + (m.live ?? 0) * m.depth, 0));
});
const livePct = computed(() => (liveValue.value == null ? null : pct(liveValue.value)));

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

let start = { x: 0, y: 0, v: 0, moved: false, depth: false, d0: 0 };
function onPointerDown(e: PointerEvent) {
  if (editing.value || e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const depthDrag = e.altKey && !!mods?.length;
  start = { x: e.clientX, y: e.clientY, v: model.value, moved: false, depth: depthDrag, d0: depthDrag ? mods![0]!.depth : 0 };
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
  if (start.depth) {
    const d = Math.round((start.d0 + delta) / step) * step;
    emit("update:depth", mods![0]!.id, Number(d.toFixed(6)));
    return;
  }
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
    class="s-num relative flex min-w-0 touch-none items-center overflow-hidden rounded-[var(--s-r-ctl)] bg-[var(--s-inset)] h-[var(--s-ctl)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none select-none hover:bg-[var(--s-inset-hover)] focus:shadow-[inset_0_0_0_1px_var(--s-ring)]"
    :class="[editing && 'shadow-[inset_0_0_0_1px_var(--s-ring)]', align === 'center' ? 'justify-center' : 'justify-start px-[5px]']"
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
    <!-- LFO ranges (one 2px strip each, stacked from the bottom) + live marker -->
    <div
      v-for="(band, i) in modBands"
      :key="band.id"
      class="pointer-events-none absolute h-[2px]"
      :style="{ bottom: `${1 + i * 2}px`, left: `calc(1px + (100% - 2px) * ${band.left})`, width: `calc((100% - 2px) * ${band.width})`, background: band.color }"
    />
    <div
      v-if="livePct != null"
      class="pointer-events-none absolute inset-y-px w-[2px] bg-[var(--s-bright)]"
      :style="{ left: `calc(1px + (100% - 4px) * ${livePct})` }"
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
