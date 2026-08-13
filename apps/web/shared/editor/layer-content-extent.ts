import {
  FULL_CONTENT_EXTENT,
  type ContentExtent,
} from "./layer-transform";

/**
 * Content-extent math for layers whose pixels do not fill the composition
 * frame (component and text). The extent describes the rect the layer
 * actually draws, as a fraction of the unit square, so gizmos, outlines and
 * hit-tests can wrap the content instead of the full frame.
 *
 * Component layers mirror `component-source.frag` + the u_contentSize math
 * in packages/core/src/renderer/render-passes.ts; text layers mirror the
 * layout of `drawTextSpec` in packages/core/src/renderer/text-raster.ts.
 */

export { FULL_CONTENT_EXTENT, type ContentExtent };

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Content rect of a component layer. Core draws the captured DOM frame
 * centered at `u_contentSize = css size × contentScale` buffer px inside a
 * `comp size × contentScale` frame, so the contentScale cancels and the
 * fraction is simply cssSize / compSize (clamped: anything past the frame
 * edge is clipped by the FBO).
 */
export function componentContentExtent(
  cssWidth: number,
  cssHeight: number,
  compWidth: number,
  compHeight: number,
): ContentExtent {
  if (!(compWidth > 0) || !(compHeight > 0) || !(cssWidth > 0) || !(cssHeight > 0)) {
    return FULL_CONTENT_EXTENT;
  }
  const w = clamp01(cssWidth / compWidth);
  const h = clamp01(cssHeight / compHeight);
  if (w >= 1 && h >= 1) return FULL_CONTENT_EXTENT;
  return {
    minX: 0.5 - w / 2,
    minY: 0.5 - h / 2,
    maxX: 0.5 + w / 2,
    maxY: 0.5 + h / 2,
  };
}

/** Per-edge crop fractions of an image/video layer (0 … 0.45 in the template). */
export type MediaCropValues = {
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
};

/**
 * Content rect of an image/video layer. Core draws the frame at
 * `u_contentSize = natural size × contentScale` buffer px shrunk by the crop
 * fractions, and `media-source.frag` centers the *cropped* rect in the frame,
 * so the fraction is natural × (1 − crops) / compSize (clamped: anything past
 * the frame edge is clipped by the FBO). The rect stays centered even for
 * asymmetric crops — cropTop trims the media's visual top, so in GL y-up
 * terms maxY (the on-screen top edge) moves down while minY moves up by the
 * same amount as the shrunken rect re-centers.
 */
/**
 * Uniform contain-fit scale for media display: downscale to fit the comp,
 * never upscale. The media runtime pushes display dimensions scaled by this,
 * and the extent math below applies the same factor so both agree.
 */
export function mediaDisplayFit(
  naturalWidth: number,
  naturalHeight: number,
  comp: { width: number; height: number },
): number {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(comp.width > 0) || !(comp.height > 0)) {
    return 1;
  }
  return Math.min(1, comp.width / naturalWidth, comp.height / naturalHeight);
}

export function mediaContentExtent(
  naturalWidth: number,
  naturalHeight: number,
  compWidth: number,
  compHeight: number,
  crops: MediaCropValues,
): ContentExtent {
  if (
    !(compWidth > 0) ||
    !(compHeight > 0) ||
    !(naturalWidth > 0) ||
    !(naturalHeight > 0)
  ) {
    return FULL_CONTENT_EXTENT;
  }
  // Mirror the frag's `keep` clamp: degenerate crop sums can't go negative.
  const keepX = Math.max(0, 1 - crops.cropLeft - crops.cropRight);
  const keepY = Math.max(0, 1 - crops.cropTop - crops.cropBottom);
  // Same contain-fit the runtime applies when pushing display dimensions.
  const fit = mediaDisplayFit(naturalWidth, naturalHeight, { width: compWidth, height: compHeight });
  const w = clamp01((naturalWidth * fit * keepX) / compWidth);
  const h = clamp01((naturalHeight * fit * keepY) / compHeight);
  if (w >= 1 && h >= 1) return FULL_CONTENT_EXTENT;
  return {
    minX: 0.5 - w / 2,
    minY: 0.5 - h / 2,
    maxX: 0.5 + w / 2,
    maxY: 0.5 + h / 2,
  };
}

/**
 * Layout inputs of core's text rasterizer (TextLayerSpec minus color, which
 * does not affect geometry). Kept in sync with
 * packages/core/src/renderer/text-raster.ts — core does not export it.
 */
export type TextExtentSpec = {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  tracking: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right";
};

/** Mirror of core's `textSpecFromValues` (layout fields only). */
export function textExtentSpecFromValues(values: Record<string, unknown>): TextExtentSpec {
  return {
    content: typeof values.content === "string" ? values.content : "",
    fontFamily: typeof values.fontFamily === "string" ? values.fontFamily : "sans-serif",
    fontSize: typeof values.fontSize === "number" ? values.fontSize : 160,
    fontWeight: typeof values.fontWeight === "number" ? values.fontWeight : 600,
    tracking: typeof values.tracking === "number" ? values.tracking : 0,
    lineHeight: typeof values.lineHeight === "number" ? values.lineHeight : 1.1,
    textAlign:
      values.textAlign === "left" || values.textAlign === "right"
        ? values.textAlign
        : "center",
  };
}

/** Glyph bounds of one line relative to its anchor point (measureText-style). */
export type TextLineMetrics = {
  left: number;
  right: number;
  ascent: number;
  descent: number;
};

export type TextLineMeasurer = (line: string) => TextLineMetrics | null;

/**
 * Content rect of a text layer: replays `drawTextSpec`'s layout (line
 * positions, alignment anchor, padding) at contentScale = 1 — fractions are
 * resolution-independent — and unions the measured glyph boxes. Coordinates
 * come back in layer UV (y up; the raster is y-down, so v flips). Falls back
 * to the full frame when there is nothing to measure.
 */
export function textContentExtent(
  spec: TextExtentSpec,
  compWidth: number,
  compHeight: number,
  measureLine: TextLineMeasurer,
): ContentExtent {
  if (!(compWidth > 0) || !(compHeight > 0) || !spec.content.trim()) {
    return FULL_CONTENT_EXTENT;
  }

  // Same layout constants as drawTextSpec (contentScale = 1).
  const fontPx = Math.max(1, spec.fontSize);
  const lines = spec.content.split("\n");
  const lineStep = fontPx * spec.lineHeight;
  const startY = compHeight / 2 - (lineStep * (lines.length - 1)) / 2;
  const pad = Math.round(fontPx * 0.25);
  const anchorX =
    spec.textAlign === "left" ? pad : spec.textAlign === "right" ? compWidth - pad : compWidth / 2;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const m = measureLine(line);
    if (!m) return FULL_CONTENT_EXTENT;
    const lineY = startY + i * lineStep;
    minX = Math.min(minX, anchorX - m.left);
    maxX = Math.max(maxX, anchorX + m.right);
    minY = Math.min(minY, lineY - m.ascent);
    maxY = Math.max(maxY, lineY + m.descent);
  }

  // Degenerate measurements (all-blank lines, zero boxes) — keep the frame.
  if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) {
    return FULL_CONTENT_EXTENT;
  }

  return {
    minX: clamp01(minX / compWidth),
    maxX: clamp01(maxX / compWidth),
    minY: clamp01(1 - maxY / compHeight),
    maxY: clamp01(1 - minY / compHeight),
  };
}
