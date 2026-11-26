import { onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import { loadFrames, pruneDisk, saveFrame } from "~/utils/frame-cache-disk";

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
  /** Everything that affects rendering (hashed); a new state gets its own cache entry. */
  signature: () => unknown;
  /** Which comp this is (entries are per comp). */
  cacheKey: () => string;
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


/**
 * Cache entries survive editor remounts (HMR, comp switches) in a document-wide
 * store keyed by comp + a content hash of everything that affects rendering:
 * come back to the same state and the frames are still there.
 */
type CacheEntry = { frames: Map<number, ImageBitmap>; bytes: number; usedAt: number };
const MAX_ENTRIES = 8;
function store(): Map<string, CacheEntry> {
  const w = globalThis as unknown as { __shaderlabFrameCache?: Map<string, CacheEntry> };
  return (w.__shaderlabFrameCache ??= new Map());
}

/** FNV-1a over a string (fast, good enough to tell render states apart). */
function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + str.length.toString(36);
}

export function useFrameCache(opts: FrameCacheOptions) {
  let entry: CacheEntry = { frames: new Map(), bytes: 0, usedAt: Date.now() };
  let entryKey = "";
  let frames = entry.frames;
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

  /** Bytes held by cached bitmaps (frames can differ in size after zoom/resize). */
  let bytes = 0;
  const syncBytes = () => {
    entry.bytes = bytes;
  };
  const sizeOf = (b: ImageBitmap) => b.width * b.height * 4;
  const budget = () => opts.budgetBytes ?? 3e9;

  /** Forward distance from the playhead (frames ahead are near, just-behind is farthest). */
  function dist(f: number): number {
    const n = frameCount();
    return (f - frameOf(opts.currentTime.value) + n) % n;
  }

  function clear() {
    generation++;
    for (const bmp of frames.values()) bmp.close();
    frames.clear();
    bytes = 0;
    syncBytes();
    showing.value = false;
    version.value++;
  }

  /** Switch to the entry for this render state (reusing it when it exists). */
  function useEntry(key: string) {
    generation++;
    const all = store();
    let next = all.get(key);
    if (!next) {
      next = { frames: new Map(), bytes: 0, usedAt: Date.now() };
      all.set(key, next);
      // Drop empty states first (transient ones while nested comps load must
      // never push real caches out), then keep the most recently used.
      for (const [k, e] of all) if (e !== next && e !== entry && e.frames.size === 0) all.delete(k);
      const old = [...all.entries()].sort((a, b) => b[1].usedAt - a[1].usedAt).slice(MAX_ENTRIES);
      for (const [k, e] of old) {
        if (e === next) continue;
        for (const bmp of e.frames.values()) bmp.close();
        all.delete(k);
      }
    }
    const fresh = !all.has(key) || next.frames.size === 0;
    next.usedAt = Date.now();
    entry = next;
    entryKey = key;
    frames = entry.frames;
    bytes = entry.bytes;
    showing.value = frames.has(frameOf(opts.currentTime.value));
    version.value++;
    // Not in memory (full reload, long ago): restore this state's frames from disk.
    if (fresh) void restoreFromDisk(key, next);
  }

  async function restoreFromDisk(key: string, target: CacheEntry) {
    const loaded = await loadFrames(key);
    if (!loaded.size) return;
    if (entry !== target) {
      for (const bmp of loaded.values()) bmp.close();
      return;
    }
    for (const [f, bmp] of loaded) {
      if (frames.has(f)) {
        bmp.close();
        continue;
      }
      frames.set(f, bmp);
      bytes += sizeOf(bmp);
      onDisk.add(`${key}|${f}`);
    }
    evict();
    syncBytes();
    showing.value = frames.has(frameOf(opts.currentTime.value));
    version.value++;
  }

  // --- Disk writes: newly rendered frames, in the background, never during playback.
  const onDisk = new Set<string>();
  const diskQueue: { key: string; frame: number; bmp: ImageBitmap }[] = [];
  let diskBusy = false;
  async function flushDisk() {
    if (diskBusy) return;
    diskBusy = true;
    try {
      while (diskQueue.length && !opts.playing.value) {
        const job = diskQueue.shift()!;
        // Evicted (closed) meanwhile: nothing to write.
        if (!job.bmp.width) continue;
        await saveFrame(job.key, job.frame, job.bmp);
        onDisk.add(`${job.key}|${job.frame}`);
      }
    } finally {
      diskBusy = false;
    }
  }
  void pruneDisk();

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



  function get(frame: number): ImageBitmap | undefined {
    return frames.get(frame);
  }

  /** Evict the frames farthest behind the playhead (playback direction) once over budget. */
  /** Over budget: drop the frames farthest from the playhead (just behind it first). */
  function evict(_around?: number) {
    if (bytes <= budget()) return;
    const order = [...frames.keys()].sort((a, b) => dist(b) - dist(a));
    for (const f of order) {
      if (bytes <= budget()) break;
      const b = frames.get(f)!;
      bytes -= sizeOf(b);
      b.close();
      frames.delete(f);
    }
  }

  /** Cache full and every cached frame is nearer than `f`: rendering it would only evict closer frames. */
  function wouldThrash(f: number): boolean {
    if (bytes < budget() * 0.98) return false;
    let farthest = -1;
    for (const k of frames.keys()) farthest = Math.max(farthest, dist(k));
    return farthest <= dist(f);
  }

  /** Next frame to render: first uncached frame at/after the playhead (wrapping). */
  function nextTarget(): number | null {
    const n = frameCount();
    const start = frameOf(opts.currentTime.value);
    for (let i = 0; i < n; i++) {
      const f = (start + i) % n;
      if (!frames.has(f)) return wouldThrash(f) ? null : f;
    }
    return null;
  }

  /** Serializes renders (worker and playback share the one canvas). */
  let chain: Promise<unknown> = Promise.resolve();

  /** Render frame `f` into the cache; false when invalidated meanwhile. */
  function renderInto(f: number, gen = generation): Promise<boolean> {
    const run = chain.then(async () => {
      if (gen !== generation) return false;
      if (frames.has(f)) return true;
      try {
        await opts.renderAt(f / opts.fps());
      } catch (err) {
        console.error("[frame cache] render failed", err);
        return false;
      }
      if (gen !== generation) return false;
      const canvas = opts.getCanvas();
      if (!canvas) return false;
      const bmp = await createImageBitmap(canvas);
      if (gen !== generation) {
        bmp.close();
        return false;
      }
      frames.set(f, bmp);
      bytes += sizeOf(bmp);
      evict();
      syncBytes();
      if (!onDisk.has(`${entryKey}|${f}`)) {
        diskQueue.push({ key: entryKey, frame: f, bmp });
        if (!opts.playing.value) void flushDisk();
      }
      if (frames.has(frameOf(opts.currentTime.value))) showing.value = true;
      version.value++;
      return true;
    });
    chain = run.catch(() => false);
    return run;
  }

  /** Make sure `frame` is cached (renders it now if needed). */
  function ensure(frame: number): Promise<boolean> {
    return frames.has(frame) ? Promise.resolve(true) : renderInto(frame);
  }

  async function work() {
    if (working) return;
    working = true;
    const gen = generation;
    try {
      while (gen === generation) {
        const idleEnough = performance.now() - lastEditAt >= IDLE_DELAY_MS;
        if (!opts.playing.value && !idleEnough) break;
        // Playing: playback renders the frames it needs itself (ensure); a background
        // render would block the main thread and starve the playback clock.
        if (opts.playing.value) break;
        // Background tab: don't spin the fans for frames nobody is looking at.
        if (typeof document !== "undefined" && document.hidden) break;
        const f = nextTarget();
        if (f === null) break;
        if (!(await renderInto(f, gen))) break;
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
    () => opts.cacheKey() + "|" + hashString(JSON.stringify(opts.signature())),
    (key, prev) => {
      if (prev !== undefined) lastEditAt = performance.now();
      useEntry(key);
      if (!showing.value) opts.restoreLive();
      scheduleIdle();
    },
    { immediate: true },
  );

  // Playing: keep rendering ahead. Paused: top up after a short idle.
  watch(opts.playing, (p) => {
    if (!p) void flushDisk();
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
  // Real interaction only — merely moving the mouse over the app must not stall caching.
  const INPUT_EVENTS = ["pointerdown", "wheel", "keydown"] as const;
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
    // Keep the frames (store): a remount (HMR) with the same state picks them up again.
    generation++;
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

  return { has, get, ensure, frameOf, frameCount, showing, buffering, version, ranges, clear, kick: () => void work() };
}
