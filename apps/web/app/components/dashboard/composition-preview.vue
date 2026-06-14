<script setup lang="ts">
import type { LayerInstance, LFOSource, ModulationAssignment } from "@shader-lab/core";

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;

const props = withDefaults(
  defineProps<{
    layers: LayerInstance[];
    lfos: LFOSource[];
    assignments: ModulationAssignment[];
    active?: boolean;
  }>(),
  { active: true },
);

const displayCanvasRef = ref<HTMLCanvasElement | null>(null);
const offscreenCanvas = ref<HTMLCanvasElement | null>(null);

onMounted(() => {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  canvas.style.display = "none";
  offscreenCanvas.value = canvas;
});

onUnmounted(() => {
  stopBlit();
  offscreenCanvas.value = null;
});

const layers = ref<LayerInstance[]>(props.layers);
const lfos = ref<LFOSource[]>(props.lfos);
const assignments = ref<ModulationAssignment[]>(props.assignments);

const isEmpty = computed(() => layers.value.length === 0);

const { getModulatedValue } = useModulationEngine(lfos, assignments);
const modFn = computed(() => getModulatedValue);
const { passes } = useLayerCompiler(layers, modFn, lfos, assignments);

const activeCanvasRef = computed(() =>
  props.active && !isEmpty.value ? offscreenCanvas.value : null,
);
useMultiPassRenderer(activeCanvasRef, passes, {
  layers,
  getModulatedValue: modFn,
});

let blitId: number | null = null;

function startBlit() {
  function blit() {
    const display = displayCanvasRef.value;
    const offscreen = offscreenCanvas.value;
    if (!display || !offscreen || !props.active || isEmpty.value) {
      blitId = null;
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = display.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));

    if (display.width !== w || display.height !== h) {
      display.width = w;
      display.height = h;
    }

    const ctx = display.getContext("2d");
    if (ctx) {
      ctx.drawImage(offscreen, 0, 0, w, h);
    }

    blitId = requestAnimationFrame(blit);
  }

  if (blitId === null) {
    blitId = requestAnimationFrame(blit);
  }
}

function stopBlit() {
  if (blitId !== null) {
    cancelAnimationFrame(blitId);
    blitId = null;
  }
}

watch(
  () => [props.active, isEmpty.value] as const,
  ([isActive, empty]) => {
    if (isActive && !empty) {
      nextTick(startBlit);
    } else {
      stopBlit();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="relative size-full bg-base-0">
    <canvas
      v-if="!isEmpty"
      ref="displayCanvasRef"
      class="size-full"
      aria-hidden="true"
    />
    <div
      v-else
      class="flex size-full items-center justify-center"
    >
      <span class="text-copy-sm text-tertiary">Empty</span>
    </div>
  </div>
</template>
