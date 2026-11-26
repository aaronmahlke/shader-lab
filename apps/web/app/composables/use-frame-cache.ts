import { onBeforeUnmount, shallowRef, watch, type Ref } from "vue";

/**
 * RAM preview (AE-style): rendered frames are kept as ImageBitmaps so playback
 * and scrubbing over already-rendered frames cost nothing.
 *
 * - A background worker renders frames ahead of the playhead whenever the
 *   editor is playing, or idle for a moment after the last edit.
 * - Playback only advances onto cached frames: when the next frame isn't
 *   ready it waits (buffers) instead of stuttering through live renders.
 * - Any edit (layers, keys, settings, nested comps, canvas size) clears it.
 *
 * Rendering happens in the editor's own WebGL canvas; while the cache is
 * "showing" a 2D overlay canvas displays cached frames on top, so the
 * worker's off-playhead renders are never visible.
 */

type FrameCacheOptions = {
  fps: () => number;
  duration: () => number;
  /** Deep-watched; any change invalidates every cached frame. */
  signature: () => unknown;
  /** The renderer's canvas (frames are captured from it). */
  getCanvas: () => HTMLCanvasElement | null;
  /** Render exactly `time` into the canvas (components captured, motion blur…). */
  renderAt: (time: number) => Promise<void>;
  /** Called when the worker stops: put the live state back on the playhead. */
  restoreLive: () => void;
  playing: Ref<boolean>;
  currentTime: Ref<number>;
  /** Byte budget for cached bitmaps (RGBA). */
  budgetBytes?: number;
};

const IDLE_DELAY_MS = 400;
/** While paused, only top up this far ahead of the playhead (no endless background burn). */
const IDLE_AHEAD_SEC = 5;
/** Playback buffers this far ahead (or to the end) before it (re)starts playing. */
const PLAY_BUFFER_SEC = 3;

