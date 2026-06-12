import type {
  ArtworkCanvas,
  ArtworkDocument,
  ArtworkImageLayer,
  ArtworkLayer,
  ArtworkVideoLayer,
} from "../types/artwork";
import type { ArtworkVideoCache } from "./video-layer";
import { mediaScaleX, mediaScaleY } from "./media-scale";
import { drawTextLayer } from "./text-layer";

export type ArtworkImageCache = Map<string, CanvasImageSource>;

export type DrawArtworkOptions = {
  imageCache?: ArtworkImageCache;
  videoCache?: ArtworkVideoCache;
  /** Timeline position in seconds (video layers) */
  timeSeconds?: number;
  /** Design canvas size; required when drawing at export resolution ≠ design size */
  designCanvas?: ArtworkCanvas;
};

function rasterOutputScale(
  width: number,
  height: number,
  design?: ArtworkCanvas,
): { sx: number; sy: number } {
  if (!design || (design.width === width && design.height === height)) {
    return { sx: 1, sy: 1 };
  }
  return { sx: width / design.width, sy: height / design.height };
}

export function scaledImageBorderRadius(
  borderRadius: number | undefined,
  canvasHeight: number,
  drawW: number,
  drawH: number,
): number {
  const r = (borderRadius ?? 0) * (canvasHeight / 1080);
  return Math.max(0, Math.min(r, drawW / 2, drawH / 2));
}

function mediaDimensions(source: CanvasImageSource): { w: number; h: number } | null {
  if (source instanceof HTMLVideoElement) {
    const w = source.videoWidth;
    const h = source.videoHeight;
    return w && h ? { w, h } : null;
  }
  const iw = "naturalWidth" in source ? source.naturalWidth : (source as HTMLImageElement).width;
  const ih = "naturalHeight" in source ? source.naturalHeight : (source as HTMLImageElement).height;
  return iw && ih ? { w: iw, h: ih } : null;
}

function drawRasterLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layer: ArtworkImageLayer | ArtworkVideoLayer,
  source: CanvasImageSource,
  designCanvas?: ArtworkCanvas,
) {
  const dims = mediaDimensions(source);
  if (!dims) return;

  const { sx, sy } = rasterOutputScale(width, height, designCanvas);
  const drawW = dims.w * mediaScaleX(layer) * sx;
  const drawH = dims.h * mediaScaleY(layer) * sy;
  const x = layer.x * width - drawW / 2;
  const y = (1 - layer.y) * height - drawH / 2;

  const radius = scaledImageBorderRadius(layer.borderRadius, height, drawW, drawH);

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(x, y, drawW, drawH, radius);
    ctx.clip();
  }
  ctx.drawImage(source, x, y, drawW, drawH);
  ctx.restore();
}

/** Draw artwork design layers (text/image/video) on top of an existing background. */
export function drawArtworkLayers(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layers: ArtworkLayer[],
  options?: DrawArtworkOptions,
) {
  const { imageCache, videoCache, designCanvas } = options ?? {};

  const enabled = [...layers].reverse().filter((l) => l.enabled);

  for (const layer of enabled) {
    if (layer.type === "text") {
      drawTextLayer(ctx, width, height, layer);
    } else if (layer.type === "image" && layer.src) {
      const img = imageCache?.get(layer.src);
      if (img) drawRasterLayer(ctx, width, height, layer, img, designCanvas);
    } else if (layer.type === "video" && layer.src) {
      const video = videoCache?.get(layer.src);
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        drawRasterLayer(ctx, width, height, layer, video, designCanvas);
      }
    }
  }
}

export function defaultArtworkDocument(canvas = { width: 1080, height: 1080 }): ArtworkDocument {
  return { version: 1, canvas, layers: [] };
}
