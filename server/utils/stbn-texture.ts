import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

let stbnPixels: Uint8Array | null = null;
let stbnWidth = 0;
let stbnHeight = 0;

async function loadStbnPixels(): Promise<void> {
  if (stbnPixels) return;
  const path = join(process.cwd(), "public/textures/stbn-scalar-128x64.png");
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
  gl: WebGLRenderingContext,
): Promise<WebGLTexture> {
  await loadStbnPixels();
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
