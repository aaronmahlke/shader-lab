<script setup lang="ts">
import { negotiateCanvasEncoding, type ExportFormatPreference } from "#shared/editor/video-encoding";
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
  const opts: { label: string; value: number; dynamic?: boolean }[] = [];
  if (compositionDuration > 0.05) {
    opts.push({
      label: `Composition (${formatDuration(compositionDuration)})`,
      dynamic: true,
      value: compositionDuration,
    });
  }
  if (canvasVideoDuration > 0.05) {
    opts.push({
      label: `Canvas video (${formatDuration(canvasVideoDuration)})`,
      dynamic: true,
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

// Resolve which codec/container this browser will actually use for the
// selected size/fps, so the dialog says "mp4" or "webm" before rendering.
const formatOptions: Array<{ label: string; value: ExportFormatPreference }> = [
  { label: "Auto", value: "auto" },
  { label: "MP4", value: "mp4" },
  { label: "WebM", value: "webm" },
];
const selectedFormat = ref<ExportFormatPreference>("auto");

const resolvedFormat = ref<string | null>(null);
const formatUnsupported = ref(false);
const compatWarning = ref<string | null>(null);
watchEffect(async () => {
  const { width, height } = exportSize.value;
  const fps = fpsOptions[selectedFps.value]!.value;
  resolvedFormat.value = null;
  formatUnsupported.value = false;
  compatWarning.value = null;
  try {
    const enc = await negotiateCanvasEncoding(width, height, fps, selectedFormat.value);
    const codecLabel = enc.codec === "avc" ? "h.264" : enc.codec;
    resolvedFormat.value = `${enc.extension} · ${codecLabel}`;
    // Exports too large for H.264 fall back to VP9/AV1. Those files only play
    // on recent hardware — chat apps (Telegram, WhatsApp, …) show a blurry
    // thumbnail instead of video. Warn before the user renders for minutes.
    if (enc.codec !== "avc") {
      compatWarning.value = `${codecLabel} only plays on recent devices — chat apps and older players will fail. Use a smaller scale for h.264.`;
    }
  } catch {
    resolvedFormat.value = "not supported at this size";
    formatUnsupported.value = true;
  }
});

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
    format: selectedFormat.value,
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
        class="fixed left-1/2 top-[20%] z-50 w-[26rem] -translate-x-1/2 rounded-2xl border border-edge bg-base-1 shadow-2xl backdrop-blur-xl data-[state=open]:animate-contentShow"
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
                  full-width
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
                  full-width
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
                    full-width
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
                    full-width
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
                <div class="grid grid-cols-3 gap-1.5">
                  <UiButton
                    v-for="(dur, i) in durationOptions"
                    :key="dur.label"
                    variant="option"
                    full-width
                    :active="selectedDuration === i"
                    :class="dur.dynamic ? 'col-span-3' : ''"
                    :title="dur.label"
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
                    full-width
                    :active="selectedFps === i"
                    class="flex-1"
                    @click="selectedFps = i"
                  >
                    {{ fps.label }} fps
                  </UiButton>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <span class="text-copy-sm text-tertiary">Format</span>
                <div class="flex gap-1.5">
                  <UiButton
                    v-for="f in formatOptions"
                    :key="f.value"
                    variant="option"
                    full-width
                    :active="selectedFormat === f.value"
                    class="flex-1"
                    @click="selectedFormat = f.value"
                  >
                    {{ f.label }}
                  </UiButton>
                </div>
              </div>

              <p v-if="compatWarning" class="text-copy-sm text-amber-400">
                {{ compatWarning }}
              </p>

              <UiButton variant="action" :icon-left="ArrowDownTrayIcon" :disabled="formatUnsupported" @click="handleVideoExport">
                Render video
                <span v-if="resolvedFormat" class="ml-1 opacity-60">({{ resolvedFormat }})</span>
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
