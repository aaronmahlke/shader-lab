<script setup lang="ts">
/**
 * Horizontal slider (Live style): a dark inset track at control height with a
 * fill from the left and a thin bright edge at the value. Click or drag sets
 * the value at the pointer; Shift = fine. No text (use a value box for that).
 */
const { min = 0, max = 1, step = 0.001 } = defineProps<{ min?: number; max?: number; step?: number }>();
const model = defineModel<number>({ required: true });
const t = computed(() => (Math.min(max, Math.max(min, model.value)) - min) / (max - min));

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const r = el.getBoundingClientRect();
  let last = e.clientX;
  let pos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const set = () => {
    const v = Math.round((min + pos * (max - min)) / step) * step;
    model.value = Math.min(max, Math.max(min, Number(v.toFixed(6))));
  };
  set();
  const move = (ev: PointerEvent) => {
    pos = Math.min(1, Math.max(0, pos + ((ev.clientX - last) / r.width) * (ev.shiftKey ? 0.1 : 1)));
    last = ev.clientX;
    set();
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}
function onKey(e: KeyboardEvent) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const d = (e.key === "ArrowRight" ? 1 : -1) * (max - min) * (e.shiftKey ? 0.01 : 0.05);
  model.value = Math.min(max, Math.max(min, model.value + d));
}
</script>

<template>
  <div
    class="relative h-[var(--s-ctl)] cursor-default touch-none bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none hover:bg-[var(--s-inset-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--s-ring)]"
    role="slider"
    tabindex="0"
    :aria-valuenow="model"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="onDown"
    @keydown="onKey"
  >
    <div class="pointer-events-none absolute inset-y-px left-px bg-[var(--s-fill)]" :style="{ width: `calc((100% - 2px) * ${t})` }" />
    <div class="pointer-events-none absolute inset-y-px w-[2px] bg-[var(--s-bright)]" :style="{ left: `calc(1px + (100% - 4px) * ${t})` }" />
  </div>
</template>
