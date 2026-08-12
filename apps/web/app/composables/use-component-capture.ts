import type { ComponentSourceInput, LayerInstance } from "@shader-lab/core";
import { componentNameFromValues } from "@shader-lab/core";
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
  /** Laid-out stage element per layer (null while mounting). */
  getElement: (layerId: string) => HTMLElement | null;
  setComponentSource: (layerId: string, source: ComponentSourceInput | null) => void;
  /** Schedule a re-render after a fresh frame was pushed. */
  requestRender: () => void;
};

export function useComponentCapture(options: ComponentCaptureOptions) {
  const sessions = new Map<string, DomCaptureSession>();
  const pending = new Map<string, Promise<boolean>>();
  const lastCaptureAt = new Map<string, number>();
  const stagedNames = new Map<string, string>();
  let rafId: number | null = null;
  let paused = false;
  let disposed = false;

  function componentLayers(): LayerInstance[] {
    return options.layers.value.filter(
      (layer) => layer.type === "component" && layer.enabled,
    );
  }

  /** Capture one layer; resolves true when a new frame was pushed to the renderer. */
  function captureLayer(layer: LayerInstance): Promise<boolean> {
    const inFlight = pending.get(layer.id);
    if (inFlight) return inFlight;

    const element = options.getElement(layer.id);
    if (!element) return Promise.resolve(false);

    let session = sessions.get(layer.id);
    if (!session) {
      session = new DomCaptureSession();
      sessions.set(layer.id, session);
    }

    const run = session
      .capture(element)
      .then((result) => {
        if (disposed || !result || result === "unchanged") return false;
        options.setComponentSource(layer.id, {
          frame: result.image,
          cssWidth: result.cssWidth,
          cssHeight: result.cssHeight,
        });
        return true;
      })
      .catch(() => false)
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
    const now = performance.now();
    for (const layer of componentLayers()) {
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
  async function captureAll(): Promise<void> {
    const layers = componentLayers();
    await Promise.all(layers.map((layer) => pending.get(layer.id) ?? Promise.resolve(false)));
    await Promise.all(layers.map((layer) => captureLayer(layer)));
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
  });

  return { captureAll, pause, resume };
}
