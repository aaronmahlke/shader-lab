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
};

export function textSpecFromValues(values: Record<string, unknown>): TextLayerSpec {
  return {
    content: typeof values.content === "string" ? values.content : "",
    fontFamily:
      typeof values.fontFamily === "string" ? values.fontFamily : "sans-serif",
    fontSize: typeof values.fontSize === "number" ? values.fontSize : 160,
    fontWeight: typeof values.fontWeight === "number" ? values.fontWeight : 600,
    color: typeof values.u_color === "string" ? values.u_color : "#ffffff",
    tracking: typeof values.tracking === "number" ? values.tracking : 0,
    lineHeight: typeof values.lineHeight === "number" ? values.lineHeight : 1.1,
    textAlign:
      values.textAlign === "left" || values.textAlign === "right"
        ? values.textAlign
        : "center",
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
  font: string;
  fillStyle: unknown;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
};

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

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, x, startY + i * lineStep);
  }
}
