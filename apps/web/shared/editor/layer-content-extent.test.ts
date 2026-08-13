import { describe, expect, it } from "bun:test";
import {
  FULL_CONTENT_EXTENT,
  componentContentExtent,
  mediaContentExtent,
  mediaDisplayFit, mediaDisplayFit,
  textContentExtent,
  textExtentSpecFromValues,
  type MediaCropValues,
  type TextExtentSpec,
  type TextLineMetrics,
} from "./layer-content-extent";

describe("componentContentExtent", () => {
  it("centers the css size as a fraction of the comp frame", () => {
    // Mirrors core: u_contentSize = css × contentScale inside comp × contentScale,
    // so a 960x540 capture in a 1920x1080 comp covers the middle quarter.
    const e = componentContentExtent(960, 540, 1920, 1080);
    expect(e.minX).toBeCloseTo(0.25);
    expect(e.maxX).toBeCloseTo(0.75);
    expect(e.minY).toBeCloseTo(0.25);
    expect(e.maxY).toBeCloseTo(0.75);
  });

  it("clamps content larger than the frame (FBO clips it)", () => {
    const e = componentContentExtent(4000, 540, 1920, 1080);
    expect(e.minX).toBe(0);
    expect(e.maxX).toBe(1);
    expect(e.minY).toBeCloseTo(0.25);
    expect(e.maxY).toBeCloseTo(0.75);
  });

  it("falls back to the full frame without a valid size", () => {
    expect(componentContentExtent(0, 540, 1920, 1080)).toEqual(FULL_CONTENT_EXTENT);
    expect(componentContentExtent(1920, 1080, 1920, 1080)).toEqual(FULL_CONTENT_EXTENT);
  });
});

const NO_CROP: MediaCropValues = { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 };

describe("mediaContentExtent", () => {
  it("centers the natural size as a fraction of the comp frame", () => {
    // Mirrors core: u_contentSize = natural × contentScale inside comp ×
    // contentScale, so a 960×540 image in a 1920×1080 comp covers the middle quarter.
    const e = mediaContentExtent(960, 540, 1920, 1080, NO_CROP);
    expect(e.minX).toBeCloseTo(0.25);
    expect(e.maxX).toBeCloseTo(0.75);
    expect(e.minY).toBeCloseTo(0.25);
    expect(e.maxY).toBeCloseTo(0.75);
  });

  it("shrinks the displayed rect by the crop fractions", () => {
    // media-source.frag: displayedSize = contentSize × (1 − cropL − cropR, …).
    const e = mediaContentExtent(960, 540, 1920, 1080, {
      ...NO_CROP,
      cropLeft: 0.25,
      cropRight: 0.25,
    });
    // width fraction 0.5 × 0.5 = 0.25, still centered; height untouched.
    expect(e.minX).toBeCloseTo(0.375);
    expect(e.maxX).toBeCloseTo(0.625);
    expect(e.minY).toBeCloseTo(0.25);
    expect(e.maxY).toBeCloseTo(0.75);
  });

  it("cropTop moves the visual top edge (GL y-up maxY) down", () => {
    // The frag centers the cropped rect, so a full-frame 1000×1000 media with
    // cropTop 0.4 keeps h = 0.6 centered: the on-screen top edge (maxY in
    // y-up UV) drops from 1.0 to 0.8 and the bottom edge rises to 0.2.
    const uncropped = mediaContentExtent(1000, 1000, 1000, 1000, NO_CROP);
    const e = mediaContentExtent(1000, 1000, 1000, 1000, { ...NO_CROP, cropTop: 0.4 });
    expect(e.maxY).toBeLessThan(uncropped.maxY);
    expect(e.maxY).toBeCloseTo(0.8);
    expect(e.minY).toBeCloseTo(0.2);
    // Horizontal extent is untouched by vertical crops.
    expect(e.minX).toBe(0);
    expect(e.maxX).toBe(1);
  });

  it("contain-fits media larger than the frame", () => {
    // 4000x540 in 1920x1080: width limits, fit = 0.48 -> 1920x259.2 on screen.
    const e = mediaContentExtent(4000, 540, 1920, 1080, NO_CROP);
    expect(e.minX).toBe(0);
    expect(e.maxX).toBe(1);
    expect(e.maxY - e.minY).toBeCloseTo((540 * (1920 / 4000)) / 1080);
    expect(e.minY + e.maxY).toBeCloseTo(1); // centered
  });

  it("falls back to the full frame without a valid size or when uncropped media fills it", () => {
    expect(mediaContentExtent(0, 540, 1920, 1080, NO_CROP)).toEqual(FULL_CONTENT_EXTENT);
    expect(mediaContentExtent(1920, 1080, 0, 1080, NO_CROP)).toEqual(FULL_CONTENT_EXTENT);
    expect(mediaContentExtent(1920, 1080, 1920, 1080, NO_CROP)).toEqual(FULL_CONTENT_EXTENT);
  });
});

