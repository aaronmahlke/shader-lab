import { nextTick } from "vue";
import type { ComponentSourceInput, LayerInstance } from "@shader-lab/core";
import { componentCaptureScaleFromValues, componentNameFromValues } from "@shader-lab/core";
import { DomCaptureSession } from "~/utils/dom-capture";

/**
 * Drives DOM capture for component layers.
 *
 * The renderer is synchronous; capture is not. So capture runs in its own
 * loop, pushes finished frames into the renderer, and requests a redraw when
 * something actually changed (the session dedupes byte-identical markup).
 * Exports call `captureAll` before each frame so the encoded frame never
 * trails the DOM by a tick.
 */

/** Serialization walks the DOM every attempt; ~30 Hz keeps idle cost negligible. */
const CAPTURE_MIN_INTERVAL_MS = 33;

type ComponentCaptureOptions = {
  layers: Ref<LayerInstance[]>;
  /** Apply pointer hover/press to the staged DOM for a time (live: now). */
  samplePointer?: (time?: number) => void;
  /** Laid-out stage element per layer (null while mounting). */
  getElement: (layerId: string) => HTMLElement | null;
  setComponentSource: (layerId: string, source: ComponentSourceInput | null) => void;
  /** Schedule a re-render after a fresh frame was pushed. */
  requestRender: () => void;
  /**
   * Is the layer on screen at `time` (default: now)? Off-screen components
   * aren't captured — DOM capture is the most expensive thing per frame.
   */
  isActive?: (layerId: string, time?: number) => boolean;
  /**
   * What the last rendered frame needed from this layer's capture (the
   * renderer's on-screen scale incl. camera zoom + precomp scales, and the
   * visible part). Drives zoom-aware capture; omitted = fixed captureScale.
   */
  view?: (layerId: string) => { scale: number; rect: [number, number, number, number] | null } | null;
};

/** Capture scales snap to these (fewer re-rasters while a zoom animates). */
const SCALE_BUCKETS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
/** Longest side of a capture in px (texture memory stays bounded at any zoom). */
const MAX_CAPTURE_PX = 8192;
/** Snap grid for capture rects (element-relative): small pans reuse the same rect. */
const RECT_GRID = 1 / 32;

type CaptureView = { scale: number; rect: [number, number, number, number] | null };

/** Bucketed scale for a need (manual captureScale is the floor). */
function wantedScale(manual: number, need: CaptureView | null): number {
  const demand = need?.scale ?? 0;
  return Math.max(manual, SCALE_BUCKETS.find((b) => b >= demand * 0.97) ?? SCALE_BUCKETS[SCALE_BUCKETS.length - 1]!);
}

/** The capture to take for a needed view: bucketed scale, padded snapped rect, size-capped. */
function planCapture(manual: number, need: CaptureView | null, css: { w: number; h: number } | null): CaptureView {
  let scale = wantedScale(manual, need);
  let rect: CaptureView["rect"] = null;
  if (need?.rect) {
    const [x, y, w, h] = need.rect;
    const padX = Math.max(w * 0.15, RECT_GRID);
    const padY = Math.max(h * 0.15, RECT_GRID);
    const x0 = Math.max(0, Math.floor((x - padX) / RECT_GRID) * RECT_GRID);
    const y0 = Math.max(0, Math.floor((y - padY) / RECT_GRID) * RECT_GRID);
    const x1 = Math.min(1, Math.ceil((x + w + padX) / RECT_GRID) * RECT_GRID);
    const y1 = Math.min(1, Math.ceil((y + h + padY) / RECT_GRID) * RECT_GRID);
    if (x1 - x0 < 0.9 || y1 - y0 < 0.9) rect = [x0, y0, x1 - x0, y1 - y0];
  }
  if (css) {
    const longest = Math.max(css.w * (rect?.[2] ?? 1), css.h * (rect?.[3] ?? 1));
    if (longest * scale > MAX_CAPTURE_PX) scale = Math.max(0.5, MAX_CAPTURE_PX / longest);
  }
  return { scale, rect };
}