export function useFrameCache(opts: FrameCacheOptions) {
  const frames = new Map<number, ImageBitmap>();
  /** Bumped when the set of cached frames changes (timeline bar, overlay). */
  const version = shallowRef(0);
  /** True while the overlay shows cached frames instead of the live canvas. */
  const showing = shallowRef(false);
  /** Playback is waiting for the next frame to render. */
  const buffering = shallowRef(false);

  let generation = 0;
  let working = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEditAt = performance.now();

  const frameCount = () => Math.max(1, Math.floor(opts.duration() * opts.fps()));
  const frameOf = (t: number) => Math.min(frameCount() - 1, Math.max(0, Math.round(t * opts.fps())));

  function capacity(): number {
    const c = opts.getCanvas();
    const bytes = Math.max(1, (c?.width ?? 1920) * (c?.height ?? 1080) * 4);
    return Math.max(30, Math.floor((opts.budgetBytes ?? 1.5e9) / bytes));
  }

  function clear() {
    generation++;
    for (const bmp of frames.values()) bmp.close();
    frames.clear();
    showing.value = false;
    version.value++;
  }

  function has(frame: number) {
    return frames.has(frame);
  }

  /** Consecutive cached frames from `frame` on (wrapping at the end). */
  function bufferedFrom(frame: number): number {
    const n = frameCount();
    let k = 0;
    while (k < n && frames.has((frame + k) % n)) k++;
    return k;
  }

  /** Enough is buffered to play smoothly: PLAY_BUFFER_SEC ahead, the whole loop, or a full cache. */
  function readyToPlay(frame: number): boolean {
    const want = Math.min(frameCount(), Math.ceil(PLAY_BUFFER_SEC * opts.fps()), capacity() - 1);
    return bufferedFrom(frame) >= want;
  }

  function get(frame: number): ImageBitmap | undefined {
    return frames.get(frame);
  }

  /** Evict the frames farthest behind the playhead (playback direction) once over budget. */
  function evict(around: number) {
    const cap = capacity();
    if (frames.size <= cap) return;
    const n = frameCount();
    const dist = (f: number) => (f - around + n) % n; // forward distance from the playhead
    const order = [...frames.keys()].sort((a, b) => dist(b) - dist(a));
    for (const f of order.slice(0, frames.size - cap)) {
      frames.get(f)?.close();
      frames.delete(f);
    }
  }

  /** Next frame to render: first uncached frame at/after the playhead (wrapping). */
  function nextTarget(): number | null {
    const n = frameCount();
    const start = frameOf(opts.currentTime.value);
    const ahead = opts.playing.value ? n : Math.ceil(IDLE_AHEAD_SEC * opts.fps());
    const limit = Math.min(n, capacity(), ahead);
    for (let i = 0; i < limit; i++) {
      const f = (start + i) % n;
      if (!frames.has(f)) return f;
    }
    return null;
  }

  async function work() {
    if (working) return;
    working = true;
    const gen = generation;
    try {
      while (gen === generation) {
        const idleEnough = performance.now() - lastEditAt >= IDLE_DELAY_MS;
        if (!opts.playing.value && !idleEnough) break;
        // Playing from cache: never render (a render blocks the main thread for
        // 100 ms+ and starves playback). Only fill while playback is buffering.
        if (opts.playing.value && !buffering.value) break;
        // Background tab: don't spin the fans for frames nobody is looking at.
        if (typeof document !== "undefined" && document.hidden) break;
        const f = nextTarget();
        if (f === null) break;
        // The playhead's frame first, so the overlay can take over immediately.
        await opts.renderAt(f / opts.fps());
        if (gen !== generation) break;
        const canvas = opts.getCanvas();
        if (!canvas) break;
        const bmp = await createImageBitmap(canvas);
        if (gen !== generation) {
          bmp.close();
          break;
        }
        frames.set(f, bmp);
        evict(frameOf(opts.currentTime.value));
        if (frames.has(frameOf(opts.currentTime.value))) showing.value = true;
        version.value++;
        // Yield so playback ticks, input and the overlay get a turn.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      working = false;
      if (!showing.value) opts.restoreLive();
    }
  }

  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void work();
    }, IDLE_DELAY_MS);
  }

  watch(
    opts.signature,
    () => {
      lastEditAt = performance.now();
      clear();
      opts.restoreLive();
      scheduleIdle();
    },
    { deep: true },
  );

  // Playing: keep rendering ahead. Paused: top up after a short idle.
  watch(opts.playing, (p) => {
    if (p) void work();
    else scheduleIdle();
  });

  // The overlay follows the playhead: cached → overlay, uncached → live canvas.
  watch(
    () => [opts.currentTime.value, version.value] as const,
    () => {
      showing.value = frames.has(frameOf(opts.currentTime.value));
      if (!opts.playing.value) scheduleIdle();
    },
  );

  // Any input pauses idle pre-rendering (it runs on the main thread) until the
  // user has been still for a moment — editing always wins over caching.
  const onInput = () => {
    if (opts.playing.value) return;
    lastEditAt = performance.now();
    scheduleIdle();
  };
  const INPUT_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown"] as const;
  if (typeof window !== "undefined") {
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true, capture: true });
  }

  const onVisibility = () => {
    if (!document.hidden) scheduleIdle();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  onBeforeUnmount(() => {
    if (idleTimer) clearTimeout(idleTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") {
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, { capture: true });
    }
    clear();
  });

  /** Cached spans as [startSec, endSec] pairs (timeline bar). */
  function ranges(): [number, number][] {
    void version.value;
    const fps = opts.fps();
    const sorted = [...frames.keys()].sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (const f of sorted) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - f / fps) < 0.5 / fps) last[1] = (f + 1) / fps;
      else out.push([f / fps, (f + 1) / fps]);
    }
    return out;
  }

  return { has, get, frameOf, readyToPlay, showing, buffering, version, ranges, clear, kick: () => void work() };
}
