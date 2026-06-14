<script setup lang="ts">
import { hexToHsv, hsvToHex } from "~/utils/color";

const model = defineModel<string>({ default: "#ff0000" });

const [hue, sat, val] = hexToHsv(model.value);
const h = ref(hue);
const s = ref(sat);
const v = ref(val);

const svFieldRef = ref<HTMLDivElement | null>(null);
const hueStripRef = ref<HTMLDivElement | null>(null);
const hexInputRef = ref<HTMLInputElement | null>(null);

const pureHueColor = computed(() => `hsl(${h.value}, 100%, 50%)`);

const hexValue = computed(() => hsvToHex(h.value, s.value, v.value));

// Sync internal HSV → external hex
function emitColor() {
  model.value = hsvToHex(h.value, s.value, v.value);
}

// Sync external hex → internal HSV (when model changes from outside)
watch(model, (newHex) => {
  const current = hsvToHex(h.value, s.value, v.value);
  if (newHex.toLowerCase() === current.toLowerCase()) return;
  const [nh, ns, nv] = hexToHsv(newHex);
  // Preserve hue when color is achromatic (s=0 or v=0)
  if (ns > 0.001) h.value = nh;
  s.value = ns;
  v.value = nv;
});

// --- SV Field interaction ---
function updateSV(e: PointerEvent) {
  const el = svFieldRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  s.value = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  v.value = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
  emitColor();
}

function onSVPointerDown(e: PointerEvent) {
  e.preventDefault();
  const el = svFieldRef.value;
  if (!el) return;
  el.setPointerCapture(e.pointerId);
  updateSV(e);
}

function onSVPointerMove(e: PointerEvent) {
  const el = svFieldRef.value;
  if (!el || !el.hasPointerCapture(e.pointerId)) return;
  updateSV(e);
}

// --- Hue strip interaction ---
function updateHue(e: PointerEvent) {
  const el = hueStripRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  h.value = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
  emitColor();
}

function onHuePointerDown(e: PointerEvent) {
  e.preventDefault();
  const el = hueStripRef.value;
  if (!el) return;
  el.setPointerCapture(e.pointerId);
  updateHue(e);
}

function onHuePointerMove(e: PointerEvent) {
  const el = hueStripRef.value;
  if (!el || !el.hasPointerCapture(e.pointerId)) return;
  updateHue(e);
}

// --- Hex input ---
function commitHex(e: Event) {
  const input = e.target as HTMLInputElement;
  let val = input.value.trim();
  if (!val.startsWith("#")) val = "#" + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    model.value = val;
  }
  // Reset input to current valid value
  input.value = hexValue.value;
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <!-- SV Field -->
    <div
      ref="svFieldRef"
      class="relative h-36 cursor-crosshair overflow-hidden rounded-lg"
      :style="{ backgroundColor: pureHueColor }"
      @pointerdown="onSVPointerDown"
      @pointermove="onSVPointerMove"
    >
      <!-- Saturation gradient: white → transparent (left to right) -->
      <div class="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
      <!-- Value gradient: transparent → black (top to bottom) -->
      <div class="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
      <!-- Crosshair -->
      <div
        class="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(0,0,0,0.3)]"
        :style="{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }"
      />
    </div>

    <!-- Hue Strip -->
    <div
      ref="hueStripRef"
      class="relative h-3 cursor-ew-resize rounded-full"
      style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
      @pointerdown="onHuePointerDown"
      @pointermove="onHuePointerMove"
    >
      <!-- Hue indicator -->
      <div
        class="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
        :style="{ left: `${(h / 360) * 100}%` }"
      />
    </div>

    <!-- Hex input -->
    <div class="flex items-center gap-2">
      <div
        class="size-6 shrink-0 rounded-md border border-edge"
        :style="{ backgroundColor: hexValue }"
      />
      <input
        ref="hexInputRef"
        :value="hexValue"
        type="text"
        class="h-6 w-full rounded-md bg-surface-1 px-2 font-mono text-copy-sm text-primary uppercase outline-none ring-1 ring-edge focus:ring-edge-strong"
        @change="commitHex"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
    </div>
  </div>
</template>
