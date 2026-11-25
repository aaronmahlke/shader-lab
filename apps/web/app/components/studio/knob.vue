<script setup lang="ts">
/**
 * Knob (Ableton device style): 270° arc, filled from min (or from 0 when
 * bipolar), indicator line, label above and value below. Drag up/down,
 * Shift fine, double-click resets, click the value to type.
 */
const {
  min = 0,
  max = 1,
  step = 0.01,
  precision = 2,
  unit = "",
  label,
  bipolar = false,
  defaultValue,
} = defineProps<{
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  label?: string;
  bipolar?: boolean;
  defaultValue?: number;
}>();
const model = defineModel<number>({ required: true });

const R = 9;
const C = { x: 13, y: 12 };
const START = 135; // degrees, screen coords (0 = right, clockwise)
const SWEEP = 270;
const t = computed(() => (Math.min(max, Math.max(min, model.value)) - min) / (max - min));
const t0 = computed(() => (bipolar ? (0 - min) / (max - min) : 0));

function pt(frac: number) {
  const a = ((START + SWEEP * frac) * Math.PI) / 180;
  return { x: C.x + R * Math.cos(a), y: C.y + R * Math.sin(a) };
}
function arc(a: number, b: number) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const p = pt(lo);
  const q = pt(hi);
  const large = (hi - lo) * SWEEP > 180 ? 1 : 0;
  return `M${p.x} ${p.y} A${R} ${R} 0 ${large} 1 ${q.x} ${q.y}`;
}
const tip = computed(() => {
  const a = ((START + SWEEP * t.value) * Math.PI) / 180;
  return { x: C.x + (R - 1) * Math.cos(a), y: C.y + (R - 1) * Math.sin(a) };
});

let start = { y: 0, v: 0 };
function onDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  start = { y: e.clientY, v: model.value };
}
function onMove(e: PointerEvent) {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
  const delta = ((start.y - e.clientY) / 150) * (max - min) * (e.shiftKey ? 0.1 : 1);
  const v = Math.round((start.v + delta) / step) * step;
  model.value = Math.min(max, Math.max(min, Number(v.toFixed(6))));
}
</script>

<template>
  <div class="flex w-[46px] flex-col items-center gap-[1px] select-none">
    <span v-if="label" class="truncate text-[var(--s-txt)]">{{ label }}</span>
    <svg
      width="26"
      height="22"
      viewBox="0 0 26 22"
      class="cursor-default touch-none"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuenow="model"
      @pointerdown="onDown"
      @pointermove="onMove"
      @dblclick="defaultValue != null && (model = defaultValue)"
    >
      <path :d="arc(0, 1)" fill="none" stroke="var(--s-off)" stroke-width="1.6" stroke-linecap="butt" />
      <path v-if="Math.abs(t - t0) > 0.001" :d="arc(t0, t)" fill="none" stroke="var(--s-fill)" stroke-width="1.6" style="filter:brightness(1.5)" />
      <line :x1="C.x" :y1="C.y" :x2="tip.x" :y2="tip.y" stroke="var(--s-txt)" stroke-width="1.6" stroke-linecap="round" />
    </svg>
    <span class="s-num text-[var(--s-value)]">{{ model.toFixed(precision) }}{{ unit ? ` ${unit}` : "" }}</span>
  </div>
</template>
