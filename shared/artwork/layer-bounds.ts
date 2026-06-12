import type {
  ArtworkCanvas,
  ArtworkImageLayer,
  ArtworkLayer,
  ArtworkTextLayer,
  ArtworkVideoLayer,
} from "../types/artwork";
import type { ArtworkImageCache } from "./draw-artwork";
import type { ArtworkVideoCache } from "./video-layer";
import { mediaScaleX, mediaScaleY } from "./media-scale";
import { measureTextLayerPx } from "./text-layer";

export type ArtworkRect = {
  /** Normalized 0–1, origin top-left of artwork */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArtworkLayerCaches = {
  imageCache?: ArtworkImageCache;
  videoCache?: ArtworkVideoCache;
};

export type TransformableLayer = ArtworkTextLayer | ArtworkImageLayer | ArtworkVideoLayer;

export function isTransformableLayer(
  layer: ArtworkLayer,
): layer is TransformableLayer {
  return layer.type === "text" || layer.type === "image" || layer.type === "video";
}

export { measureTextLayerPx } from "./text-layer";

function mediaPxRect(
  canvas: ArtworkCanvas,
  layer: ArtworkImageLayer | ArtworkVideoLayer,
  iw: number,
  ih: number,
): { left: number; top: number; width: number; height: number } {
  const { width, height } = canvas;
  const drawW = iw * mediaScaleX(layer);
  const drawH = ih * mediaScaleY(layer);
  const left = layer.x * width - drawW / 2;
  const top = (1 - layer.y) * height - drawH / 2;
  return { left, top, width: drawW, height: drawH };
}

export function measureImageLayerPx(
  canvas: ArtworkCanvas,
  layer: ArtworkImageLayer,
  caches?: ArtworkLayerCaches,
): { left: number; top: number; width: number; height: number } | null {
  const img = caches?.imageCache?.get(layer.src);
  if (!img) return null;

  const iw = "naturalWidth" in img ? img.naturalWidth : (img as HTMLImageElement).width;
  const ih = "naturalHeight" in img ? img.naturalHeight : (img as HTMLImageElement).height;
  if (!iw || !ih) return null;

  return mediaPxRect(canvas, layer, iw, ih);
}

export function measureVideoLayerPx(
  canvas: ArtworkCanvas,
  layer: ArtworkVideoLayer,
  caches?: ArtworkLayerCaches,
): { left: number; top: number; width: number; height: number } | null {
  const video = caches?.videoCache?.get(layer.src);
  if (!video) return null;

  const iw = video.videoWidth;
  const ih = video.videoHeight;
  if (!iw || !ih) return null;

  return mediaPxRect(canvas, layer, iw, ih);
}

export function pxRectToNormalized(
  rect: { left: number; top: number; width: number; height: number },
  canvas: ArtworkCanvas,
): ArtworkRect {
  return {
    x: rect.left / canvas.width,
    y: rect.top / canvas.height,
    width: rect.width / canvas.width,
    height: rect.height / canvas.height,
  };
}

export function measureLayerPx(
  ctx: CanvasRenderingContext2D,
  canvas: ArtworkCanvas,
  layer: TransformableLayer,
  caches?: ArtworkLayerCaches,
): { left: number; top: number; width: number; height: number } | null {
  if (layer.type === "text") {
    return measureTextLayerPx(ctx, canvas, layer);
  }
  if (layer.type === "image") {
    return measureImageLayerPx(canvas, layer, caches);
  }
  return measureVideoLayerPx(canvas, layer, caches);
}

export function hitTestPointInPxRect(
  px: number,
  py: number,
  rect: { left: number; top: number; width: number; height: number },
  padding = 6,
): boolean {
  return (
    px >= rect.left - padding
    && px <= rect.left + rect.width + padding
    && py >= rect.top - padding
    && py <= rect.top + rect.height + padding
  );
}

/** Top-most transformable layer at artwork-normalized point (x, y with y from bottom). */
export function pickTransformableLayer(
  ctx: CanvasRenderingContext2D,
  canvas: ArtworkCanvas,
  layers: ArtworkLayer[],
  normX: number,
  normY: number,
  caches?: ArtworkLayerCaches,
): TransformableLayer | null {
  const px = normX * canvas.width;
  const py = (1 - normY) * canvas.height;

  for (const layer of layers) {
    if (!layer.enabled || !isTransformableLayer(layer)) continue;
    if ((layer.type === "image" || layer.type === "video") && !layer.src) continue;

    const rect = measureLayerPx(ctx, canvas, layer, caches);
    if (rect && hitTestPointInPxRect(px, py, rect)) {
      return layer;
    }
  }
  return null;
}

export type HandleId = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export function isCornerHandle(id: HandleId): boolean {
  return id === "nw" || id === "ne" || id === "sw" || id === "se";
}

/** Set layer anchor from a top-left pixel bounding box (move only; size unchanged). */
export function setLayerFromPxRect(
  ctx: CanvasRenderingContext2D,
  canvas: ArtworkCanvas,
  layer: TransformableLayer,
  rect: { left: number; top: number; width: number; height: number },
) {
  if (layer.type === "image" || layer.type === "video") {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    layer.x = centerX / canvas.width;
    layer.y = 1 - centerY / canvas.height;
    return;
  }

  const measured = measureTextLayerPx(ctx, canvas, layer);

  const anchorY = rect.top + measured.height / 2;
  layer.y = 1 - anchorY / canvas.height;

  if (layer.align === "center") {
    layer.x = (rect.left + measured.width / 2) / canvas.width;
  } else if (layer.align === "right") {
    layer.x = (rect.left + measured.width) / canvas.width;
  } else {
    layer.x = rect.left / canvas.width;
  }
}

export function hitTestHandle(
  normRect: ArtworkRect,
  normX: number,
  normY: number,
  handleSizeNorm = 0.02,
): HandleId | null {
  const yTop = normRect.y;
  const yBottom = normRect.y + normRect.height;
  const xLeft = normRect.x;
  const xRight = normRect.x + normRect.width;
  const nx = normX;
  const ny = 1 - normY;

  const corners: { id: HandleId; x: number; y: number }[] = [
    { id: "nw", x: xLeft, y: yTop },
    { id: "ne", x: xRight, y: yTop },
    { id: "sw", x: xLeft, y: yBottom },
    { id: "se", x: xRight, y: yBottom },
  ];

  for (const c of corners) {
    if (
      Math.abs(nx - c.x) <= handleSizeNorm
      && Math.abs(ny - c.y) <= handleSizeNorm
    ) {
      return c.id;
    }
  }

  const xMid = (xLeft + xRight) / 2;
  const yMid = (yTop + yBottom) / 2;
  const edgeTol = handleSizeNorm;

  if (
    nx >= xLeft - edgeTol
    && nx <= xRight + edgeTol
    && Math.abs(ny - yTop) <= edgeTol
  ) {
    return "n";
  }
  if (
    nx >= xLeft - edgeTol
    && nx <= xRight + edgeTol
    && Math.abs(ny - yBottom) <= edgeTol
  ) {
    return "s";
  }
  if (
    ny >= yTop - edgeTol
    && ny <= yBottom + edgeTol
    && Math.abs(nx - xLeft) <= edgeTol
  ) {
    return "w";
  }
  if (
    ny >= yTop - edgeTol
    && ny <= yBottom + edgeTol
    && Math.abs(nx - xRight) <= edgeTol
  ) {
    return "e";
  }

  return null;
}
