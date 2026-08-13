import type {
  TextExtentSpec,
  TextLineMeasurer,
} from "#shared/editor/layer-content-extent";

/**
 * Canvas-backed line measurement for text content extents. Configures the
 * 2D context exactly like core's `drawTextSpec` (font string, middle
 * baseline, alignment, letterSpacing) at contentScale = 1, so the measured
 * glyph boxes match what the rasterizer draws in composition pixels.
 */

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === "undefined") {
    measureCtx = null;
    return measureCtx;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  measureCtx = canvas.getContext("2d");
  return measureCtx;
}

/** Line measurer for a text spec, or null when no canvas is available (SSR). */
export function createTextLineMeasurer(spec: TextExtentSpec): TextLineMeasurer | null {
  const ctx = getMeasureContext();
  if (!ctx) return null;

  // Mirror drawTextSpec's context setup (contentScale = 1).
  const fontPx = Math.max(1, spec.fontSize);
  ctx.font = `${spec.fontWeight} ${fontPx}px ${spec.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = spec.textAlign;
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${spec.tracking}px`;
  }

  return (line: string) => {
    const m = ctx.measureText(line);
    return {
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
    };
  };
}
