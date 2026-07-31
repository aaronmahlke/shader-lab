<script setup lang="ts">
import {
  EASING_PRESETS,
  findPropertyTrack,
  matchEasingPreset,
  setKeyframesEasing,
  type CubicBezierEase,
  type KeyframeEasing,
  type PropertyTrack,
} from "@shader-lab/core";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";

type Props = {
  selection: KeyframeSelection[];
};

const props = defineProps<Props>();
const tracks = defineModel<PropertyTrack[]>("tracks", { required: true });

const history = useEditorHistory();

const NAMED_EASINGS: { id: KeyframeEasing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "easeIn", label: "In" },
  { id: "easeOut", label: "Out" },
  { id: "easeInOut", label: "In Out" },
  { id: "hold", label: "Hold" },
];

/** Display curves for named eases (linear shows collinear handles). */
const NAMED_CURVES: Record<KeyframeEasing, CubicBezierEase> = {
  linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  hold: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
};

/** The first selected key drives the editor display. */
const activeKey = computed(() => {
  const sel = props.selection[0];
  if (!sel) return undefined;
  const track = findPropertyTrack(tracks.value, sel.layerId, sel.paramName);
  return track?.keys.find((k) => Math.abs(k.time - sel.time) < 1e-6);
});

const activeEasingId = computed(() => {
  const key = activeKey.value;
  if (!key) return "linear";
  if (key.curve) return matchEasingPreset(key.curve) ?? "custom";
  return key.ease ?? "linear";
});

const displayCurve = computed<CubicBezierEase>(() => {
  const key = activeKey.value;
  if (key?.curve) return key.curve;
  return NAMED_CURVES[key?.ease ?? "linear"];
});

function applyEasing(easing: KeyframeEasing | CubicBezierEase) {
  if (props.selection.length === 0) return;
  tracks.value = setKeyframesEasing(tracks.value, props.selection, easing);
}

function pickEasing(easing: KeyframeEasing | CubicBezierEase) {
  applyEasing(easing);
  history?.record();
}

// --- Curve editor ---

const EDITOR_W = 200;
const EDITOR_H = 160;
/** Vertical padding so back/anticipate overshoot stays visible. */
const PAD_Y = 28;
const PAD_X = 10;

function toPx(x: number, y: number): { x: number; y: number } {
  return {
    x: PAD_X + x * (EDITOR_W - PAD_X * 2),
    y: EDITOR_H - PAD_Y - y * (EDITOR_H - PAD_Y * 2),
  };
}

function fromPx(px: number, py: number): { x: number; y: number } {
  return {
    x: (px - PAD_X) / (EDITOR_W - PAD_X * 2),
    y: (EDITOR_H - PAD_Y - py) / (EDITOR_H - PAD_Y * 2),
  };
}

const p0 = computed(() => toPx(0, 0));
const p3 = computed(() => toPx(1, 1));
const h1 = computed(() => toPx(displayCurve.value[0], displayCurve.value[1]));
const h2 = computed(() => toPx(displayCurve.value[2], displayCurve.value[3]));

const curvePath = computed(
  () =>
    `M ${p0.value.x} ${p0.value.y} C ${h1.value.x} ${h1.value.y}, ${h2.value.x} ${h2.value.y}, ${p3.value.x} ${p3.value.y}`,
);

const svgRef = ref<SVGSVGElement | null>(null);
const draggingHandle = ref<0 | 1 | null>(null);

function onHandlePointerDown(handle: 0 | 1, e: PointerEvent) {
  if (e.button !== 0 || props.selection.length === 0) return;
  e.preventDefault();
  draggingHandle.value = handle;
  history?.beginGesture();
  window.addEventListener("pointermove", onHandleMove);
  window.addEventListener("pointerup", onHandleUp);
}

