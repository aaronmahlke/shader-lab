import type { LayerInstance } from "../types/editor";

/**
 * Text rasterization shared by the browser and node renderers. The spec is
 * resolved from layer values; drawing happens on any Canvas2D-compatible
 * context (DOM canvas or @napi-rs/canvas).
 */

export type TextLayerSpec = {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  tracking: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right";
  /** Per-character animator: 0 = fully out, 1 = fully in (keyframe this). */
  animProgress: number;
  /** 0 = all characters together, →1 = fully staggered one after another. */
  animStagger: number;
  /** Start offset in comp px (positive = characters rise up into place). */
  animOffsetY: number;
  /** How much characters fade in (0 = no fade, 1 = from fully transparent). */
  animFade: number;
  /** Start scale for characters (1 = none). */
  animScaleFrom: number;
  /** Start rotation in degrees per character (0 = none). */
  animRotation: number;
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function textSpecFromValues(values: Record<string, unknown>): TextLayerSpec {
  return {
    content: typeof values.content === "string" ? values.content : "",
    fontFamily:
      typeof values.fontFamily === "string" ? values.fontFamily : "sans-serif",
    fontSize: num(values.fontSize, 160),
    fontWeight: num(values.fontWeight, 600),
    color: typeof values.u_color === "string" ? values.u_color : "#ffffff",
    tracking: num(values.tracking, 0),
    lineHeight: num(values.lineHeight, 1.1),
    textAlign:
      values.textAlign === "left" || values.textAlign === "right"
        ? values.textAlign
        : "center",
    animProgress: num(values.animProgress, 1),
    animStagger: num(values.animStagger, 0.5),
    animOffsetY: num(values.animOffsetY, 0),
    animFade: num(values.animFade, 1),
    animScaleFrom: num(values.animScaleFrom, 1),
    animRotation: num(values.animRotation, 0),
  };
}

/** Cache key: re-rasterize only when the spec or target size changes. */
export function textCacheKey(spec: TextLayerSpec, width: number, height: number): string {
  return JSON.stringify([spec, width, height]);
}

/** Extract the text spec for a layer, or null for non-text layers. */
export function textSpecForLayer(layer: LayerInstance): TextLayerSpec | null {
  if (layer.type !== "text") return null;
  return textSpecFromValues(layer.values);
}

type Canvas2DLike = {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(rad: number): void;
  font: string;
  fillStyle: unknown;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  letterSpacing?: string;
};

/** True when the spec needs the per-character animated path. */
export function isTextAnimated(spec: TextLayerSpec): boolean {
  if (spec.animProgress < 1) return true;
  return false; // at progress 1 every animator resolves to identity
}

/**
 * Per-character progress with stagger: characters start one after another
 * across the available progress window and each eases with smoothstep.
 */
export function charProgress(
  progress: number,
  index: number,
  count: number,
  stagger: number,
): number {
  const s = Math.min(0.95, Math.max(0, stagger));
  const start = count > 1 ? (s * index) / (count - 1) : 0;
  const window = Math.max(1 - s, 0.05);
  const t = Math.min(1, Math.max(0, (progress - start) / window));
  return t * t * (3 - 2 * t); // smoothstep
}

/**
 * Draw the spec into a `width`x`height` canvas. `contentScale` converts
 * composition pixels (fontSize etc.) into raster pixels, so the same spec
 * renders identically at any buffer resolution.
 */
export function drawTextSpec(
  ctx: Canvas2DLike,
  spec: TextLayerSpec,
  width: number,
  height: number,
  contentScale: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (!spec.content.trim()) return;

  const fontPx = Math.max(1, spec.fontSize * contentScale);
  ctx.font = `${spec.fontWeight} ${fontPx}px ${spec.fontFamily}`;
  ctx.fillStyle = spec.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = spec.textAlign;
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${spec.tracking * contentScale}px`;
  }

  const lines = spec.content.split("\n");
  const lineStep = fontPx * spec.lineHeight;
  const totalHeight = lineStep * (lines.length - 1);
  const startY = height / 2 - totalHeight / 2;
  const pad = Math.round(fontPx * 0.25);
  const x =
    spec.textAlign === "left" ? pad : spec.textAlign === "right" ? width - pad : width / 2;

  if (!isTextAnimated(spec)) {
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, x, startY + i * lineStep);
    }
    return;
  }

  // Per-character animated path: manual advance (tracking handled by hand),
  // each glyph translated/scaled/rotated/faded by its staggered progress.
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  const trackingPx = spec.tracking * contentScale;
  const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
  let charIndex = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const y = startY + li * lineStep;
    const widths = [...line].map((ch) => ctx.measureText(ch).width);
    const lineWidth =
      widths.reduce((a, b) => a + b, 0) + trackingPx * Math.max(0, line.length - 1);
    let cursor =
      spec.textAlign === "left"
        ? pad
        : spec.textAlign === "right"
          ? width - pad - lineWidth
          : (width - lineWidth) / 2;

    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci]!;
      const w = widths[ci]!;
      const t = charProgress(spec.animProgress, charIndex, totalChars, spec.animStagger);
      charIndex++;

      if (ch !== " " && t > 0) {
        ctx.save();
        ctx.translate(cursor + w / 2, y + (1 - t) * spec.animOffsetY * contentScale);
        const s = spec.animScaleFrom + (1 - spec.animScaleFrom) * t;
        if (s !== 1) ctx.scale(Math.max(s, 0.001), Math.max(s, 0.001));
        const rot = spec.animRotation * (1 - t);
        if (rot !== 0) ctx.rotate((rot * Math.PI) / 180);
        ctx.globalAlpha = Math.min(1, Math.max(0, 1 - spec.animFade * (1 - t)));
        ctx.fillText(ch, -w / 2, 0);
        ctx.restore();
      }
      cursor += w + trackingPx;
    }
  }
  ctx.globalAlpha = 1;
}
