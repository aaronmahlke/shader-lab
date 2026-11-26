<script setup lang="ts">
import type { ExportResult } from "~/composables/use-video-export";
import { negotiateCanvasEncoding, type ExportFormatPreference } from "#shared/editor/video-encoding";
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from "reka-ui";
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
  renderAudio?: (duration: number) => Promise<AudioBuffer | null>;
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
  /** Render metadata + a reusable stored video for these settings (local projects). */
  prepareVideoExport?: (s: { width: number; height: number; fps: number; duration: number }) => Promise<{
    meta: Record<string, unknown>;
    reuseVideo: { url: string } | null;
  }>;
  /** Called with the finished render (store it for reuse). */
  onExported?: (result: ExportResult) => void | Promise<void>;
};

const { experimentId, shader, designCanvas, canvasVideoDuration = 0, compositionDuration = 0, beforeExport, prepareVideoExport, onExported } = defineProps<Props>();

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

  const extra = prepareVideoExport
    ? await prepareVideoExport({ width, height, fps: fps.value, duration: dur.value })
    : { meta: {}, reuseVideo: null };
  const result = await exportVideo(shader, {
    width,
    height,
    fps: fps.value,
    duration: dur.value,
    experimentId,
    format: selectedFormat.value,
    meta: extra.meta,
    reuseVideo: extra.reuseVideo,
  });
  if (result) await onExported?.(result);

  if (!videoState.exporting && !videoState.error) {
    open.value = false;
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50" />
      <DialogContent
        data-ui="studio"
        class="fixed top-[20%] left-1/2 z-50 w-[360px] -translate-x-1/2 overflow-hidden rounded-[var(--s-r)] bg-[var(--s-tile)] shadow-[0_0_0_1px_var(--s-edge),0_12px_32px_#000b] outline-none"
      >
        <div class="flex h-[var(--s-row)] items-center bg-[var(--s-band)] pr-[2px] pl-[6px]">
          <DialogTitle class="flex-1 select-none">Export</DialogTitle>
          <StudioButton variant="ghost" square aria-label="Close" title="Close" @click="open = false">
            <StudioIcon name="close" />
          </StudioButton>
        </div>

        <div class="flex flex-col gap-[8px] p-[8px]">
          <StudioSegmented
            v-model="tab"
            :options="[{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }]"
          />

          <template v-if="tab === 'image'">
            <StudioField :label="useScaleExport ? 'Scale' : 'Resolution'" inline>
              <StudioSegmented
                v-if="useScaleExport"
                v-model="selectedScale"
                :options="EXPORT_SCALE_MULTIPLIERS.map((p, i) => ({ value: i, label: p.label }))"
              />
              <StudioSegmented
                v-else
                v-model="selectedLegacyResolution"
                :options="LEGACY_RESOLUTIONS.map((r, i) => ({ value: i, label: r.label }))"
              />
            </StudioField>
            <p class="text-[var(--s-dim)] tabular-nums">
              <template v-if="useScaleExport && designCanvas">
                {{ designCanvas.width }} × {{ designCanvas.height }} → {{ exportSize.width }} × {{ exportSize.height }}
              </template>
              <template v-else>{{ exportSize.width }} × {{ exportSize.height }}</template>
            </p>
            <StudioButton active class="!h-[22px] justify-center" @click="handleImageExport">
              <StudioIcon name="export" /> Download PNG
            </StudioButton>
          </template>

          <template v-if="tab === 'video'">
            <template v-if="!videoState.exporting">
              <StudioField :label="useScaleExport ? 'Scale' : 'Resolution'" inline>
                <StudioSegmented
                  v-if="useScaleExport"
                  v-model="selectedScale"
                  :options="EXPORT_SCALE_MULTIPLIERS.map((p, i) => ({ value: i, label: p.label }))"
                />
                <StudioSegmented
                  v-else
                  v-model="selectedLegacyResolution"
                  :options="LEGACY_RESOLUTIONS.map((r, i) => ({ value: i, label: r.label }))"
                />
              </StudioField>
              <p v-if="useScaleExport && designCanvas" class="text-[var(--s-dim)] tabular-nums">
                {{ designCanvas.width }} × {{ designCanvas.height }} → {{ exportSize.width }} × {{ exportSize.height }}
              </p>

              <StudioField label="Duration" inline>
                <div class="grid grid-cols-3 gap-[2px]">
                  <StudioButton
                    v-for="(dur, i) in durationOptions"
                    :key="dur.label"
                    :active="selectedDuration === i"
                    :class="dur.dynamic ? 'col-span-3' : ''"
                    class="justify-center"
                    :title="dur.label"
                    @click="selectedDuration = i"
                  >
                    {{ dur.label }}
                  </StudioButton>
                </div>
              </StudioField>

              <StudioField label="Frame rate" inline>
                <StudioSegmented
                  v-model="selectedFps"
                  :options="fpsOptions.map((f, i) => ({ value: i, label: `${f.label} fps` }))"
                />
              </StudioField>

              <StudioField label="Format" inline>
                <StudioSegmented
                  :model-value="selectedFormat"
                  :options="formatOptions.map((f) => ({ value: f.value, label: f.label }))"
                  @update:model-value="selectedFormat = $event as typeof selectedFormat"
                />
              </StudioField>

              <p v-if="compatWarning" class="text-[#e5a54d]">{{ compatWarning }}</p>

              <StudioButton active class="!h-[22px] justify-center" :disabled="formatUnsupported" @click="handleVideoExport">
                <StudioIcon name="export" /> Render video
                <span v-if="resolvedFormat" class="opacity-70">({{ resolvedFormat }})</span>
              </StudioButton>

              <p v-if="videoState.error" class="text-[var(--s-danger)]">{{ videoState.error }}</p>
            </template>

            <template v-else>
              <div class="flex items-center justify-between tabular-nums">
                <span>Rendering frame {{ videoState.currentFrame }} / {{ videoState.totalFrames }}</span>
                <span class="text-[var(--s-dim)]">{{ Math.round(videoState.progress * 100) }} %</span>
              </div>
              <div class="h-[4px] bg-[var(--s-inset)]">
                <div class="h-full bg-[var(--s-accent)]" :style="{ width: `${videoState.progress * 100}%` }" />
              </div>
              <StudioButton class="justify-center" @click="abort">Cancel</StudioButton>
            </template>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
