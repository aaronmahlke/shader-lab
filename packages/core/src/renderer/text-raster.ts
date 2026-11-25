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
  /** Start offset in comp px along X (positive = characters slide in from the right). */
  animOffsetX: number;
  /** Start blur radius in comp px (characters sharpen as they arrive). */
  animBlur: number;
  /** 0 = smooth (eased, staggered), 1 = typewriter (characters pop in one by one). */
  animStyle: number;
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
    animOffsetX: num(values.animOffsetX, 0),
    animBlur: num(values.animBlur, 0),
    animStyle: num(values.animStyle, 0),
  };
}

/** Cache key: re-rasterize only when the spec or target size changes. */
/**
 * Bumped whenever the browser finishes loading web fonts. Part of the cache
 * key, so text drawn with a fallback before its font arrived is redrawn.
 */
let fontEpoch = 0;
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener("loadingdone", () => {
    fontEpoch++;
  });
}

const requestedFonts = new Set<string>();

/**
 * Ask the browser to load the spec's font once (canvas text never triggers web
 * font loads itself). `fonts.check()` is not used: it reports true for lists
 * ending in a generic family even while the web font is still unloaded.
 */
export function requestTextFont(spec: TextLayerSpec, contentScale: number): void {
  if (typeof document === "undefined" || !document.fonts) return;
  const key = `${spec.fontWeight} 16px ${spec.fontFamily}`;
  if (requestedFonts.has(key)) return;
  requestedFonts.add(key);
  document.fonts.load(key).catch(() => {});
}

export function textCacheKey(spec: TextLayerSpec, width: number, height: number): string {
  return JSON.stringify([spec, width, height, fontEpoch]);
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
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
};

/** True when the spec needs the per-character animated path. */
export function isTextAnimated(spec: TextLayerSpec): boolean {
  return spec.animProgress < 1; // at progress 1 every animator resolves to identity
}

/** Typewriter: number of characters shown at `progress` (all at 1). */
export function typedCount(progress: number, count: number): number {
  return Math.max(0, Math.min(count, Math.floor(progress * count + 1e-6)));
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

/** CSS font string for a spec at a raster scale. */
export function textFont(spec: TextLayerSpec, contentScale: number): string {
  const fontPx = Math.max(1, spec.fontSize * contentScale);
  return `${spec.fontWeight} ${fontPx}px ${spec.fontFamily}`;
}

export type TextGlyph = {
  ch: string;
  /** Left edge and vertical center in raster px. */
  x: number;
  y: number;
  w: number;
  /** Arrival progress 0..1 (animators ease from their start state at 0). */
  t: number;
};

export type TextLayout = {
  fontPx: number;
  glyphs: TextGlyph[];
  /**
   * Text end: just after the last revealed character (or the text start when
   * nothing is revealed yet), at that line's vertical center, in raster px.
   * Layers can attach to it (e.g. a cursor that follows typing).
   */
  end: { x: number; y: number };
};

/**
 * Lay out a spec into a `width`×`height` raster: per-character positions,
 * arrival progress and the text-end point. Shared by drawing and attach
 * points so both agree exactly. `measure(ch, font)` returns glyph width.
 */
export function layoutTextSpec(
  spec: TextLayerSpec,
  width: number,
  height: number,
  contentScale: number,
  measure: (ch: string, font: string) => number,
): TextLayout {
  const fontPx = Math.max(1, spec.fontSize * contentScale);
  const font = textFont(spec, contentScale);
  const lines = spec.content.split("\n");
  const lineStep = fontPx * spec.lineHeight;
  const startY = height / 2 - (lineStep * (lines.length - 1)) / 2;
  const pad = Math.round(fontPx * 0.25);
  const trackingPx = spec.tracking * contentScale;
  const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
  const typewriter = spec.animStyle === 1;
  const shown = typedCount(spec.animProgress, totalChars);

  const glyphs: TextGlyph[] = [];
  let end: { x: number; y: number } | null = null;
  let index = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const y = startY + li * lineStep;
    const widths = [...line].map((ch) => measure(ch, font));
    const lineWidth = widths.reduce((a, b) => a + b, 0) + trackingPx * Math.max(0, line.length - 1);
    let x =
      spec.textAlign === "left"
        ? pad
        : spec.textAlign === "right"
          ? width - pad - lineWidth
          : (width - lineWidth) / 2;
    if (end === null) end = { x, y };

    for (let ci = 0; ci < line.length; ci++) {
      const w = widths[ci]!;
      const t = typewriter
        ? index < shown ? 1 : 0
        : charProgress(spec.animProgress, index, totalChars, spec.animStagger);
      const revealed = typewriter ? index < shown : index < shown || t >= 0.5;
      glyphs.push({ ch: line[ci]!, x, y, w, t });
      index++;
      x += w;
      if (revealed) end = { x, y };
      x += trackingPx;
    }
  }

  return { fontPx, glyphs, end: end ?? { x: width / 2, y: height / 2 } };
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
  /**
   * Content window (layer-UV rect x0, y0, w, h; y up): draw only that part of
   * the layer, magnified to fill the canvas, so zoomed-in text stays vector
   * sharp. Omitted / (0,0,1,1) = the whole layer.
   */
  window?: readonly [number, number, number, number],
): void {
  ctx.clearRect(0, 0, width, height);
  if (!spec.content.trim()) return;
  const windowed = !!window && (window[2] < 1 || window[3] < 1);
  if (windowed) {
    const [x0, y0, w, h] = window!;
    ctx.save();
    // Full-layer canvas px → window px: canvas y runs down, layer uv y up.
    ctx.translate((-x0 * width) / w, (-(1 - y0 - h) * height) / h);
    ctx.scale(1 / w, 1 / h);
  }
  drawTextSpecLayer(ctx, spec, width, height, contentScale);
  if (windowed) ctx.restore();
}