function onHandleMove(e: PointerEvent) {
  const handle = draggingHandle.value;
  const svg = svgRef.value;
  if (handle === null || !svg) return;
  const rect = svg.getBoundingClientRect();
  const scaleX = EDITOR_W / rect.width;
  const scaleY = EDITOR_H / rect.height;
  const uv = fromPx((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);

  const x = Math.min(1, Math.max(0, Number(uv.x.toFixed(3))));
  const y = Math.min(2, Math.max(-1, Number(uv.y.toFixed(3))));

  const next: CubicBezierEase = [...displayCurve.value] as CubicBezierEase;
  next[handle * 2] = x;
  next[handle * 2 + 1] = y;
  applyEasing(next);
}

function onHandleUp() {
  if (draggingHandle.value === null) return;
  window.removeEventListener("pointermove", onHandleMove);
  window.removeEventListener("pointerup", onHandleUp);
  draggingHandle.value = null;
  history?.commitGesture();
}

onUnmounted(() => {
  window.removeEventListener("pointermove", onHandleMove);
  window.removeEventListener("pointerup", onHandleUp);
});

/** Mini thumbnail path for a preset button (square viewbox). */
function presetPath(curve: CubicBezierEase): string {
  const s = 22;
  const pad = 4;
  const px = (x: number) => pad + x * (s - pad * 2);
  const py = (y: number) => s - pad - y * (s - pad * 2);
  return `M ${px(0)} ${py(0)} C ${px(curve[0])} ${py(curve[1])}, ${px(curve[2])} ${py(curve[3])}, ${px(1)} ${py(1)}`;
}
</script>

<template>
  <div class="flex flex-col gap-2.5 border-b border-neutral p-3">
    <div class="flex items-baseline justify-between">
      <span class="text-copy-2xs font-medium tracking-wide text-neutral-subtle uppercase">
        Easing
      </span>
      <span class="font-mono text-copy-2xs text-neutral-weak">
        {{ selection.length }} key{{ selection.length === 1 ? "" : "s" }}
      </span>
    </div>

    <!-- Curve editor -->
    <svg
      ref="svgRef"
      :viewBox="`0 0 ${EDITOR_W} ${EDITOR_H}`"
      class="w-full touch-none rounded-lg bg-control/50 select-none"
    >
      <!-- Value bounds guides -->
      <line :x1="PAD_X" :y1="toPx(0, 0).y" :x2="EDITOR_W - PAD_X" :y2="toPx(0, 0).y" class="stroke-white/10" stroke-width="1" />
      <line :x1="PAD_X" :y1="toPx(0, 1).y" :x2="EDITOR_W - PAD_X" :y2="toPx(0, 1).y" class="stroke-white/10" stroke-width="1" />

      <!-- Handle stems -->
      <line :x1="p0.x" :y1="p0.y" :x2="h1.x" :y2="h1.y" class="stroke-accent/40" stroke-width="1.5" />
      <line :x1="p3.x" :y1="p3.y" :x2="h2.x" :y2="h2.y" class="stroke-accent/40" stroke-width="1.5" />

      <!-- The curve -->
      <path :d="curvePath" fill="none" class="stroke-accent" stroke-width="2" stroke-linecap="round" />

      <!-- Endpoints -->
      <circle :cx="p0.x" :cy="p0.y" r="3" class="fill-white/60" />
      <circle :cx="p3.x" :cy="p3.y" r="3" class="fill-white/60" />

      <!-- Draggable handles -->
      <circle
        :cx="h1.x"
        :cy="h1.y"
        r="5"
        class="cursor-grab fill-white stroke-accent"
        stroke-width="1.5"
        @pointerdown="onHandlePointerDown(0, $event)"
      />
      <circle
        :cx="h2.x"
        :cy="h2.y"
        r="5"
        class="cursor-grab fill-white stroke-accent"
        stroke-width="1.5"
        @pointerdown="onHandlePointerDown(1, $event)"
      />
    </svg>

    <!-- Named eases -->
    <div class="flex gap-1">
      <button
        v-for="named in NAMED_EASINGS"
        :key="named.id"
        type="button"
        class="flex-1 rounded-md px-1 py-1 text-copy-2xs transition-colors"
        :class="activeEasingId === named.id
          ? 'bg-accent/25 text-neutral-strong ring-1 ring-accent/50'
          : 'bg-control/60 text-neutral-subtle hover:bg-control hover:text-neutral-strong'"
        @click="pickEasing(named.id)"
      >
        {{ named.label }}
      </button>
    </div>

    <!-- Preset grid -->
    <div class="grid grid-cols-6 gap-1">
      <UiTooltip
        v-for="preset in EASING_PRESETS"
        :key="preset.id"
        :label="preset.label"
        side="top"
      >
        <button
          type="button"
          class="flex aspect-square w-full items-center justify-center rounded-md transition-colors"
          :class="activeEasingId === preset.id
            ? 'bg-accent/25 ring-1 ring-accent/50'
            : 'bg-control/60 hover:bg-control'"
          @click="pickEasing(preset.curve)"
        >
          <svg viewBox="0 0 22 22" class="size-5 overflow-visible">
            <path
              :d="presetPath(preset.curve)"
              fill="none"
              stroke-width="1.5"
              stroke-linecap="round"
              :class="activeEasingId === preset.id ? 'stroke-accent' : 'stroke-white/50'"
            />
          </svg>
        </button>
      </UiTooltip>
    </div>
  </div>
</template>
