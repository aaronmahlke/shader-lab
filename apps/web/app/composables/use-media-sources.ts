import type { LayerInstance, MediaSource } from "@shader-lab/core";
import { mediaDisplayFit } from "#shared/editor/layer-content-extent";
import { TRANSFORM_PARAM_NAMES } from "#shared/editor/layer-transform";
import {
  mediaSrcFromValues,
  videoLoopFromValues,
  videoTrimStartFromValues,
} from "@shader-lab/core";

/**
 * Host-side media runtime for image/video layers.
 *
 * Core never fetches or decodes media: this composable loads `values.src`
 * into an <img>/<video> element per layer and pushes frames into the renderer
 * via `setMediaSource` (uploads happen only when `version` changes).
 *
 * Video time is OWNED BY THE PLAYHEAD, not the element: the editor's
 * `currentTime` maps to a media-local time (in-point, trimStart, loop) and the
 * element follows it. Live playback lets the element decode on its own clock
 * (smooth) with drift correction; scrubs hard-seek; exports seek exactly and
 * await `seeked` so every encoded frame is deterministic.
 */

/** Forward playhead deltas below this are continuous playback; anything else is a scrub/jump. */
const PLAYBACK_DELTA_MAX_S = 0.25;
/** Drift tolerance before playback hard-seeks the element back to the playhead. */
const PLAYBACK_DRIFT_MAX_S = 0.3;
/** A stalled playhead pauses the element after this long (editor paused / scrub ended). */
const PLAYHEAD_STALL_MS = 300;
/** Export seeks resolve on `seeked` or after this watchdog, so a stalled decoder can't hang the export. */
const EXPORT_SEEK_TIMEOUT_MS = 400;
/** Hard cap on either dimension of an SVG raster (texture-size safety). */
const SVG_MAX_RASTER_DIM = 4096;

/** Vector state for SVG image layers, re-rasterized when comp size or layer scale demands it. */
type SvgState = {
  /** Decoded SVG document, drawn into `canvas` at arbitrary sizes losslessly. */
  image: HTMLImageElement;
  /** Intrinsic (or viewBox-derived) size, used only for the aspect ratio. */
  width: number;
  height: number;
  /** The raster the renderer samples; entry.element points at it once drawn. */
  canvas: HTMLCanvasElement;
  /** Raster px per display px (supersampling for scaled-up layers). Only grows. */
  density: number;
};

type MediaEntry = {
  kind: "image" | "video";
  src: string;
  element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null;
  /** Set for SVG sources: element is the raster canvas, not the <img>. */
  svg?: SvgState;
  /** Upload dedupe: bumps on every frame push. */
  version: number;
  /** Remove listeners and stop the element's network/decode work. */
  dispose: () => void;
};

/** Whether an image src points at an SVG document (query/hash stripped). */
function isSvgSrc(src: string): boolean {
  const path = src.split(/[?#]/, 1)[0] ?? src;
  return /\.svg$/i.test(path);
}

/**
 * Size an SVG document declares: width/height attributes when both are plain
 * numbers (or px), else the viewBox. Browsers disagree on `naturalWidth` for
 * attribute-less SVGs, so this parse is the single source of truth.
 */
function svgDocumentSize(text: string): { width: number; height: number } | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== "svg") return null;
  const attrPx = (name: string): number | null => {
    const raw = root.getAttribute(name)?.trim();
    if (!raw || !/^\d*\.?\d+(px)?$/.test(raw)) return null;
    const value = Number.parseFloat(raw);
    return value > 0 ? value : null;
  };
  const width = attrPx("width");
  const height = attrPx("height");
  if (width !== null && height !== null) return { width, height };
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { width: viewBox[2]!, height: viewBox[3]! };
  }
  return null;
}

