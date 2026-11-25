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
  keyframe,
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
   * base + depth (negative depth = downward); `live` is the LFO's current
   * output, 0..1 like the engine.
   * Each gets its own row above the box: range band, endpoint, live marker.
   */
  mods?: { id: string; color: string; depth: number; live?: number }[];
  /**
   * Keyframe button right of the box (omit to hide):
   * "off" = not animated (click: animate + key), "animated" = no key at the
   * playhead (click: add key), "on" = key at the playhead (click: remove).
   */
  keyframe?: "off" | "animated" | "on";
}>();
const model = defineModel<number>({ required: true });
const emit = defineEmits<{
  "gesture-start": [];
  "gesture-end": [];
  /** Dragging a modulation row sets that LFO's depth (endpoint = pointer). */
  "update:depth": [id: string, depth: number];
  "toggle-key": [];
}>();

const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
/** Ranges that cross 0 (rotation, position) fill from 0, not from min. */
const zero = computed(() =>
  min != null && max != null && min < 0 && max > 0 ? -min / (max - min) : 0,
);
const ratio = computed(() =>
  min != null && max != null && max > min ? (clamp(model.value) - min) / (max - min) : null,
);
const pct = (v: number) =>
  min != null && max != null && max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : null;
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

/**
 * Drag to change: the cursor hides and stays put (pointer lock, like Live),
 * so a drag never runs out of screen. Movement accumulates from movementX/Y.
 */
let drag: { v: number; acc: number; dist: number; moved: boolean } | null = null;
function onPointerDown(e: PointerEvent) {
  if (editing.value || e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  drag = { v: model.value, acc: 0, dist: 0, moved: false };
  const move = (ev: PointerEvent | MouseEvent) => {
    if (!drag) return;
    const dx = ev.movementX;
    const dy = -ev.movementY;
    drag.dist += Math.abs(dx) + Math.abs(dy);
    if (!drag.moved) {
      if (drag.dist < 3) return;
      drag.moved = true;
      emit("gesture-start");
      el.requestPointerLock?.();
    }
    // Range-relative speed when bounded (200px = full range), else `step` per px.
    const perPx = ratio.value != null ? (max! - min!) / 200 : step;
    drag.acc += (dx + dy) * perPx * (ev.shiftKey ? 0.1 : 1);
    const snapped = Math.round((drag.v + drag.acc) / step) * step;
    model.value = clamp(Number(snapped.toFixed(6)));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (document.pointerLockElement === el) document.exitPointerLock();
    const moved = drag?.moved;
    drag = null;
    if (moved) emit("gesture-end");
    else startEdit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
function onKey(e: KeyboardEvent) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
  model.value = clamp(Number((model.value + d).toFixed(6)));
}
function onModPointerDown(id: string, e: PointerEvent) {
  if (e.button !== 0 || min == null || max == null) return;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const apply = (ev: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const end = Math.round((min + t * (max - min)) / step) * step;
    emit("update:depth", id, Number((end - model.value).toFixed(6)));
  };
  apply(e);
  const move = (ev: PointerEvent) => apply(ev);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

const modRows = computed(() =>
  (mods ?? []).map((m) => {
    const a = pct(model.value);
    const b = pct(model.value + m.depth);
    if (a == null || b == null) return null;
    // LFO output is unipolar (0..1, like the engine): base → base + depth, never past either end.
    const live = m.live == null ? null : pct(clamp(model.value + Math.min(1, Math.max(0, m.live)) * m.depth));
    const target = model.value + m.depth;
    return {
      id: m.id, color: m.color, base: a, end: b, left: Math.min(a, b), width: Math.abs(b - a), live,
      // Range goes past the slider's min/max (e.g. after narrowing the range): red edge marker.
      overMin: target < min!, overMax: target > max!,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null),
);

function reset() {
  if (defaultValue != null) model.value = defaultValue;
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-px">
    <!-- One modulation row per LFO, above the box -->
    <div
      v-for="row in modRows"
      :key="row.id"
      class="relative h-[8px] cursor-default touch-none bg-[var(--s-inset)] shadow-[inset_0_0_0_1px_var(--s-edge)]"
      :title="`Drag to set the modulation depth`"
      @pointerdown="onModPointerDown(row.id, $event)"
    >
      <div class="pointer-events-none absolute inset-y-px opacity-45" :style="{ left: `calc(1px + (100% - 2px) * ${row.left})`, width: `calc((100% - 2px) * ${row.width})`, background: row.color }" />
      <div class="pointer-events-none absolute inset-y-px w-px bg-[var(--s-txt)]" :style="{ left: `calc(1px + (100% - 3px) * ${row.base})` }" />
      <div class="pointer-events-none absolute inset-y-px w-[2px]" :style="{ left: `calc(1px + (100% - 4px) * ${row.end})`, background: row.color }" />
      <div v-if="row.overMin" class="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[var(--s-danger)]" title="Modulation goes below the minimum" />
      <div v-if="row.overMax" class="pointer-events-none absolute inset-y-0 right-0 w-[2px] bg-[var(--s-danger)]" title="Modulation goes above the maximum" />
      <div v-if="row.live != null" class="pointer-events-none absolute inset-y-0 w-[2px] bg-[var(--s-bright)]" :style="{ left: `calc(1px + (100% - 4px) * ${row.live})` }" />
    </div>
  <div class="flex min-w-0 items-center gap-[3px]">
  <div
    class="s-num relative flex min-w-0 flex-1 min-w-0 touch-none items-center overflow-hidden rounded-[var(--s-r-ctl)] bg-[var(--s-inset)] h-[var(--s-ctl)] shadow-[inset_0_0_0_1px_var(--s-edge)] outline-none select-none hover:bg-[var(--s-inset-hover)] focus:shadow-[inset_0_0_0_1px_var(--s-ring)]"
    :class="[editing && 'shadow-[inset_0_0_0_1px_var(--s-ring)]', align === 'center' ? 'justify-center' : 'justify-start px-[5px]']"
    tabindex="0"
    role="spinbutton"
    :aria-valuenow="model"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="onPointerDown"
    @dblclick="reset"
    @keydown="onKey"
  >
    <div
      v-if="fill && ratio != null"
      class="pointer-events-none absolute inset-y-px bg-[var(--s-fill)]"
      :style="{ left: `calc(1px + (100% - 2px) * ${Math.min(ratio, zero)})`, width: `calc((100% - 2px) * ${Math.abs(ratio - zero)})` }"
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
  <button
    v-if="keyframe"
    type="button"
    class="flex size-[var(--s-ctl)] shrink-0 cursor-default items-center justify-center outline-none hover:bg-[var(--s-inset-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--s-ring)]"
    :class="keyframe === 'off' ? 'text-[var(--s-off)] hover:text-[var(--s-txt)]' : 'text-[var(--s-bright)]'"
    :aria-label="keyframe === 'on' ? 'Remove keyframe' : keyframe === 'animated' ? 'Add keyframe' : 'Animate (add keyframe)'"
    :title="keyframe === 'on' ? 'Remove keyframe' : keyframe === 'animated' ? 'Add keyframe' : 'Animate: add a keyframe'"
    @click="emit('toggle-key')"
  >
    <StudioIcon :name="keyframe === 'on' ? 'key-filled' : 'key'" />
  </button>
  </div>
  </div>
</template>
