import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { GradientStop } from "../types";
import { GRADIENT_RESOLUTION } from "../shaders";
import { drawTextSpec, type TextLayerSpec } from "./text-raster";

/** Node text rasterization (headless export) — returns raw RGBA pixels. */
export function createNodeTextImage(
  spec: TextLayerSpec,
  width: number,
  height: number,
  contentScale: number,
): { width: number; height: number; data: Uint8Array } | null {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  drawTextSpec(ctx as unknown as Parameters<typeof drawTextSpec>[0], spec, width, height, contentScale);
  const image = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8Array(image.data) };
}

let stbnPixels: Uint8Array | null = null;
let stbnWidth = 0;
let stbnHeight = 0;

async function loadStbnPixels(stbnPath?: string): Promise<void> {
  if (stbnPixels) return;
  const path = stbnPath ?? join(process.cwd(), "public/textures/stbn-scalar-128x64.png");
  const img = await loadImage(readFileSync(path));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  stbnPixels = new Uint8Array(data.data);
  stbnWidth = img.width;
  stbnHeight = img.height;
}

export async function createStbnGlTexture(
  gl: WebGL2RenderingContext,
  stbnPath?: string,
): Promise<WebGLTexture> {
  await loadStbnPixels(stbnPath);
  const tex = gl.createTexture();
  if (!tex || !stbnPixels) throw new Error("Failed to create STBN texture");

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    stbnWidth,
    stbnHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    stbnPixels,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export function createNodeGradientData(stops: GradientStop[]): Uint8Array {
  const canvas = createCanvas(GRADIENT_RESOLUTION, 1);
  const ctx = canvas.getContext("2d");
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const gradient = ctx.createLinearGradient(0, 0, GRADIENT_RESOLUTION, 0);
  for (const stop of sorted) {
    gradient.addColorStop(Math.max(0, Math.min(1, stop.position)), stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GRADIENT_RESOLUTION, 1);
  return new Uint8Array(ctx.getImageData(0, 0, GRADIENT_RESOLUTION, 1).data);
}

export function pixelsToPngBuffer(pixels: Uint8Array, width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      imageData.data[dstRow + x] = pixels[srcRow + x]!;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("image/png");
}