type MediaSourcesOptions = {
  layers: Ref<LayerInstance[]>;
  setMediaSource: (layerId: string, source: MediaSource | null) => void;
  /** Schedule a re-render after a fresh frame was pushed. */
  requestRender: () => void;
  /** Playhead in seconds; video elements follow it. */
  currentTime: Ref<number>;
  /** Composition size; media is displayed contain-fitted to it (never upscaled). */
  compSize: () => { width: number; height: number };
};

export function useMediaSources(options: MediaSourcesOptions) {
  const entries = new Map<string, MediaEntry>();
  /**
   * Natural media size (px) per layer, reactive so gizmos and hit-tests can
   * derive the content extent the shader draws (media-source centers the
   * frame at this size, shrunk by crops). Like componentCapture.contentSizes.
   */
  const naturalSizes = reactive(new Map<string, { width: number; height: number }>());
  /** Video duration in seconds per layer, known after loadedmetadata. */
  const durations = reactive(new Map<string, number>());
  let rafId: number | null = null;
  let paused = false;
  let disposed = false;
  let lastPlayheadMoveAt = 0;
  let lastSyncedPlayhead: number | null = null;

  function mediaLayers(): LayerInstance[] {
    return options.layers.value.filter(
      (layer) => (layer.type === "image" || layer.type === "video") && layer.enabled,
    );
  }

  function liveLayer(layerId: string): LayerInstance | undefined {
    return options.layers.value.find((layer) => layer.id === layerId);
  }

  /**
   * Media-local time the playhead maps to: playhead minus the layer in-point,
   * offset by trimStart; loop wraps over the trimmed tail, otherwise the last
   * frame holds (duration − ε keeps the seek inside the stream).
   */
  function videoTargetTime(layer: LayerInstance, duration: number, tSec: number): number {
    const trimStart = videoTrimStartFromValues(layer.values);
    const local = Math.max(0, tSec - (layer.timing?.in ?? 0)) + trimStart;
    if (videoLoopFromValues(layer.values) && duration > trimStart) {
      return trimStart + ((local - trimStart) % (duration - trimStart));
    }
    return Math.min(local, Math.max(0, duration - 0.001));
  }

  /** Push the element's current frame; `render` schedules a live redraw (exports render explicitly). */
  function pushFrame(layerId: string, entry: MediaEntry, render: boolean): void {
    if (disposed || !entry.element) return;
    let width: number;
    let height: number;
    if (entry.element instanceof HTMLVideoElement) {
      // Need a decoded frame; uploading a metadata-only element is undefined.
      if (entry.element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      width = entry.element.videoWidth;
      height = entry.element.videoHeight;
    } else if (entry.element instanceof HTMLCanvasElement) {
      // SVG raster: already sized to the comp times a density factor.
      width = entry.element.width;
      height = entry.element.height;
    } else {
      width = entry.element.naturalWidth;
      height = entry.element.naturalHeight;
    }
    if (!(width > 0) || !(height > 0)) return;
    // Contain-fit: a 4K photo in a 1080p comp should show whole, not a
    // zoomed-in center crop. Downscale to fit the comp, never upscale small
    // media (they stay at natural pixel size and the user scales via the
    // transform). Must match mediaContentExtent's fit so gizmos stay honest.
    const fit = mediaDisplayFit(width, height, options.compSize());
    options.setMediaSource(layerId, {
      source: entry.element,
      width: width * fit,
      height: height * fit,
      version: ++entry.version,
    });
    if (render) options.requestRender();
  }

  // Comp resize changes the fitted display size: re-push current frames with
  // fresh dimensions (same version, so no texture re-upload for images).
  // SVGs re-rasterize instead so the vector stays crisp at the new fit.
  watch(
    () => {
      const c = options.compSize();
      return `${c.width}x${c.height}`;
    },
    () => {
      for (const [layerId, entry] of entries) {
        if (entry.svg) rasterizeSvg(layerId, entry);
        else if (entry.element) pushFrame(layerId, entry, true);
      }
    },
  );

  // Scaling an SVG layer up may need a denser raster; join-key over transform
  // scale so gestures only re-rasterize when the rounded target size grows.
  watch(
    () =>
      options.layers.value
        .filter((layer) => layer.type === "image" && layer.enabled)
        .map((layer) => `${layer.id}:${svgTargetDensity(layer)}`)
        .join("|"),
    () => {
      for (const [layerId, entry] of entries) {
        if (entry.svg) rasterizeSvg(layerId, entry);
      }
    },
  );

  /** Raster px per display px the layer's transform scale asks for (>= 1). */
  function svgTargetDensity(layer: LayerInstance | undefined): number {
    const scale = layer?.values[TRANSFORM_PARAM_NAMES.scale];
    return Math.max(1, (typeof scale === "number" ? scale : 100) / 100);
  }

  /**
   * Draw the SVG contain-fitted to the comp times a density factor covering
   * the layer's scale, so scaled-up vectors stay crisp. Unlike raster media,
   * the fit may exceed 1: upscaling a vector is lossless, so small SVGs fill
   * the comp instead of staying icon-sized. Density only grows (no churn
   * while a scale gesture moves down) and the raster is capped at
   * SVG_MAX_RASTER_DIM per side.
   */
  function rasterizeSvg(layerId: string, entry: MediaEntry, render = true): void {
    const svg = entry.svg;
    if (!svg) return;
    const comp = options.compSize();
    if (!(comp.width > 0) || !(comp.height > 0)) return;
    const fit = Math.min(comp.width / svg.width, comp.height / svg.height);
    const maxDensity = SVG_MAX_RASTER_DIM / Math.max(1, svg.width * fit, svg.height * fit);
    const density = Math.min(
      Math.max(svg.density, svgTargetDensity(liveLayer(layerId))),
      Math.max(1, maxDensity),
    );
    const width = Math.max(1, Math.round(svg.width * fit * density));
    const height = Math.max(1, Math.round(svg.height * fit * density));
    if (entry.element === svg.canvas && svg.canvas.width === width && svg.canvas.height === height) {
      return; // raster already current
    }
    svg.canvas.width = width;
    svg.canvas.height = height;
    const ctx = svg.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(svg.image, 0, 0, width, height);
    svg.density = density;
    entry.element = svg.canvas;
    // The raster is the layer's natural size: extent math applies the same
    // mediaDisplayFit, so the density factor cancels and gizmos stay honest.
    naturalSizes.set(layerId, { width, height });
    pushFrame(layerId, entry, render);
  }

  /**
   * SVG image path: fetch the document (size attributes are the source of
   * truth), decode it via a same-origin blob URL, then rasterize on demand.
   */
  function loadSvgLayer(layer: LayerInstance, entry: MediaEntry): void {
    const stale = () => disposed || entries.get(layer.id) !== entry;
    const img = new Image();
    let blobUrl = "";
    const onLoad = () => {
      if (stale()) return;
      pendingSize.then((size) => {
        if (stale()) return;
        entry.svg = {
          image: img,
          width: Math.max(1, size?.width ?? options.compSize().width),
          height: Math.max(1, size?.height ?? options.compSize().height),
          canvas: document.createElement("canvas"),
          density: 0,
        };
        rasterizeSvg(layer.id, entry);
      }).catch(() => {});
    };
    entry.dispose = () => {
      img.removeEventListener("load", onLoad);
      img.src = "";
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    let resolveSize: (size: { width: number; height: number } | null) => void;
    const pendingSize = new Promise<{ width: number; height: number } | null>((resolve) => {
      resolveSize = resolve;
    });
    void fetch(entry.src, { mode: "cors" })
      .then((response) => response.text())
      .then((text) => {
        if (stale()) return;
        resolveSize(svgDocumentSize(text));
        blobUrl = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
        img.addEventListener("load", onLoad);
        img.src = blobUrl;
      })
      .catch(() => {
        // Unreachable/invalid SVG: layer stays transparent, same as a broken raster src.
      });
  }

  function disposeEntry(layerId: string): void {
    const entry = entries.get(layerId);
    if (!entry) return;
    entry.dispose();
    entries.delete(layerId);
    naturalSizes.delete(layerId);
    durations.delete(layerId);
    options.setMediaSource(layerId, null);
  }

  function loadLayer(layer: LayerInstance): void {
    if (import.meta.server) return;
    const src = mediaSrcFromValues(layer.values);
    if (!src) return; // no source picked yet — the layer renders transparent

    const entry: MediaEntry = {
      kind: layer.type as "image" | "video",
      src,
      element: null,
      version: 0,
      dispose: () => {},
    };
    entries.set(layer.id, entry);
    const stale = () => disposed || entries.get(layer.id) !== entry;

    if (entry.kind === "image" && isSvgSrc(src)) {
      loadSvgLayer(layer, entry);
      return;
    }

    if (entry.kind === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const onLoad = () => {
        if (stale()) return;
        naturalSizes.set(layer.id, { width: img.naturalWidth, height: img.naturalHeight });
        pushFrame(layer.id, entry, true);
      };
      img.addEventListener("load", onLoad);
      entry.element = img;
      entry.dispose = () => {
        img.removeEventListener("load", onLoad);
        img.src = "";
      };
      img.src = src;
      return;
    }

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // The playhead owns time (trim + loop mapping); native looping would fight it.
    video.loop = false;
    const onMeta = () => {
      if (stale()) return;
      naturalSizes.set(layer.id, { width: video.videoWidth, height: video.videoHeight });
      durations.set(layer.id, video.duration);
      // Land on the playhead-mapped frame; `loadeddata`/`seeked` push it.
      const live = liveLayer(layer.id) ?? layer;
      video.currentTime = videoTargetTime(live, video.duration, options.currentTime.value);
    };
    // Live-only frame pushes; exports bump versions themselves in syncForExport.
    const onFrame = () => {
      if (stale() || paused) return;
      pushFrame(layer.id, entry, true);
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", onFrame);
    video.addEventListener("seeked", onFrame);
    video.addEventListener("timeupdate", onFrame);
    entry.element = video;
    entry.dispose = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", onFrame);
      video.removeEventListener("seeked", onFrame);
      video.removeEventListener("timeupdate", onFrame);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    video.src = src;
  }

  function videoElement(entry: MediaEntry | undefined): HTMLVideoElement | null {
    return entry?.element instanceof HTMLVideoElement ? entry.element : null;
  }

  // Reload on src change, free renderer sources for removed/disabled layers —
  // same join-key pattern as useComponentCapture.
  watch(
    () =>
      options.layers.value
        .filter((layer) => layer.type === "image" || layer.type === "video")
        .map(
          (layer) =>
            `${layer.id}:${layer.enabled ? 1 : 0}:${layer.type}:${mediaSrcFromValues(layer.values)}`,
        )
        .join("|"),
    () => {
      if (disposed) return;
      const active = new Map(mediaLayers().map((layer) => [layer.id, layer]));
      for (const id of [...entries.keys()]) {
        const layer = active.get(id);
        const entry = entries.get(id)!;
        if (!layer || layer.type !== entry.kind || mediaSrcFromValues(layer.values) !== entry.src) {
          disposeEntry(id);
        }
      }
      for (const [id, layer] of active) {
        if (!entries.has(id)) loadLayer(layer);
      }
    },
    { immediate: true },
  );

  // Live playhead sync. Small forward deltas are playback: the element plays
  // on its own clock (smooth decode) and only hard-seeks past the drift
  // tolerance. Jumps and backward moves are scrubs: pause + exact seek.
  watch(options.currentTime, (t) => {
    lastPlayheadMoveAt = performance.now();
    const delta = lastSyncedPlayhead === null ? Number.POSITIVE_INFINITY : t - lastSyncedPlayhead;
    lastSyncedPlayhead = t;
    if (paused || disposed) return; // exports drive media explicitly
    const isPlayback = delta > 0 && delta < PLAYBACK_DELTA_MAX_S;
    for (const layer of mediaLayers()) {
      if (layer.type !== "video") continue;
      const video = videoElement(entries.get(layer.id));
      if (!video || !(video.duration > 0)) continue;
      const target = videoTargetTime(layer, video.duration, t);
      if (isPlayback) {
        if (Math.abs(video.currentTime - target) > PLAYBACK_DRIFT_MAX_S) {
          video.currentTime = target; // drift or loop wrap
        }
        // ended clears on the seek above, so loop restarts play here next tick.
        if (video.paused && !video.ended) void video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = target;
      }
    }
  });

  // Per-frame texture upload while a video plays — timeupdate alone is ~4 Hz.
  // Also freezes elements once the playhead stalls (editor paused, scrub end).
  function tick(): void {
    rafId = requestAnimationFrame(tick);
    if (paused || disposed) return;
    const stalled = performance.now() - lastPlayheadMoveAt > PLAYHEAD_STALL_MS;
    for (const layer of mediaLayers()) {
      if (layer.type !== "video") continue;
      const entry = entries.get(layer.id);
      const video = videoElement(entry);
      if (!video || video.paused) continue;
      if (stalled) {
        video.pause();
        if (video.duration > 0) {
          video.currentTime = videoTargetTime(layer, video.duration, options.currentTime.value);
        }
        continue;
      }
      pushFrame(layer.id, entry!, true);
    }
  }

  /** Seek and wait for the decoded frame; the watchdog keeps a stalled decoder from hanging exports. */
  function seekAndWait(video: HTMLVideoElement, target: number): Promise<void> {
    return new Promise((resolve) => {
      // Seeking to the current position may not fire `seeked` at all.
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Math.abs(video.currentTime - target) < 1e-4
      ) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        video.removeEventListener("seeked", finish);
        resolve();
      };
      const watchdog = setTimeout(finish, EXPORT_SEEK_TIMEOUT_MS);
      video.addEventListener("seeked", finish);
      try {
        video.currentTime = target;
      } catch {
        finish();
      }
    });
  }

  /**
   * Export-exact sync: pause every video, seek it to the frame time's mapped
   * media time, await `seeked` (400 ms watchdog) and re-push the frame so the
   * next renderFrame uploads exactly that frame. Images are already static.
   */
  async function syncForExport(tSec: number): Promise<void> {
    if (disposed) return;
    const jobs: Promise<void>[] = [];
    for (const layer of mediaLayers()) {
      if (layer.type !== "video") continue;
      const entry = entries.get(layer.id);
      const video = videoElement(entry);
      if (!entry || !video) continue;
      video.pause();
      if (!(video.duration > 0)) continue; // metadata still loading → stays transparent
      const target = videoTargetTime(layer, video.duration, tSec);
      jobs.push(
        seekAndWait(video, target).then(() => {
          // Push whatever frame the seek landed on (watchdog path included);
          // the export's own renderFrame call does the actual draw.
          pushFrame(layer.id, entry, false);
        }),
      );
    }
    await Promise.all(jobs);
  }

  /** Stop live playback and version bumps (exports drive media explicitly per frame). */
  function pause(): void {
    paused = true;
    for (const entry of entries.values()) {
      if (entry.element instanceof HTMLVideoElement) entry.element.pause();
    }
  }

  function resume(): void {
    paused = false;
    // The restored playhead is a jump, never playback.
    lastSyncedPlayhead = null;
  }

  onMounted(() => {
    if (!import.meta.server && rafId === null) tick();
  });

  onBeforeUnmount(() => {
    disposed = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const id of [...entries.keys()]) {
      const entry = entries.get(id)!;
      entry.dispose();
      entries.delete(id);
      options.setMediaSource(id, null);
    }
    naturalSizes.clear();
    durations.clear();
  });

  return { syncForExport, pause, resume, naturalSizes, durations };
}