/** Does a capture serve a needed view (scale high enough or at its size cap, rect covers what's visible)? */
function serves(have: CaptureView | undefined, need: CaptureView | null, manual: number, cappedAt?: number): boolean {
  if (!have) return false;
  if (!need) return true;
  const want = wantedScale(manual, need);
  if (have.scale + 1e-6 < want && !(cappedAt != null && have.scale + 1e-6 >= cappedAt)) return false;
  if (!have.rect) return true;
  if (!need.rect) return false;
  const [hx, hy, hw, hh] = have.rect;
  const [nx, ny, nw, nh] = need.rect;
  return nx >= hx - 1e-6 && ny >= hy - 1e-6 && nx + nw <= hx + hw + 1e-6 && ny + nh <= hy + hh + 1e-6;
}

export function useComponentCapture(options: ComponentCaptureOptions) {
  const sessions = new Map<string, DomCaptureSession>();
  const sessionScales = new Map<string, number>();
  const pending = new Map<string, Promise<boolean>>();
  const lastCaptureAt = new Map<string, number>();
  const stagedNames = new Map<string, string>();
  /**
   * Latest captured layout size (CSS px) per layer. Reactive so gizmos and
   * hit-tests can derive the content extent the shader actually draws
   * (content-source centers the frame at this size inside the comp frame).
   */
  const contentSizes = reactive(new Map<string, { cssWidth: number; cssHeight: number }>());
  let rafId: number | null = null;
  let paused = false;
  let disposed = false;

  function componentLayers(): LayerInstance[] {
    return options.layers.value.filter(
      (layer) => layer.type === "component" && layer.enabled,
    );
  }

  /** Layers whose frame is currently held by the renderer (texture on the GPU). */
  const pushed = new Set<string>();
  /** Last capture error per layer (cleared on success). */
  const failures = new Map<string, unknown>();
  /** What each layer's current frame holds (scale + rect). */
  const captured = new Map<string, CaptureView>();
  /** Scale a capture was limited to by MAX_CAPTURE_PX (asking for more is pointless). */
  const capped = new Map<string, number>();

  /** Free a layer's frame + GPU texture (it's off screen); re-captured when it returns. */
  function release(layerId: string) {
    if (!pushed.has(layerId)) return;
    pushed.delete(layerId);
    captured.delete(layerId);
    options.setComponentSource(layerId, null);
    sessions.get(layerId)?.reset();
  }

  /** Capture one layer; resolves true when a new frame was pushed to the renderer. */
  function captureLayer(layer: LayerInstance): Promise<boolean> {
    const inFlight = pending.get(layer.id);
    if (inFlight) return inFlight;

    const element = options.getElement(layer.id);
    if (!element) return Promise.resolve(false);

    // Resolution = capture pixels per CSS px; raise it for components shown zoomed in.
    const scale = componentCaptureScaleFromValues(layer.values);
    let session = sessions.get(layer.id);
    if (!session || sessionScales.get(layer.id) !== scale) {
      session = new DomCaptureSession({ scale });
      sessions.set(layer.id, session);
      sessionScales.set(layer.id, scale);
    }

    const known = contentSizes.get(layer.id);
    const need = options.view?.(layer.id) ?? null;
    const plan = planCapture(scale, need, known ? { w: known.cssWidth, h: known.cssHeight } : null);
    const run = session
      .capture(element, plan)
      .then((result) => {
        failures.delete(layer.id);
        if (disposed || !result || result === "unchanged") return false;
        pushed.add(layer.id);
        captured.set(layer.id, { scale: result.scale ?? plan.scale, rect: result.rect ?? null });
        if (plan.scale + 1e-6 < wantedScale(scale, need)) capped.set(layer.id, plan.scale);
        else capped.delete(layer.id);
        options.setComponentSource(layer.id, {
          rect: result.rect ?? null,
          frame: result.image,
          cssWidth: result.cssWidth,
          cssHeight: result.cssHeight,
        });
        const size = contentSizes.get(layer.id);
        if (!size || size.cssWidth !== result.cssWidth || size.cssHeight !== result.cssHeight) {
          contentSizes.set(layer.id, {
            cssWidth: result.cssWidth,
            cssHeight: result.cssHeight,
          });
        }
        return true;
      })
      .catch((err) => {
        failures.set(layer.id, err);
        console.warn(`[component capture] ${layer.name ?? layer.id} failed`, err);
        return false;
      })
      .finally(() => {
        pending.delete(layer.id);
        lastCaptureAt.set(layer.id, performance.now());
      });

    pending.set(layer.id, run);
    return run;
  }

  function tick(): void {
    rafId = requestAnimationFrame(tick);
    if (paused) return;
    options.samplePointer?.();
    const now = performance.now();
    for (const layer of componentLayers()) {
      if (options.isActive && !options.isActive(layer.id)) continue;
      if (pending.has(layer.id)) continue;
      if (now - (lastCaptureAt.get(layer.id) ?? 0) < CAPTURE_MIN_INTERVAL_MS) continue;
      void captureLayer(layer).then((updated) => {
        if (updated && !disposed) options.requestRender();
      });
    }
  }

  /**
   * Fresh capture of every staged layer, awaited. Waits out in-flight captures
   * first so an export frame never races the live loop.
   */
  async function captureAll(time?: number): Promise<void> {
    const all = componentLayers();
    const layers = all.filter((l) => !options.isActive || options.isActive(l.id, time));
    // Off-screen layers give their frames back: a comp with many full-size
    // components otherwise piles up GPU textures / decoded images until
    // captures start failing (exports froze mid-way, at a random time).
    const active = new Set(layers.map((l) => l.id));
    for (const l of all) if (!active.has(l.id)) release(l.id);
    await Promise.all(layers.map((layer) => pending.get(layer.id) ?? Promise.resolve(false)));
    if (options.samplePointer) {
      options.samplePointer(time);
      await nextTick(); // let JS-driven (stagepointerstate) visuals re-render
    }
    await Promise.all(layers.map((layer) => captureLayer(layer)));
    // Failed captures: retry once (memory pressure clears up), then fail loudly.
    const failed = layers.filter((l) => failures.has(l.id));
    if (failed.length) {
      await new Promise((r) => setTimeout(r, 60));
      for (const l of failed) sessions.get(l.id)?.reset();
      await Promise.all(failed.map((layer) => captureLayer(layer)));
      const still = failed.filter((l) => failures.has(l.id));
      if (still.length) {
        const names = still.map((l) => l.name ?? l.id).join(", ");
        throw new Error(`Component capture failed${time != null ? ` at ${time.toFixed(3)}s` : ""}: ${names}`);
      }
    }
  }

  /**
   * After rendering a frame: do the captures hold what it needed (zoom-aware
   * scale and visible rect)? Exports re-capture + re-render once when not.
   */
  function viewsSatisfied(time?: number): boolean {
    if (!options.view) return true;
    for (const layer of componentLayers()) {
      if (options.isActive && !options.isActive(layer.id, time)) continue;
      const need = options.view(layer.id);
      if (!need) continue;
      if (!serves(captured.get(layer.id), need, componentCaptureScaleFromValues(layer.values), capped.get(layer.id))) return false;
    }
    return true;
  }

  /** Stop the live loop (exports drive capture explicitly per frame). */
  function pause(): void {
    paused = true;
  }

  function resume(): void {
    paused = false;
  }

  // Free renderer sources for removed/disabled layers; reset the dedupe cache
  // when a layer stages a different component so the next capture always lands.
  watch(
    () =>
      options.layers.value
        .filter((layer) => layer.type === "component")
        .map((layer) => `${layer.id}:${layer.enabled ? 1 : 0}:${componentNameFromValues(layer.values)}`)
        .join("|"),
    () => {
      const active = new Map(
        componentLayers().map((layer) => [layer.id, componentNameFromValues(layer.values)]),
      );
      for (const id of [...sessions.keys()]) {
        if (!active.has(id)) {
          sessions.delete(id);
          stagedNames.delete(id);
          lastCaptureAt.delete(id);
          contentSizes.delete(id);
          options.setComponentSource(id, null);
        }
      }
      for (const [id, name] of active) {
        const previous = stagedNames.get(id);
        if (previous !== undefined && previous !== name) {
          sessions.get(id)?.reset();
          lastCaptureAt.delete(id);
        }
        stagedNames.set(id, name);
      }
    },
  );

  onMounted(() => {
    if (!import.meta.server && rafId === null) tick();
  });

  onBeforeUnmount(() => {
    disposed = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const id of sessions.keys()) {
      options.setComponentSource(id, null);
    }
    sessions.clear();
    pending.clear();
    contentSizes.clear();
  });

  return { captureAll, viewsSatisfied, pause, resume, contentSizes };
}
