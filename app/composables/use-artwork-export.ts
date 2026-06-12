import type { ArtworkDocument } from "#shared/types/artwork";
import type { LayerInstance, LFOSource, ModulationAssignment } from "#shared/types/editor";
import { drawArtworkLayers, type ArtworkImageCache } from "#shared/artwork/draw-artwork";
import {
  getMaxCanvasVideoDuration,
  loadArtworkVideo,
  syncVideosAtTimeAndWait,
  type ArtworkVideoCache,
} from "#shared/artwork/video-layer";

type ShaderCache = Record<string, {
  layers: LayerInstance[];
  lfos: LFOSource[];
  assignments: ModulationAssignment[];
}>;

type ExportControls = {
  pause: () => void;
  resume: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  configureRenderer: (width: number, height: number) => void;
  restoreRenderer: () => void;
  renderFrame: (time: number) => void | Promise<void>;
};

type MediaCaches = {
  imageCache: Ref<ArtworkImageCache>;
  videoCache: Ref<ArtworkVideoCache>;
};

export function useArtworkExport(
  artwork: Ref<ArtworkDocument>,
  shaderCache: Ref<ShaderCache>,
  shaderControls: ExportControls,
  sampleLfosAtTime: (time: number) => void,
  mediaCaches?: MediaCaches,
) {
  const imageCache = mediaCaches?.imageCache ?? ref<ArtworkImageCache>(new Map());
  const videoCache = mediaCaches?.videoCache ?? ref<ArtworkVideoCache>(new Map());
  let exportMediaReady = false;

  async function ensureImagesLoaded() {
    const cache = new Map(imageCache.value);
    for (const layer of artwork.value.layers) {
      if (layer.type === "image" && layer.src && !cache.has(layer.src)) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            cache.set(layer.src, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = layer.src;
        });
      }
    }
    imageCache.value = cache;
  }

  async function ensureVideosLoaded() {
    const cache = new Map(videoCache.value);
    for (const layer of artwork.value.layers) {
      if (layer.type === "video" && layer.src && !cache.has(layer.src)) {
        const video = await loadArtworkVideo(layer.src);
        if (video) {
          video.loop = layer.loop !== false;
          cache.set(layer.src, video);
        }
      }
    }
    videoCache.value = cache;
  }

  async function ensureMediaLoaded() {
    await Promise.all([ensureImagesLoaded(), ensureVideosLoaded()]);
    exportMediaReady = true;
  }

  async function ensureMediaLoadedOnce() {
    if (!exportMediaReady) await ensureMediaLoaded();
  }

  const canvasVideoDuration = computed(() =>
    getMaxCanvasVideoDuration(artwork.value.layers, videoCache.value),
  );

  const hasVideoLayers = computed(() =>
    artwork.value.layers.some((l) => l.type === "video" && l.enabled && l.src),
  );

  async function compositeToCanvas(
    target: HTMLCanvasElement,
    shaderCanvas: HTMLCanvasElement | null,
    timeSeconds: number,
    width: number,
    height: number,
  ) {
    target.width = width;
    target.height = height;
    const ctx = target.getContext("2d");
    if (!ctx) return;

    await syncVideosAtTimeAndWait(artwork.value.layers, videoCache.value, timeSeconds);

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, width, height);

    if (shaderCanvas && shaderCanvas.width > 0 && shaderCanvas.height > 0) {
      ctx.drawImage(
        shaderCanvas,
        0,
        0,
        shaderCanvas.width,
        shaderCanvas.height,
        0,
        0,
        width,
        height,
      );
    }

    drawArtworkLayers(ctx, width, height, artwork.value.layers, {
      imageCache: imageCache.value,
      videoCache: videoCache.value,
      designCanvas: artwork.value.canvas,
    });
  }

  function ensureShaderRenderedAtSize(
    exportWidth: number,
    exportHeight: number,
    timeSeconds: number,
  ): HTMLCanvasElement | null {
    shaderControls.configureRenderer(exportWidth, exportHeight);
    shaderControls.renderFrame(timeSeconds);
    const shaderCanvas = shaderControls.getCanvas();
    if (
      !shaderCanvas ||
      (shaderCanvas.width === exportWidth && shaderCanvas.height === exportHeight)
    ) {
      return shaderCanvas;
    }
    shaderControls.configureRenderer(exportWidth, exportHeight);
    shaderControls.renderFrame(timeSeconds);
    return shaderControls.getCanvas();
  }

  async function capturePng(exportWidth: number, exportHeight: number, filename: string) {
    await ensureMediaLoadedOnce();

    shaderControls.pause();
    const timeSeconds = performance.now() / 1000;
    const shaderCanvas = ensureShaderRenderedAtSize(
      exportWidth,
      exportHeight,
      timeSeconds,
    );
    const composite = document.createElement("canvas");
    await compositeToCanvas(composite, shaderCanvas, 0, exportWidth, exportHeight);

    shaderControls.restoreRenderer();
    shaderControls.resume();

    const blob = await new Promise<Blob | null>((resolve) => {
      composite.toBlob(resolve, "image/png");
    });
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const videoCanvas = ref<HTMLCanvasElement | null>(null);

  onMounted(() => {
    videoCanvas.value = document.createElement("canvas");
  });

  onUnmounted(() => {
    videoCanvas.value = null;
  });

  async function compositeFrameSync(time: number, outWidth: number, outHeight: number) {
    await ensureMediaLoadedOnce();
    sampleLfosAtTime(time);
    const shaderCanvas = ensureShaderRenderedAtSize(outWidth, outHeight, time);
    const vc = videoCanvas.value;
    if (!vc) return;

    const composite = document.createElement("canvas");
    await compositeToCanvas(composite, shaderCanvas, time, outWidth, outHeight);

    vc.width = outWidth;
    vc.height = outHeight;
    const vctx = vc.getContext("2d");
    if (!vctx) return;
    vctx.drawImage(composite, 0, 0);
  }

  function getExportControls(artifactId: string): ExportControls & { capture: (w: number, h: number) => Promise<void> } {
    let outW = artwork.value.canvas.width;
    let outH = artwork.value.canvas.height;

    return {
      pause: () => shaderControls.pause(),
      resume: () => shaderControls.resume(),
      configureRenderer: (w, h) => {
        outW = w;
        outH = h;
        shaderControls.configureRenderer(w, h);
        if (videoCanvas.value) {
          videoCanvas.value.width = w;
          videoCanvas.value.height = h;
        }
      },
      restoreRenderer: () => shaderControls.restoreRenderer(),
      getCanvas: () => videoCanvas.value,
      renderFrame: (time: number) => compositeFrameSync(time, outW, outH),
      capture: async (w: number, h: number) => {
        await capturePng(w, h, `${artifactId}-${w}x${h}.png`);
      },
    };
  }

  return {
    capturePng,
    getExportControls,
    ensureMediaLoaded,
    canvasVideoDuration,
    hasVideoLayers,
  };
}