function drawTextSpecLayer(
  ctx: Canvas2DLike,
  spec: TextLayerSpec,
  width: number,
  height: number,
  contentScale: number,
): void {

  ctx.font = textFont(spec, contentScale);
  ctx.fillStyle = spec.color;
  ctx.textBaseline = "middle";

  if (!isTextAnimated(spec)) {
    // Static: whole lines (keeps the font's kerning).
    const fontPx = Math.max(1, spec.fontSize * contentScale);
    const lines = spec.content.split("\n");
    const lineStep = fontPx * spec.lineHeight;
    const startY = height / 2 - (lineStep * (lines.length - 1)) / 2;
    const pad = Math.round(fontPx * 0.25);
    const x = spec.textAlign === "left" ? pad : spec.textAlign === "right" ? width - pad : width / 2;
    ctx.textAlign = spec.textAlign;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${spec.tracking * contentScale}px`;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i]!, x, startY + i * lineStep);
    return;
  }

  // Per-character animated path: each glyph translated/scaled/rotated/faded/
  // blurred by its arrival progress (tracking handled by the layout).
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  const layout = layoutTextSpec(spec, width, height, contentScale, (ch) => ctx.measureText(ch).width);
  const blurOffset = width + height + 1000; // glyph drawn off-canvas, its shadow lands in place

  for (const g of layout.glyphs) {
    if (g.ch === " " || g.t <= 0) continue;
    const t = g.t;
    const blurPx = spec.animBlur * (1 - t) * contentScale;
    ctx.save();
    if (blurPx > 0.25 && "shadowBlur" in ctx) {
      // Blur via the shadow trick (works in every canvas, unlike ctx.filter).
      ctx.translate(-blurOffset, 0);
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = blurPx;
      ctx.shadowOffsetX = blurOffset;
      ctx.shadowOffsetY = 0;
    }
    ctx.translate(
      g.x + g.w / 2 + (1 - t) * spec.animOffsetX * contentScale,
      g.y + (1 - t) * spec.animOffsetY * contentScale,
    );
    const s = spec.animScaleFrom + (1 - spec.animScaleFrom) * t;
    if (s !== 1) ctx.scale(Math.max(s, 0.001), Math.max(s, 0.001));
    const rot = spec.animRotation * (1 - t);
    if (rot !== 0) ctx.rotate((rot * Math.PI) / 180);
    ctx.globalAlpha = Math.min(1, Math.max(0, 1 - spec.animFade * (1 - t)));
    ctx.fillText(g.ch, -g.w / 2, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