const BASE_SPEC: TextExtentSpec = {
  content: "Hi",
  fontFamily: "sans-serif",
  fontSize: 100,
  fontWeight: 600,
  tracking: 0,
  lineHeight: 1.2,
  textAlign: "center",
};

function fixedMeasure(m: TextLineMetrics) {
  return () => m;
}

describe("textContentExtent", () => {
  it("centers a single line around the frame middle (y flipped to UV)", () => {
    // Anchor at (500, 500); glyph box 200 left/right, 40 up/down in raster px.
    const e = textContentExtent(
      BASE_SPEC,
      1000,
      1000,
      fixedMeasure({ left: 200, right: 200, ascent: 40, descent: 40 }),
    );
    expect(e.minX).toBeCloseTo(0.3);
    expect(e.maxX).toBeCloseTo(0.7);
    expect(e.minY).toBeCloseTo(0.46);
    expect(e.maxY).toBeCloseTo(0.54);
  });

  it("stacks lines by fontSize × lineHeight like drawTextSpec", () => {
    // Two lines, step 120: centers at raster y 440 and 560, each ±40.
    const e = textContentExtent(
      { ...BASE_SPEC, content: "a\nb" },
      1000,
      1000,
      fixedMeasure({ left: 100, right: 100, ascent: 40, descent: 40 }),
    );
    expect(e.minY).toBeCloseTo(1 - 600 / 1000);
    expect(e.maxY).toBeCloseTo(1 - 400 / 1000);
  });

  it("anchors left-aligned text at the rasterizer's padding", () => {
    // pad = round(100 × 0.25) = 25 raster px from the left edge.
    const e = textContentExtent(
      { ...BASE_SPEC, textAlign: "left" },
      1000,
      1000,
      fixedMeasure({ left: 0, right: 400, ascent: 40, descent: 40 }),
    );
    expect(e.minX).toBeCloseTo(0.025);
    expect(e.maxX).toBeCloseTo(0.425);
  });

  it("falls back to the full frame for empty or unmeasurable content", () => {
    const measure = fixedMeasure({ left: 1, right: 1, ascent: 1, descent: 1 });
    expect(textContentExtent({ ...BASE_SPEC, content: "  " }, 1000, 1000, measure)).toEqual(
      FULL_CONTENT_EXTENT,
    );
    expect(textContentExtent(BASE_SPEC, 1000, 1000, () => null)).toEqual(FULL_CONTENT_EXTENT);
  });
});

describe("textExtentSpecFromValues", () => {
  it("mirrors core's defaults for missing values", () => {
    expect(textExtentSpecFromValues({})).toEqual({
      content: "",
      fontFamily: "sans-serif",
      fontSize: 160,
      fontWeight: 600,
      tracking: 0,
      lineHeight: 1.1,
      textAlign: "center",
    });
  });
});

describe("mediaDisplayFit", () => {
  it("downscales large media to contain within the comp", () => {
    // 4000x3000 photo in a 1920x1080 comp: height is the limiting axis.
    expect(mediaDisplayFit(4000, 3000, { width: 1920, height: 1080 })).toBeCloseTo(1080 / 3000);
  });

  it("never upscales small media", () => {
    expect(mediaDisplayFit(640, 360, { width: 1920, height: 1080 })).toBe(1);
  });

  it("extent uses the fitted size", () => {
    // 4000x3000 fitted by 0.36 -> 1440x1080 -> fractions 0.75 x 1.0
    const e = mediaContentExtent(4000, 3000, 1920, 1080, {
      cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
    });
    expect(e.maxX - e.minX).toBeCloseTo(1440 / 1920);
    expect(e.maxY - e.minY).toBeCloseTo(1);
  });
});
