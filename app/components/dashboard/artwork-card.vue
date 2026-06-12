<script setup lang="ts">
import type { ArtworkDocument, ShaderDocument } from "#shared/types/artwork";
import type { LayerInstance, LFOSource, ModulationAssignment } from "#shared/types/editor";
import { drawArtworkLayers, type ArtworkImageCache } from "#shared/artwork/draw-artwork";
import { loadArtworkVideo, type ArtworkVideoCache } from "#shared/artwork/video-layer";

const props = defineProps<{
  id: string;
  name: string;
  thumbnailUrl: string | null;
  updatedAt: string;
  data: ArtworkDocument;
}>();

const emit = defineEmits<{
  delete: [];
  duplicate: [];
}>();

const cardRef = ref<HTMLElement | null>(null);
const displayCanvasRef = ref<HTMLCanvasElement | null>(null);
const isHovered = ref(false);
const shaderCache = ref<Record<string, ShaderDocument>>({});
const imageCache = ref<ArtworkImageCache>(new Map());
const videoCache = ref<ArtworkVideoCache>(new Map());

const relativeTime = computed(() => {
  const now = Date.now();
  const then = new Date(props.updatedAt).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(props.updatedAt).toLocaleDateString();
});

const offscreenCanvas = ref<HTMLCanvasElement | null>(null);

onMounted(() => {
  const canvas = document.createElement("canvas");
  canvas.width = props.data.canvas.width;
  canvas.height = props.data.canvas.height;
  offscreenCanvas.value = canvas;
});

const primaryShaderLayer = computed(() =>
  props.data.layers.find((l) => l.type === "shader" && l.enabled && l.shaderId !== "__pending__"),
);

const layersRef = computed(() => {
  const id = primaryShaderLayer.value?.type === "shader" ? primaryShaderLayer.value.shaderId : null;
  return id ? (shaderCache.value[id]?.layers ?? []) : [];
});
const lfosRef = computed(() => {
  const id = primaryShaderLayer.value?.type === "shader" ? primaryShaderLayer.value.shaderId : null;
  return id ? (shaderCache.value[id]?.lfos ?? []) : [];
});
const assignmentsRef = computed(() => {
  const id = primaryShaderLayer.value?.type === "shader" ? primaryShaderLayer.value.shaderId : null;
  return id ? (shaderCache.value[id]?.assignments ?? []) : [];
});

const { getModulatedValue } = useModulationEngine(lfosRef, assignmentsRef);
const modFn = computed(() => getModulatedValue);
const { passes } = useLayerCompiler(layersRef, modFn, lfosRef, assignmentsRef);

const activeCanvasRef = computed(() => (isHovered.value ? offscreenCanvas.value : null));
useMultiPassRenderer(activeCanvasRef, passes, {
  layers: layersRef,
  getModulatedValue: modFn,
});

async function loadShaders() {
  for (const layer of props.data.layers) {
    if (layer.type === "shader" && layer.shaderId !== "__pending__" && !shaderCache.value[layer.shaderId]) {
      try {
        const row = await $fetch(`/api/shaders/${layer.shaderId}`) as { data: ShaderDocument };
        shaderCache.value[layer.shaderId] = row.data;
      } catch {
        // ignore
      }
    }
    if (layer.type === "image" && layer.src && !imageCache.value.has(layer.src)) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          imageCache.value.set(layer.src, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = layer.src;
      });
    }
    if (layer.type === "video" && layer.src && !videoCache.value.has(layer.src)) {
      const video = await loadArtworkVideo(layer.src);
      if (video) {
        video.loop = layer.loop !== false;
        videoCache.value.set(layer.src, video);
        video.play().catch(() => {});
      }
    }
  }
}

let blitId: number | null = null;

function compositeDisplay() {
  const display = displayCanvasRef.value;
  const off = offscreenCanvas.value;
  if (!display || !off) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = display.getBoundingClientRect();
  const dw = Math.max(1, Math.floor(rect.width * dpr));
  const dh = Math.max(1, Math.floor(rect.height * dpr));
  if (display.width !== dw || display.height !== dh) {
    display.width = dw;
    display.height = dh;
  }

  const ctx = display.getContext("2d");
  if (!ctx) return;

  const { width, height } = props.data.canvas;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, dw, dh);
  if (primaryShaderLayer.value) {
    ctx.drawImage(off, 0, 0, dw, dh);
  }
  ctx.save();
  ctx.scale(dw / width, dh / height);
  for (const layer of props.data.layers) {
    if (layer.type !== "video" || !layer.src) continue;
    const video = videoCache.value.get(layer.src);
    if (video?.paused) video.play().catch(() => {});
  }
  drawArtworkLayers(ctx, width, height, props.data.layers, {
    imageCache: imageCache.value,
    videoCache: videoCache.value,
  });
  ctx.restore();
}

function startBlit() {
  function blit() {
    if (!isHovered.value) {
      blitId = null;
      return;
    }
    compositeDisplay();
    blitId = requestAnimationFrame(blit);
  }
  if (blitId === null) blitId = requestAnimationFrame(blit);
}

function stopBlit() {
  if (blitId !== null) {
    cancelAnimationFrame(blitId);
    blitId = null;
  }
}

async function onPointerEnter() {
  isHovered.value = true;
  await loadShaders();
  nextTick(startBlit);
}

function onPointerLeave() {
  isHovered.value = false;
  stopBlit();
}

onUnmounted(stopBlit);
</script>

<template>
  <UiContextMenu>
    <NuxtLink :to="`/artwork/${props.id}`" class="block">
      <div class="flex flex-col gap-2.5">
        <div
          ref="cardRef"
          class="relative aspect-video w-full overflow-hidden rounded-2xl border border-edge bg-base-0 transition-transform duration-300 ease-out-expo hover:scale-[1.02]"
          @pointerenter="onPointerEnter"
          @pointerleave="onPointerLeave"
        >
          <img
            v-if="props.thumbnailUrl"
            :src="props.thumbnailUrl"
            :alt="props.name"
            class="size-full object-cover transition-opacity duration-200"
            :class="isHovered ? 'opacity-0' : 'opacity-100'"
          />
          <div v-else class="flex size-full items-center justify-center">
            <span class="text-copy-sm text-tertiary">Artwork</span>
          </div>
          <canvas
            v-if="isHovered"
            ref="displayCanvasRef"
            class="absolute inset-0 size-full"
          />
        </div>
        <div class="flex min-w-0 flex-col gap-0.5 px-3">
          <span class="truncate text-copy-sm text-primary">{{ props.name }}</span>
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
