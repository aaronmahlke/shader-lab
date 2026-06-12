import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { ArtworkDocument, ArtworkLayer, ShaderDocument } from "#shared/types/artwork";
import { drawArtworkLayers } from "#shared/artwork/draw-artwork";
import { renderComposition } from "./render-composition";

type ArtworkRenderInput = {
  artwork: ArtworkDocument;
  shaders: Record<string, ShaderDocument>;
};

export async function renderArtwork(
  input: ArtworkRenderInput,
  options: { width?: number; height?: number; time?: number } = {},
): Promise<Buffer | null> {
  const { width, height } = {
    width: options.width ?? input.artwork.canvas.width,
    height: options.height ?? input.artwork.canvas.height,
  };
  const time = options.time ?? 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  const shaderLayer = [...input.artwork.layers]
    .reverse()
    .find((l): l is ArtworkLayer & { type: "shader" } => l.type === "shader" && l.enabled);

  if (shaderLayer && shaderLayer.shaderId !== "__pending__") {
    const shaderDoc = input.shaders[shaderLayer.shaderId];
    if (shaderDoc) {
      const png = await renderComposition(shaderDoc, { width, height, time });
      if (png) {
        const bg = await loadImage(png);
        ctx.drawImage(bg, 0, 0, width, height);
      }
    }
  }

  const imageCache = new Map<string, Awaited<ReturnType<typeof loadImage>>>();
  for (const layer of input.artwork.layers) {
    if (layer.type === "image" && layer.src && layer.enabled) {
      try {
        imageCache.set(layer.src, await loadImage(layer.src));
      } catch {
        // skip broken images
      }
    }
  }

  drawArtworkLayers(ctx, width, height, input.artwork.layers, {
    imageCache: imageCache as Map<string, CanvasImageSource>,
    timeSeconds: time,
    designCanvas: input.artwork.canvas,
  });

  return canvas.toBuffer("image/png");
}
