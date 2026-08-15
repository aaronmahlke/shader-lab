import type { CompositionConfig, LayerInstance, MediaSource } from "@shader-lab/core";
import { mediaDisplayFit } from "#shared/editor/layer-content-extent";
import { TRANSFORM_PARAM_NAMES } from "#shared/editor/layer-transform";
import {
  mediaSrcFromValues,
  NESTED_SEP,
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
/** Max nested-composition depth walked for media (mirrors core's MAX_NESTING_DEPTH). */
const MAX_MEDIA_NESTING_DEPTH = 4;

/**
 * One renderable image/video occurrence. Top-level layers key by their own
 * id; layers inside NESTED composition layers key by the core pass id
 * `host1::host2::layerId` — one instance PER PATH, so a comp nested twice
 * yields two instances (raster images share one element via the pool below;
 * videos get one element per instance because each path has its own clock).
 */
type MediaInstance = {
  /** Pass id the renderer looks the source up under (`setMediaSource` key). */
  key: string;
  layer: LayerInstance;
  /** Sum of host layers' in-points (s): root time − inOffset = local comp time. */
  inOffset: number;
};

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

/**
 * Layers uploaded before the app-served media route store putObject's return
 * value: the raw S3 endpoint URL, which is internal-only in prod and
 * unreachable from the browser. Rewrite any absolute URL carrying an
 * /uploads/ path to /api/media/... so old layers keep rendering.
 */
function normalizeMediaSrc(src: string): string {
  const match = src.match(/^https?:\/\/[^?#]*?\/(uploads\/[^?#]+)/);
  return match ? `/api/media/${match[1]}` : src;
}

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
  /** Registry lookup for nested composition layers (`::`-prefixed pass ids). */
  resolveComposition?: (compId: string) => CompositionConfig | null;
  /** Bumps when a referenced comp arrives; re-scans nested media layers. */
  registryVersion?: Ref<number>;
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

  /**
   * Depth-first walk into enabled composition layers, collecting image/video
   * occurrences under core's prefixed pass ids (`host::layerId`). Depth-capped
   * and cycle-safe per path (a comp may legally appear twice on SIBLING
   * paths, just not on its own ancestry).
   */
  function collectInstances(
    layers: LayerInstance[],
    prefix: string,
    inOffset: number,
    visited: ReadonlySet<string>,
    depth: number,
    out: MediaInstance[],
  ): void {
    for (const layer of layers) {
      if (!layer.enabled) continue;
      if (layer.type === "image" || layer.type === "video") {
        out.push({ key: `${prefix}${layer.id}`, layer, inOffset });
        continue;
      }
      if (layer.type !== "composition" || depth >= MAX_MEDIA_NESTING_DEPTH) continue;
      const compId = layer.values.compRefId;
      if (typeof compId !== "string" || !compId || visited.has(compId)) continue;
      const config = options.resolveComposition?.(compId);
      if (!config) continue;
      collectInstances(
        config.layers,
        `${prefix}${layer.id}${NESTED_SEP}`,
        inOffset + (layer.timing?.in ?? 0),
        new Set([...visited, compId]),
        depth + 1,
        out,
      );
    }
  }

  /** Every enabled image/video occurrence: the open comp's layers plus nested comps'. */
  function mediaInstances(): MediaInstance[] {
    const out: MediaInstance[] = [];
    collectInstances(options.layers.value, "", 0, new Set(), 0, out);
    return out;
  }

  function liveInstance(key: string): MediaInstance | undefined {
    return mediaInstances().find((instance) => instance.key === key);
  }

  /**
   * Media-local time the playhead maps to: playhead minus the nested comps'
   * summed in-points (each nesting level runs on its own clock, clamped so
   * pre-roll holds the first frame), minus the layer in-point, offset by
   * trimStart; loop wraps over the trimmed tail, otherwise the last frame
   * holds (duration − ε keeps the seek inside the stream).
   */
  function videoTargetTime(instance: MediaInstance, duration: number, tSec: number): number {
    const trimStart = videoTrimStartFromValues(instance.layer.values);
    const localComp = Math.max(0, tSec - instance.inOffset);
    const local = Math.max(0, localComp - (instance.layer.timing?.in ?? 0)) + trimStart;
    if (videoLoopFromValues(instance.layer.values) && duration > trimStart) {
      return trimStart + ((local - trimStart) % (duration - trimStart));
    }
    return Math.min(local, Math.max(0, duration - 0.001));
  }

  // --- Shared raster-image pool ------------------------------------------
  // The same image layer can appear under several prefixes (comp nested
  // twice): all keys share one HTMLImageElement per src, refcounted so the
  // last dispose stops the network/decode work. SVGs stay per-key (their
  // raster density is per-instance) and videos per-key (per-instance clock).

  const imagePool = new Map<string, { img: HTMLImageElement; refs: number }>();

  function acquireImage(src: string): HTMLImageElement {
    let pooled = imagePool.get(src);
    if (!pooled) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      pooled = { img, refs: 0 };
      imagePool.set(src, pooled);
    }
    pooled.refs++;
    return pooled.img;
  }

  function releaseImage(src: string): void {
    const pooled = imagePool.get(src);
    if (!pooled) return;
    pooled.refs--;
    if (pooled.refs <= 0) {
      pooled.img.src = "";
      imagePool.delete(src);
    }
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
      mediaInstances()
        .filter((instance) => instance.layer.type === "image")
        .map((instance) => `${instance.key}:${svgTargetDensity(instance.layer)}`)
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
      Math.max(svg.density, svgTargetDensity(liveInstance(layerId)?.layer)),
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
  function loadSvgLayer(instance: MediaInstance, entry: MediaEntry): void {
    const stale = () => disposed || entries.get(instance.key) !== entry;
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
        rasterizeSvg(instance.key, entry);
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

  function loadInstance(instance: MediaInstance): void {
    if (import.meta.server) return;
    const { key, layer } = instance;
    const rawSrc = mediaSrcFromValues(layer.values);
    if (!rawSrc) return; // no source picked yet — the layer renders transparent
    const src = normalizeMediaSrc(rawSrc);

    const entry: MediaEntry = {
      kind: layer.type as "image" | "video",
      src,
      element: null,
      version: 0,
      dispose: () => {},
    };
    entries.set(key, entry);
    const stale = () => disposed || entries.get(key) !== entry;

    if (entry.kind === "image" && isSvgSrc(src)) {
      loadSvgLayer(instance, entry);
      return;
    }

    if (entry.kind === "image") {
      const img = acquireImage(src);
      const onLoad = () => {
        if (stale()) return;
        naturalSizes.set(key, { width: img.naturalWidth, height: img.naturalHeight });
        pushFrame(key, entry, true);
      };
      img.addEventListener("load", onLoad);
      entry.element = img;
      entry.dispose = () => {
        img.removeEventListener("load", onLoad);
        releaseImage(src);
      };
      // Pooled element may already be decoded (same src under another key).
      if (img.complete && img.naturalWidth > 0) onLoad();
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
      naturalSizes.set(key, { width: video.videoWidth, height: video.videoHeight });
      durations.set(key, video.duration);
      // Land on the playhead-mapped frame; `loadeddata`/`seeked` push it.
      const live = liveInstance(key) ?? instance;
      video.currentTime = videoTargetTime(live, video.duration, options.currentTime.value);
    };
    // Live-only frame pushes; exports bump versions themselves in syncForExport.
    const onFrame = () => {
      if (stale() || paused) return;
      pushFrame(key, entry, true);
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
  // same join-key pattern as useComponentCapture. registryVersion is part of
  // the key so nested media registers as soon as its referenced comp arrives
  // (and structural edits inside already-loaded nested comps re-scan too).
  watch(
    () =>
      `${options.registryVersion?.value ?? 0}#` +
      mediaInstances()
        .map(
          (instance) =>
            `${instance.key}:${instance.layer.type}:${mediaSrcFromValues(instance.layer.values)}`,
        )
        .join("|"),
    () => {
      if (disposed) return;
      const active = new Map(mediaInstances().map((instance) => [instance.key, instance]));
      for (const id of [...entries.keys()]) {
        const instance = active.get(id);
        const entry = entries.get(id)!;
        if (
          !instance ||
          instance.layer.type !== entry.kind ||
          normalizeMediaSrc(mediaSrcFromValues(instance.layer.values)) !== entry.src
        ) {
          disposeEntry(id);
        }
      }
      for (const [id, instance] of active) {
        if (!entries.has(id)) loadInstance(instance);
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
    for (const instance of mediaInstances()) {
      if (instance.layer.type !== "video") continue;
      const video = videoElement(entries.get(instance.key));
      if (!video || !(video.duration > 0)) continue;
      const target = videoTargetTime(instance, video.duration, t);
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
    for (const instance of mediaInstances()) {
      if (instance.layer.type !== "video") continue;
      const entry = entries.get(instance.key);
      const video = videoElement(entry);
      if (!video || video.paused) continue;
      if (stalled) {
        video.pause();
        if (video.duration > 0) {
          video.currentTime = videoTargetTime(instance, video.duration, options.currentTime.value);
        }
        continue;
      }
      pushFrame(instance.key, entry!, true);
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
    for (const instance of mediaInstances()) {
      if (instance.layer.type !== "video") continue;
      const entry = entries.get(instance.key);
      const video = videoElement(entry);
      if (!entry || !video) continue;
      video.pause();
      if (!(video.duration > 0)) continue; // metadata still loading → stays transparent
      const target = videoTargetTime(instance, video.duration, tSec);
      jobs.push(
        seekAndWait(video, target).then(() => {
          // Push whatever frame the seek landed on (watchdog path included);
          // the export's own renderFrame call does the actual draw.
          pushFrame(instance.key, entry, false);
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
