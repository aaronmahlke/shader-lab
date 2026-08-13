import type { VideoEncodingConfig, VideoCodec } from "mediabunny";
import { canEncodeVideo } from "mediabunny";

/**
 * H.264 bitrate for canvas exports with film grain / dither.
 * QUALITY_HIGH (~6 Mbps @ 1080p) is too low — noise reads as JPEG-style blocking.
 */
export function canvasVideoEncodingConfig(
  width: number,
  height: number,
  fps: number,
  codec: VideoCodec = "avc",
): VideoEncodingConfig {
  const pixels = width * height;
  // ~0.12 bits per pixel per frame at 30fps ≈ 12 Mbps @ 1080p30
  const bpp = fps >= 60 ? 0.14 : 0.12;
  const bitrate = Math.ceil((pixels * fps * bpp) / 1000) * 1000;

  return {
    codec,
    bitrate: Math.max(bitrate, 10_000_000),
    bitrateMode: "variable",
    latencyMode: "quality",
    contentHint: "detail",
    keyFrameInterval: fps >= 60 ? 2 : 5,
  };
}

export type NegotiatedEncoding = {
  config: VideoEncodingConfig;
  /** Container to mux into. */
  container: "mp4" | "webm";
  extension: "mp4" | "webm";
  mimeType: "video/mp4" | "video/webm";
  codec: VideoCodec;
};

/**
 * Pick the first codec this browser can actually encode at the requested
 * size/fps. H.264 levels top out around 4K in most browsers, so large exports
 * (e.g. 4x scale = 8K) fall back to VP9 (WebM) and then AV1, both of which
 * support 8K. Throws a user-readable error when nothing fits.
 */
export async function negotiateCanvasEncoding(
  width: number,
  height: number,
  fps: number,
): Promise<NegotiatedEncoding> {
  const candidates: Array<{ codec: VideoCodec; container: "mp4" | "webm" }> = [
    { codec: "avc", container: "mp4" }, // plays anywhere
    { codec: "vp9", container: "webm" }, // 8K-capable, small files
    { codec: "av1", container: "mp4" }, // 8K-capable, best quality/bit
  ];

  for (const candidate of candidates) {
    const config = canvasVideoEncodingConfig(width, height, fps, candidate.codec);
    const supported = await canEncodeVideo(candidate.codec, {
      width,
      height,
      bitrate: config.bitrate as number,
    }).catch(() => false);
    if (supported) {
      return {
        config,
        container: candidate.container,
        extension: candidate.container === "webm" ? "webm" : "mp4",
        mimeType: candidate.container === "webm" ? "video/webm" : "video/mp4",
        codec: candidate.codec,
      };
    }
  }

  throw new Error(
    `This browser cannot encode video at ${width}x${height}. Try a smaller export scale.`,
  );
}
