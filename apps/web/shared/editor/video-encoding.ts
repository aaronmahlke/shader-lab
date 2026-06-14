import type { VideoEncodingConfig } from "mediabunny";

/**
 * H.264 bitrate for canvas exports with film grain / dither.
 * QUALITY_HIGH (~6 Mbps @ 1080p) is too low — noise reads as JPEG-style blocking.
 */
export function canvasVideoEncodingConfig(
  width: number,
  height: number,
  fps: number,
): VideoEncodingConfig {
  const pixels = width * height;
  // ~0.12 bits per pixel per frame at 30fps ≈ 12 Mbps @ 1080p30
  const bpp = fps >= 60 ? 0.14 : 0.12;
  const bitrate = Math.ceil((pixels * fps * bpp) / 1000) * 1000;

  return {
    codec: "avc",
    bitrate: Math.max(bitrate, 10_000_000),
    bitrateMode: "variable",
    latencyMode: "quality",
    contentHint: "detail",
    keyFrameInterval: fps >= 60 ? 2 : 5,
  };
}
