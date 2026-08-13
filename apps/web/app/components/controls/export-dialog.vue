<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from "reka-ui";
import { ArrowDownTrayIcon, XMarkIcon } from "@heroicons/vue/16/solid";
import {
  EXPORT_SCALE_MULTIPLIERS,
  scaledExportSize,
  type DesignCanvas,
} from "#shared/editor/export-scale";

type ShaderControls = {
  capture: (width: number, height: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  configureRenderer: (width: number, height: number) => void;
  restoreRenderer: () => void;
  renderFrame: (time: number) => void | Promise<void>;
};

/** Fixed presets when no design canvas is provided (shader-only editor). */
const LEGACY_RESOLUTIONS = [
  { label: "1080p", width: 1920, height: 1080 },
  { label: "4K", width: 3840, height: 2160 },
] as const;

type Props = {
  experimentId: string;
  shader: ShaderControls | null;
  /** Design canvas — enables 1× / 2× / 4× export scaling */
  designCanvas?: DesignCanvas;
  canvasVideoDuration?: number;
  compositionDuration?: number;
  beforeExport?: () => void | Promise<void>;
};

const { experimentId, shader, designCanvas, canvasVideoDuration = 0, compositionDuration = 0, beforeExport } = defineProps<Props>();

const open = defineModel<boolean>("open", { default: false });

const tab = ref<"image" | "video">("image");

const useScaleExport = computed(() => !!designCanvas);

const selectedScale = ref(0);
const selectedLegacyResolution = ref(0);

const exportSize = computed(() => {
  if (designCanvas) {
    const mult = EXPORT_SCALE_MULTIPLIERS[selectedScale.value]!.multiplier;
    return scaledExportSize(designCanvas, mult);
  }
  const leg = LEGACY_RESOLUTIONS[selectedLegacyResolution.value]!;
  return { width: leg.width, height: leg.height };
});

const fixedDurations = [
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
] as const;

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

const durationOptions = computed(() => {
  const opts: { label: string; value: number }[] = [];
  if (compositionDuration > 0.05) {
    opts.push({
      label: `Composition (${formatDuration(compositionDuration)})`,
      value: compositionDuration,
    });
  }
  if (canvasVideoDuration > 0.05) {
    opts.push({
      label: `Canvas video (${formatDuration(canvasVideoDuration)})`,
      value: canvasVideoDuration,
    });
  }
  for (const d of fixedDurations) opts.push({ label: d.label, value: d.value });
  return opts;
});

const fpsOptions = [
  { label: "30", value: 30 },
  { label: "60", value: 60 },
] as const;

const selectedDuration = ref(0);
const selectedFps = ref(0);

watch(
  () => compositionDuration,
  (d) => {
    if (d > 0.05) selectedDuration.value = 0;
  },
  { immediate: true },
);

watch(
  () => canvasVideoDuration,
  (d) => {
    if (d > 0.05) selectedDuration.value = 0;
  },
  { immediate: true },
);

const { state: videoState, exportVideo, abort } = useVideoExport();

async function handleImageExport() {
  if (!shader) return;
  await beforeExport?.();
  const { width, height } = exportSize.value;
  open.value = false;
  await shader.capture(width, height);
}

async function handleVideoExport() {
  if (!shader) return;
  await beforeExport?.();
  const { width, height } = exportSize.value;
  const dur = durationOptions.value[selectedDuration.value]!;
  const fps = fpsOptions[selectedFps.value]!;

  await exportVideo(shader, {
    width,
    height,
    fps: fps.value,
    duration: dur.value,
    experimentId,
  });

  if (!videoState.exporting && !videoState.error) {
    open.value = false;
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-contentShow" />
      <DialogContent
        class="fixed left-1/2 top-[20%] z-50 w-80 -translate-x-1/2 rounded-2xl border border-edge bg-base-1 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
      >
        <div class="flex items-center justify-between border-b border-edge px-4 py-3">
          <DialogTitle class="text-copy-sm text-primary">
            Export
          </DialogTitle>
          <UiButton variant="ghost" size="sm" :icon-left="XMarkIcon" @click="open = false" />
        </div>

        <div class="p-4">
          <div class="flex gap-1 rounded-lg bg-surface-1 p-1">
            <button
              v-for="t in (['image', 'video'] as const)"
              :key="t"
              class="flex-1 rounded-md px-3 py-1.5 text-copy-sm capitalize transition-colors"
              :class="tab === t ? 'bg-base-1 text-primary shadow-sm' : 'text-tertiary hover:text-secondary'"
              @click="tab = t"
            >
              {{ t }}
            </button>
          </div>

          <div v-if="tab === 'image'" class="mt-4 flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <span class="text-copy-sm text-tertiary">
                {{ useScaleExport ? "Scale" : "Resolution" }}
              </span>
              <div v-if="useScaleExport" class="flex gap-1.5">
                <UiButton
                  v-for="(preset, i) in EXPORT_SCALE_MULTIPLIERS"
                  :key="preset.label"
                  variant="option"
                  :active="selectedScale === i"
                  class="flex-1"
                  @click="selectedScale = i"
                >
                  {{ preset.label }}
                </UiButton>
              </div>
              <div v-else class="flex gap-1.5">
                <UiButton
                  v-for="(res, i) in LEGACY_RESOLUTIONS"
                  :key="res.label"
                  variant="option"
                  :active="selectedLegacyResolution === i"
                  class="flex-1"
                  @click="selectedLegacyResolution = i"
                >
                  {{ res.label }}
                </UiButton>
              </div>
              <span class="text-copy-sm text-tertiary">
                <template v-if="useScaleExport && designCanvas">
                  {{ designCanvas.width }}×{{ designCanvas.height }} design →
                  {{ exportSize.width }}×{{ exportSize.height }} export
                </template>
                <template v-else>
                  {{ exportSize.width }} × {{ exportSize.height }}
                </template>
              </span>
            </div>

            <UiButton variant="action" :icon-left="ArrowDownTrayIcon" @click="handleImageExport">
              Download PNG
            </UiButton>
          </div>

          <div v-if="tab === 'video'" class="mt-4 flex flex-col gap-4">
            <div v-if="!videoState.exporting" class="flex flex-col gap-4">
              <div class="flex flex-col gap-2">
                <span class="text-copy-sm text-tertiary">
                  {{ useScaleExport ? "Scale" : "Resolution" }}
                </span>
                <div v-if="useScaleExport" class="flex gap-1.5">
                  <UiButton
                    v-for="(preset, i) in EXPORT_SCALE_MULTIPLIERS"
                    :key="preset.label"
                    variant="option"
                    :active="selectedScale === i"
                    class="flex-1"
                    @click="selectedScale = i"
                  >
                    {{ preset.label }}
                  </UiButton>
                </div>
                <div v-else class="flex gap-1.5">
                  <UiButton
                    v-for="(res, i) in LEGACY_RESOLUTIONS"
                    :key="res.label"
                    variant="option"
                    :active="selectedLegacyResolution === i"
                    class="flex-1"
                    @click="selectedLegacyResolution = i"
                  >
                    {{ res.label }}
                  </UiButton>
                </div>
                <span
                  v-if="useScaleExport && designCanvas"
                  class="text-copy-sm text-tertiary"
                >
                  {{ designCanvas.width }}×{{ designCanvas.height }} →
                  {{ exportSize.width }}×{{ exportSize.height }}
                </span>
              </div>

              <div class="flex flex-col gap-2">
                <span class="text-copy-sm text-tertiary">Duration</span>
                <div class="flex flex-wrap gap-1.5">
                  <UiButton
                    v-for="(dur, i) in durationOptions"
                    :key="dur.label"
                    variant="option"
                    :active="selectedDuration === i"
                    class="min-w-0 flex-1"
                    @click="selectedDuration = i"
                  >
                    {{ dur.label }}
                  </UiButton>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <span class="text-copy-sm text-tertiary">Frame rate</span>
                <div class="flex gap-1.5">
                  <UiButton
                    v-for="(fps, i) in fpsOptions"
                    :key="fps.label"
                    variant="option"
                    :active="selectedFps === i"
                    class="flex-1"
                    @click="selectedFps = i"
                  >
                    {{ fps.label }} fps
                  </UiButton>
                </div>
              </div>

              <UiButton variant="action" :icon-left="ArrowDownTrayIcon" @click="handleVideoExport">
                Render video
              </UiButton>

              <p v-if="videoState.error" class="text-copy-xs text-red-400">
                {{ videoState.error }}
              </p>
            </div>

            <div v-else class="flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <span class="text-copy-sm text-secondary">
                  Rendering frame {{ videoState.currentFrame }} / {{ videoState.totalFrames }}
                </span>
                <span class="text-copy-sm text-tertiary">
                  {{ Math.round(videoState.progress * 100) }}%
                </span>
              </div>

              <div class="h-1.5 overflow-hidden rounded-full bg-surface-1">
                <div
                  class="h-full rounded-full bg-secondary transition-all duration-150"
                  :style="{ width: `${videoState.progress * 100}%` }"
                />
              </div>

              <UiButton variant="action" class="text-tertiary" @click="abort">
                Cancel
              </UiButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
