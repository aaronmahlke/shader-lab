import type { PaletteRgb } from "./grainy-dither-palette";

function nearestPalette(
  r: number,
  g: number,
  b: number,
  palette: readonly PaletteRgb[],
): PaletteRgb {
  let best = palette[0]!;
  let bestDist = Infinity;
  for (const color of palette) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

function addError(
  buf: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  er: number,
  eg: number,
  eb: number,
  factor: number,
) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const i = (y * width + x) * 3;
  buf[i] = buf[i]! + er * factor;
  buf[i + 1] = buf[i + 1]! + eg * factor;
  buf[i + 2] = buf[i + 2]! + eb * factor;
}

function diffusePixel(
  work: Float32Array,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  palette: readonly PaletteRgb[],
  leftToRight: boolean,
) {
  const wi = (y * width + x) * 3;
  const oldR = work[wi]!;
  const oldG = work[wi + 1]!;
  const oldB = work[wi + 2]!;

  const [nr, ng, nb] = nearestPalette(oldR, oldG, oldB, palette);

  const oi = (y * width + x) * 4;
  out[oi] = nr;
  out[oi + 1] = ng;
  out[oi + 2] = nb;
  out[oi + 3] = 255;

  const er = oldR - nr;
  const eg = oldG - ng;
  const eb = oldB - nb;

  if (leftToRight) {
    addError(work, width, height, x + 1, y, er, eg, eb, 7 / 16);
    addError(work, width, height, x - 1, y + 1, er, eg, eb, 3 / 16);
    addError(work, width, height, x, y + 1, er, eg, eb, 5 / 16);
    addError(work, width, height, x + 1, y + 1, er, eg, eb, 1 / 16);
  } else {
    addError(work, width, height, x - 1, y, er, eg, eb, 7 / 16);
    addError(work, width, height, x + 1, y + 1, er, eg, eb, 3 / 16);
    addError(work, width, height, x, y + 1, er, eg, eb, 5 / 16);
    addError(work, width, height, x - 1, y + 1, er, eg, eb, 1 / 16);
  }
}

function diffusePixelJjn(
  work: Float32Array,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  palette: readonly PaletteRgb[],
  leftToRight: boolean,
) {
  const wi = (y * width + x) * 3;
  const oldR = work[wi]!;
  const oldG = work[wi + 1]!;
  const oldB = work[wi + 2]!;

  const [nr, ng, nb] = nearestPalette(oldR, oldG, oldB, palette);

  const oi = (y * width + x) * 4;
  out[oi] = nr;
  out[oi + 1] = ng;
  out[oi + 2] = nb;
  out[oi + 3] = 255;

  const er = oldR - nr;
  const eg = oldG - ng;
  const eb = oldB - nb;

  const fwd = leftToRight ? 1 : -1;
  const back = -fwd;

  addError(work, width, height, x + fwd, y, er, eg, eb, 7 / 48);
  addError(work, width, height, x + 2 * fwd, y, er, eg, eb, 5 / 48);
  addError(work, width, height, x + back, y + 1, er, eg, eb, 3 / 48);
  addError(work, width, height, x, y + 1, er, eg, eb, 5 / 48);
  addError(work, width, height, x + fwd, y + 1, er, eg, eb, 7 / 48);
  addError(work, width, height, x + 2 * fwd, y + 1, er, eg, eb, 5 / 48);
  addError(work, width, height, x + back, y + 2, er, eg, eb, 1 / 48);
  addError(work, width, height, x, y + 2, er, eg, eb, 3 / 48);
  addError(work, width, height, x + fwd, y + 2, er, eg, eb, 5 / 48);
  addError(work, width, height, x + 2 * fwd, y + 2, er, eg, eb, 3 / 48);
  addError(work, width, height, x + 3 * fwd, y + 2, er, eg, eb, 1 / 48);
}

/**
 * Serpentine Jarvis–Judice–Ninke error diffusion to a fixed palette.
 * Finer stipple than Floyd–Steinberg; closer to reference grain density.
 */
export function jarvisJudiceNinkeDither(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly PaletteRgb[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const work = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const wi = (y * width + x) * 3;
      work[wi] = source[si]!;
      work[wi + 1] = source[si + 1]!;
      work[wi + 2] = source[si + 2]!;
    }
  }

  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0;
    if (leftToRight) {
      for (let x = 0; x < width; x++) {
        diffusePixelJjn(work, out, width, height, x, y, palette, true);
      }
    } else {
      for (let x = width - 1; x >= 0; x--) {
        diffusePixelJjn(work, out, width, height, x, y, palette, false);
      }
    }
  }

  return out;
}

function diffusePixelAtkinson(
  work: Float32Array,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  palette: readonly PaletteRgb[],
  leftToRight: boolean,
) {
  const wi = (y * width + x) * 3;
  const oldR = work[wi]!;
  const oldG = work[wi + 1]!;
  const oldB = work[wi + 2]!;

  const [nr, ng, nb] = nearestPalette(oldR, oldG, oldB, palette);

  const oi = (y * width + x) * 4;
  out[oi] = nr;
  out[oi + 1] = ng;
  out[oi + 2] = nb;
  out[oi + 3] = 255;

  const er = oldR - nr;
  const eg = oldG - ng;
  const eb = oldB - nb;

  const fwd = leftToRight ? 1 : -1;
  const back = -fwd;
  const f = 1 / 8;

  addError(work, width, height, x + fwd, y, er, eg, eb, f);
  addError(work, width, height, x + 2 * fwd, y, er, eg, eb, f);
  addError(work, width, height, x + back, y + 1, er, eg, eb, f);
  addError(work, width, height, x, y + 1, er, eg, eb, f);
  addError(work, width, height, x + fwd, y + 1, er, eg, eb, f);
  addError(work, width, height, x, y + 2, er, eg, eb, f);
}

/** Serpentine Atkinson — speckled grain, less directional worming than FS/JJN. */
export function atkinsonDither(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly PaletteRgb[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const work = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const wi = (y * width + x) * 3;
      work[wi] = source[si]!;
      work[wi + 1] = source[si + 1]!;
      work[wi + 2] = source[si + 2]!;
    }
  }

  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0;
    if (leftToRight) {
      for (let x = 0; x < width; x++) {
        diffusePixelAtkinson(work, out, width, height, x, y, palette, true);
      }
    } else {
      for (let x = width - 1; x >= 0; x--) {
        diffusePixelAtkinson(work, out, width, height, x, y, palette, false);
      }
    }
  }

  return out;
}

/**
 * Serpentine Floyd–Steinberg error diffusion to a fixed palette.
 * Input is top-left origin RGBA; output is top-left origin RGBA.
 */
export function floydSteinbergDither(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly PaletteRgb[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const work = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const wi = (y * width + x) * 3;
      work[wi] = source[si]!;
      work[wi + 1] = source[si + 1]!;
      work[wi + 2] = source[si + 2]!;
    }
  }

  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0;
    if (leftToRight) {
      for (let x = 0; x < width; x++) {
        diffusePixel(work, out, width, height, x, y, palette, true);
      }
    } else {
      for (let x = width - 1; x >= 0; x--) {
        diffusePixel(work, out, width, height, x, y, palette, false);
      }
    }
  }

  return out;
}

/** WebGL readPixels is bottom-left origin; flip to top-left for 2D canvas. */
export function flipRgbaVertical(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    out.set(data.subarray(srcY * row, srcY * row + row), y * row);
  }
  return out;
}
