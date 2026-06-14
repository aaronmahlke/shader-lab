<script setup lang="ts">
type Props = {
  base: number;
  depth: number;
  min: number;
  max: number;
  step?: number;
  color: string;
  liveValue?: number;
};

type Emits = {
  "update:depth": [value: number];
};

const { base, depth, min, max, step = 0.01, color, liveValue } = defineProps<Props>();
const emit = defineEmits<Emits>();

const trackRef = ref<HTMLElement | null>(null);

const range = computed(() => max - min);

function toPct(value: number): number {
  return Math.max(0, Math.min(1, (value - min) / range.value));
}

const basePct = computed(() => toPct(base));

const endpointPct = computed(() => {
  const endpoint = Math.max(min, Math.min(max, base + depth));
  return toPct(endpoint);
});

const livePct = computed(() => {
  if (liveValue == null) return null;
  const livePos = base + liveValue * depth;
  return toPct(Math.max(min, Math.min(max, livePos)));
});

const barLeftPct = computed(() => Math.min(basePct.value, endpointPct.value));
const barRightPct = computed(() => Math.max(basePct.value, endpointPct.value));

const clampedAtMin = computed(() => base + Math.min(0, depth) < min);
const clampedAtMax = computed(() => base + Math.max(0, depth) > max);

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  function onMove(ev: PointerEvent) {
    if (!trackRef.value) return;
    const rect = trackRef.value.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const endpoint = min + pct * range.value;
    const snapped = Math.round(endpoint / step) * step;
    const clamped = Math.max(min, Math.min(max, snapped));
    emit("update:depth", clamped - base);
  }

  onMove(e);

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
</script>

<template>
  <div
    ref="trackRef"
    class="relative h-3 cursor-ew-resize px-px"
    @pointerdown="onPointerDown"
  >
    <!-- Ghost zone -->
    <div
      class="absolute top-1/2 h-1 -translate-y-1/2"
      :style="{
        left: `${barLeftPct * 100}%`,
        width: `${(barRightPct - barLeftPct) * 100}%`,
        backgroundColor: `${color}20`,
      }"
    />

    <!-- Range bar -->
    <div
      class="absolute top-1/2 h-1 -translate-y-1/2 rounded-sm"
      :style="{
        left: `${barLeftPct * 100}%`,
        width: `${(barRightPct - barLeftPct) * 100}%`,
        backgroundColor: `${color}40`,
      }"
    />

    <!-- Anchor at base -->
    <div
      class="absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full"
      :style="{ left: `${basePct * 100}%`, backgroundColor: `${color}60` }"
    />

    <!-- Live indicator -->
    <div
      v-if="livePct != null"
      class="absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-inverse/30"
      :style="{ left: `${livePct * 100}%` }"
    />

    <!-- Endpoint -->
    <div
      class="absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-sm"
      :style="{ left: `${endpointPct * 100}%`, backgroundColor: color }"
    />

    <!-- Clamp indicators -->
    <div
      v-if="clampedAtMin"
      class="absolute top-1/2 h-1.5 w-px -translate-y-1/2 rounded-full bg-mod-anchor"
      :style="{ left: '0%' }"
    />
    <div
      v-if="clampedAtMax"
      class="absolute top-1/2 h-1.5 w-px -translate-y-1/2 rounded-full bg-mod-anchor"
      :style="{ left: '100%' }"
    />
  </div>
</template>
