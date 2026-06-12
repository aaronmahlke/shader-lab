import type { ArtworkLayer, ArtworkVideoLayer } from "../types/artwork";

export type ArtworkVideoCache = Map<string, HTMLVideoElement>;

export function isVideoLayer(layer: ArtworkLayer): layer is ArtworkVideoLayer {
  return layer.type === "video";
}

export function videoTimeAt(
  layer: ArtworkVideoLayer,
  video: HTMLVideoElement,
  timeSeconds: number,
): number {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (layer.loop !== false) return timeSeconds % duration;
  return Math.min(Math.max(0, timeSeconds), duration);
}

export function seekVideoElement(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", done);
    video.currentTime = target;
  });
}

/** Seek all enabled video layers for compositing at `timeSeconds`. */
export async function seekVideosAtTime(
  layers: ArtworkLayer[],
  videoCache: ArtworkVideoCache,
  timeSeconds: number,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const layer of layers) {
    if (!layer.enabled || layer.type !== "video" || !layer.src) continue;
    const video = videoCache.get(layer.src);
    if (!video) continue;
    const t = videoTimeAt(layer, video, timeSeconds);
    tasks.push(seekVideoElement(video, t));
  }

  await Promise.all(tasks);
}

/** Pause and seek videos for preview (call before draw; pair with waitForVideoFrame if needed). */
export function syncVideosAtTime(
  layers: ArtworkLayer[],
  videoCache: ArtworkVideoCache,
  timeSeconds: number,
) {
  for (const layer of layers) {
    if (!layer.enabled || layer.type !== "video" || !layer.src) continue;
    const video = videoCache.get(layer.src);
    if (!video) continue;
    video.pause();
    const t = videoTimeAt(layer, video, timeSeconds);
    if (Math.abs(video.currentTime - t) > 0.033) {
      video.currentTime = t;
    }
  }
}

export async function syncVideosAtTimeAndWait(
  layers: ArtworkLayer[],
  videoCache: ArtworkVideoCache,
  timeSeconds: number,
): Promise<void> {
  syncVideosAtTime(layers, videoCache, timeSeconds);
  const waits: Promise<void>[] = [];
  for (const layer of layers) {
    if (!layer.enabled || layer.type !== "video" || !layer.src) continue;
    const video = videoCache.get(layer.src);
    if (video) waits.push(waitForVideoFrame(video));
  }
  await Promise.all(waits);
}

/** Longest enabled video layer duration (seconds), for export duration default. */
export function getMaxCanvasVideoDuration(
  layers: ArtworkLayer[],
  videoCache: ArtworkVideoCache,
): number {
  let max = 0;
  for (const layer of layers) {
    if (!layer.enabled || layer.type !== "video" || !layer.src) continue;
    const video = videoCache.get(layer.src);
    const d = video?.duration;
    if (d && Number.isFinite(d) && d > max) max = d;
  }
  return max;
}

/** Wait until `drawImage(video)` has a decodable frame at the current time. */
export function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("loadeddata", done);
      video.removeEventListener("error", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.addEventListener("loadeddata", done);
    video.addEventListener("error", done);
  });
}

export async function primeVideoElement(video: HTMLVideoElement): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  if (video.readyState < 1) {
    await new Promise<void>((resolve) => {
      const onMeta = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onMeta);
        resolve();
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onMeta);
    });
  }

  await seekVideoElement(video, 0.01);
  await waitForVideoFrame(video);
}

export function loadArtworkVideo(src: string): Promise<HTMLVideoElement | null> {
  if (import.meta.server) return Promise.resolve(null);

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.loop = false;

    const finish = async (el: HTMLVideoElement | null) => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      if (el) await primeVideoElement(el);
      resolve(el);
    };

    const onReady = () => finish(video);
    const onError = () => finish(null);

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError);
    video.src = src;
  });
}
