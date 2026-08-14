<script setup lang="ts">
import type { CompositionSettings, LayerInstance, LFOSource, ModulationAssignment, PropertyTrack } from "@shader-lab/core";

type Props = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  updatedAt: string;
  data: {
    layers: LayerInstance[];
    lfos: LFOSource[];
    assignments: ModulationAssignment[];
    tracks?: PropertyTrack[];
    settings?: CompositionSettings;
  };
};

type Emits = {
  delete: [];
  duplicate: [];
};

const { id, name, thumbnailUrl, updatedAt, data } = defineProps<Props>();
const emit = defineEmits<Emits>();

const cardRef = ref<HTMLElement | null>(null);
const displayCanvasRef = ref<HTMLCanvasElement | null>(null);
const isHovered = ref(false);
const tiltX = ref(0);
const tiltY = ref(0);
const shimmerX = ref("50%");
const shimmerY = ref("50%");

const innerGlow = "inset 0 1px 0 0 rgba(255,255,255,0.1), inset 0 -1px 0 0 rgba(0,0,0,0.3), inset 0 20px 30px -15px rgba(255,255,255,0.07), inset 0 -20px 30px -15px rgba(0,0,0,0.5)";

// --- Offscreen rendering at the composition's native aspect ---

// Match the editor: buffer follows the comp size (capped for VRAM) and the
// comp dimensions feed u_scale / text raster scale so effects like
// distortion displace identically to the editor render.
const compWidth = data.settings?.width ?? 1920;
const compHeight = data.settings?.height ?? 1080;
const bufferScale = Math.min(1, 1920 / Math.max(compWidth, compHeight));
const RENDER_WIDTH = Math.max(2, Math.round(compWidth * bufferScale));
const RENDER_HEIGHT = Math.max(2, Math.round(compHeight * bufferScale));

// Hidden offscreen canvas for WebGL rendering at full resolution
const offscreenCanvas = ref<HTMLCanvasElement | null>(null);

// Create offscreen canvas when component mounts (but only used on hover)
onMounted(() => {
  const canvas = document.createElement("canvas");
  canvas.width = RENDER_WIDTH;
  canvas.height = RENDER_HEIGHT;
  canvas.style.display = "none";
  offscreenCanvas.value = canvas;
});

// The WebGL renderer targets the offscreen canvas
const layers = ref<LayerInstance[]>(data.layers ?? []);
const lfos = ref<LFOSource[]>(data.lfos ?? []);
const assignments = ref<ModulationAssignment[]>(data.assignments ?? []);
const tracks = ref<PropertyTrack[]>(data.tracks ?? []);

// Render-time clock drives both LFO sampling and keyframe evaluation, so the
// hover preview animates exactly like the editor (previously tracks were
// ignored and keyframed properties stuck at their base values).
const previewTime = ref(0);
const { getModulatedValue, sampleLfosAtTime } = useModulationEngine(lfos, assignments, {
  clockTime: previewTime,
  tracks,
});
const modFn = computed(() => getModulatedValue);
const { passes } = useLayerCompiler(layers, modFn, lfos, assignments);

// Only activate the renderer when hovered
const activeCanvasRef = computed(() => isHovered.value ? offscreenCanvas.value : null);
useMultiPassRenderer(activeCanvasRef, passes, {
  layers,
  tracks,
  getModulatedValue: modFn,
  sampleLfosAtTime: (t: number) => {
    previewTime.value = t;
    sampleLfosAtTime(t);
  },
  fixedBufferSize: ref({ width: RENDER_WIDTH, height: RENDER_HEIGHT }),
  scaleReferenceWidth: ref(compWidth),
  contentReferenceHeight: ref(compHeight),
});

// Blit offscreen canvas to the visible display canvas
let blitId: number | null = null;

function startBlit() {
  function blit() {
    const display = displayCanvasRef.value;
    const offscreen = offscreenCanvas.value;
    if (!display || !offscreen || !isHovered.value) {
      blitId = null;
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    // Layout size, not getBoundingClientRect: the card is scaled/tilted on
    // hover and the transformed bbox would skew the buffer aspect ratio.
    const w = Math.round(display.clientWidth * dpr);
    const h = Math.round(display.clientHeight * dpr);
    if (w === 0 || h === 0) {
      blitId = requestAnimationFrame(blit);
      return;
    }

    if (display.width !== w || display.height !== h) {
      display.width = w;
      display.height = h;
    }

    const ctx = display.getContext("2d");
    if (ctx) {
      // Cover-fit (like the thumbnail's object-cover) instead of stretching.
      const scale = Math.max(w / offscreen.width, h / offscreen.height);
      const dw = offscreen.width * scale;
      const dh = offscreen.height * scale;
      ctx.drawImage(offscreen, (w - dw) / 2, (h - dh) / 2, dw, dh);
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

// --- Hover interaction ---

function onPointerEnter() {
  isHovered.value = true;
  nextTick(startBlit);
}

function onPointerMove(e: PointerEvent) {
  if (!cardRef.value) return;
  const rect = cardRef.value.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  tiltY.value = (x - 0.5) * 20;
  tiltX.value = (y - 0.5) * -20;

  shimmerX.value = `${x * 100}%`;
  shimmerY.value = `${y * 100}%`;
}

function onPointerLeave() {
  isHovered.value = false;
  stopBlit();
  tiltX.value = 0;
  tiltY.value = 0;
}

onUnmounted(stopBlit);

// Relative time display
const relativeTime = computed(() => {
  const now = Date.now();
  const then = new Date(updatedAt).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(updatedAt).toLocaleDateString();
});

const wrapperTransform = computed(() => {
  if (!isHovered.value) return "scale(1)";
  return "scale(1.05)";
});

const cardTransform = computed(() => {
  if (!isHovered.value) return "perspective(600px) rotateX(0deg) rotateY(0deg)";
  return `perspective(600px) rotateX(${tiltX.value}deg) rotateY(${tiltY.value}deg)`;
});

// Specular strips — position driven by tilt, sweeps fast
const specularPos = computed(() => {
  const normalized = 0.5 - (tiltY.value / 10);
  return normalized * 100;
});

// Wide soft strip
const specularWide = computed(() => {
  const pos = specularPos.value;
  return `linear-gradient(60deg, transparent ${pos - 45}%, rgba(255,255,255,0.05) ${pos - 20}%, rgba(255,255,255,0.1) ${pos}%, rgba(255,255,255,0.05) ${pos + 20}%, transparent ${pos + 45}%)`;
});

// Narrower bright strip (offset slightly from the wide one)
const specularNarrow = computed(() => {
  const pos = specularPos.value + 5;
  return `linear-gradient(60deg, transparent ${pos - 25}%, rgba(255,255,255,0.06) ${pos - 10}%, rgba(255,255,255,0.2) ${pos}%, rgba(255,255,255,0.06) ${pos + 10}%, transparent ${pos + 25}%)`;
});
</script>

<template>
  <UiContextMenu>
    <NuxtLink :to="`/shader/${id}`" class="block">
      <div class="flex flex-col gap-2.5">
        <!-- Outer hover wrapper (stable hover zone + scale) -->
        <div
          ref="cardRef"
          class="cursor-pointer transition-transform duration-300 ease-out-expo"
          :style="{ transform: wrapperTransform }"
          @pointerenter="onPointerEnter"
          @pointermove="onPointerMove"
          @pointerleave="onPointerLeave"
        >
          <!-- Inner card (3D tilt + glow effects) -->
          <div
            class="relative aspect-video w-full overflow-hidden rounded-2xl border bg-base-0 transition-all duration-300 ease-out-expo"
            :class="isHovered ? 'border-white/[0.08]' : 'border-edge'"
            :style="{ transform: cardTransform }"
          >
            <!-- Content wrapper: no hover zoom so the live render stays
                 framed exactly like the static thumbnail (card lift + tilt
                 still move the whole card). -->
            <div class="absolute inset-0">
              <!-- Static thumbnail -->
              <img
                v-if="thumbnailUrl"
                :src="thumbnailUrl"
                :alt="name"
                class="size-full object-cover transition-opacity duration-200"
                :class="isHovered ? 'opacity-0' : 'opacity-100'"
              />
              <div v-else class="flex size-full items-center justify-center">
                <span class="text-copy-sm text-tertiary">No preview</span>
              </div>

              <!-- Display canvas (shows downscaled offscreen render) -->
              <canvas
                v-if="isHovered"
                ref="displayCanvasRef"
                class="absolute inset-0 size-full"
              />
            </div>

            <!-- Specular light strips (sweep across card based on tilt) -->
            <div
              v-if="isHovered"
              class="pointer-events-none absolute inset-0 mix-blend-soft-light"
              :style="{ background: specularWide }"
            />
            <div
              v-if="isHovered"
              class="pointer-events-none absolute inset-0 mix-blend-soft-light"
              :style="{ background: specularNarrow }"
            />

            <!-- Inner glow overlay (on top of everything) -->
            <div
              v-if="isHovered"
              class="pointer-events-none absolute inset-0 rounded-2xl"
              :style="{ boxShadow: innerGlow }"
            />
          </div>
        </div>

        <!-- Title + timestamp (static, below the card) -->
        <div class="flex min-w-0 flex-col gap-0.5 px-3">
          <span class="truncate text-copy-sm text-primary">{{ name }}</span>
          <span class="text-copy-sm text-tertiary">{{ relativeTime }}</span>
        </div>
      </div>
    </NuxtLink>

    <template #menu>
      <UiContextMenuItem @click="emit('duplicate')">Duplicate</UiContextMenuItem>
      <UiContextMenuSeparator />
      <UiContextMenuItem @click="emit('delete')">Delete</UiContextMenuItem>
    </template>
  </UiContextMenu>
</template>
