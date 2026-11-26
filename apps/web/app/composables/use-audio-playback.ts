import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import { applyCompProps, evaluatePropertyTrack, type CompositionConfig, type LayerInstance, type PropertyTrack } from "@shader-lab/core";

/**
 * Audio layers: decode, play in sync with the timeline, mix for export.
 *
 * Like AE's preview: sound plays while playback runs in real time (cached
 * frames) and goes quiet while playback steps frame by frame through
 * uncached ones, rejoining in sync as soon as it's real time again.
 * A layer's sound starts at its in point (source time = comp time − in).
 */

let sharedCtx: AudioContext | null = null;
function audioContext(): AudioContext {
  sharedCtx ??= new AudioContext({ latencyHint: "interactive" });
  return sharedCtx;
}

/** Decoded buffers by src (AudioBuffers work in any context, offline included). */
const decoded = new Map<string, Promise<AudioBuffer | null>>();
export function decodeAudio(src: string): Promise<AudioBuffer | null> {
  let p = decoded.get(src);
  if (!p) {
    p = fetch(src)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => audioContext().decodeAudioData(data))
      .catch((err) => {
        console.warn("[audio] can't decode", src, err);
        decoded.delete(src);
        return null;
      });
    decoded.set(src, p);
  }
  return p;
}
const ready = new Map<string, AudioBuffer>();
function bufferNow(src: string): AudioBuffer | null {
  const hit = ready.get(src);
  if (hit) return hit;
  void decodeAudio(src).then((b) => b && ready.set(src, b));
  return null;
}

/**
 * Waveform peaks for the timeline: per bucket the max |sample| over all
 * channels, `PEAKS_PER_SECOND` buckets per second of source. Reactive via
 * `peaksVersion` (bumped when a decode finishes).
 */
export const PEAKS_PER_SECOND = 200;
export const peaksVersion = shallowRef(0);
const peaks = new Map<string, Float32Array>();
export function waveformPeaks(src: string): Float32Array | null {
  const hit = peaks.get(src);
  if (hit) return hit;
  if (!peaks.has(src)) {
    peaks.set(src, null as unknown as Float32Array); // pending marker
    void decodeAudio(src).then((buffer) => {
      if (!buffer) {
        peaks.delete(src);
        return;
      }
      const per = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SECOND));
      const n = Math.ceil(buffer.length / per);
      const out = new Float32Array(n);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let b = 0; b < n; b++) {
          let m = out[b]!;
          const end = Math.min(data.length, (b + 1) * per);
          for (let i = b * per; i < end; i++) {
            const v = data[i]! < 0 ? -data[i]! : data[i]!;
            if (v > m) m = v;
          }
          out[b] = m;
        }
      }
      peaks.set(src, out);
      peaksVersion.value++;
    });
  }
  return null;
}

export function audioLayersOf(layers: readonly LayerInstance[]): LayerInstance[] {
  return layers.filter((l) => l.type === "audio" && l.enabled && typeof l.values.src === "string" && l.values.src);
}

/**
 * One sound to play: an audio layer of the open comp or of a nested comp.
 * `offset` = comp time where its comp's 0 is (sum of host in points);
 * [from, to) = when it's audible in comp time (its own in/out, cut to every
 * host precomp's window). Volume keys are read on the sound's own comp clock.
 */
export type AudioEntry = {
  key: string;
  layer: LayerInstance;
  tracks: readonly PropertyTrack[];
  offset: number;
  from: number;
  to: number;
};

type Resolve = ((compId: string) => CompositionConfig | null | undefined) | undefined;

export function collectAudio(
  layers: readonly LayerInstance[],
  tracks: readonly PropertyTrack[],
  resolve: Resolve,
  prefix = "",
  offset = 0,
  win: [number, number] = [-Infinity, Infinity],
  visited: ReadonlySet<string> = new Set(),
  depth = 0,
): AudioEntry[] {
  const out: AudioEntry[] = [];
  for (const layer of layers) {
    if (!layer.enabled) continue;
    const a = offset + (layer.timing?.in ?? 0);
    const b = offset + (layer.timing?.out ?? Infinity);
    const from = Math.max(win[0], layer.timing?.in != null ? a : -Infinity);
    const to = Math.min(win[1], b);
    if (layer.type === "audio" && typeof layer.values.src === "string" && layer.values.src) {
      if (to > from) out.push({ key: `${prefix}${layer.id}`, layer, tracks, offset, from: Math.max(from, a), to });
      continue;
    }
    if (layer.type !== "composition" || depth >= 4 || !resolve) continue;
    const compId = typeof layer.values.compRefId === "string" ? layer.values.compRefId : "";
    if (!compId || visited.has(compId)) continue;
    const nested = resolve(compId);
    if (!nested) continue;
    const cfg = applyCompProps(nested, layer);
    out.push(
      ...collectAudio(cfg.layers, cfg.tracks ?? [], resolve, `${prefix}${layer.id}::`, a, [from, to], new Set([...visited, compId]), depth + 1),
    );
  }
  return out;
}

/** Linear gain at time `t` on the layer's own comp clock (Volume is in dB, keyframeable). */
function gainAt(layer: LayerInstance, tracks: readonly PropertyTrack[], t: number): number {
  const base = typeof layer.values.volume === "number" ? layer.values.volume : 0;
  const track = tracks.find((tr) => tr.layerId === layer.id && tr.paramName === "volume");
  const db = track?.enabled ? evaluatePropertyTrack(track, t, base) : base;
  return db <= -48 ? 0 : Math.pow(10, db / 20);
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode; entry: AudioEntry };

export function useAudioPlayback(opts: {
  layers: Ref<LayerInstance[]>;
  tracks: Ref<PropertyTrack[]>;
  resolveComposition?: (compId: string) => CompositionConfig | null | undefined;
  /** Bumps when nested comps load/change (re-collects sounds). */
  registryVersion?: Ref<number>;
}) {
  let voices: Voice[] = [];
  /** Comp time ↔ context time anchor of the running voices. */
  let anchorT = 0;
  let anchorCtx = 0;
  let missing = false; // a layer's buffer wasn't decoded yet when we started

  const entries = computed(() => {
    void opts.registryVersion?.value;
    return collectAudio(opts.layers.value, opts.tracks.value, opts.resolveComposition);
  });

  // Decode ahead so pressing play is instant.
  watch(
    () => entries.value.map((e) => e.layer.values.src as string),
    (srcs) => srcs.forEach((s) => bufferNow(s)),
    { immediate: true },
  );

  function stop() {
    for (const v of voices) {
      try {
        v.source.stop();
      } catch {}
      v.source.disconnect();
      v.gain.disconnect();
    }
    voices = [];
  }

  function start(t: number) {
    const ctx = audioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.01;
    anchorT = t;
    anchorCtx = now;
    missing = false;
    for (const entry of entries.value) {
      const buffer = bufferNow(entry.layer.values.src as string);
      if (!buffer) {
        missing = true;
        continue;
      }
      if (t >= entry.to) continue;
      const begin = Math.max(t, entry.from);
      // Source time: the sound starts at its layer's in point.
      const srcAt = begin - (entry.offset + (entry.layer.timing?.in ?? 0));
      if (srcAt >= buffer.duration) continue;
      const when = now + (begin - t);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = gainAt(entry.layer, entry.tracks, begin - entry.offset);
      source.connect(gain).connect(ctx.destination);
      source.start(when, Math.max(0, srcAt));
      if (Number.isFinite(entry.to)) source.stop(when + (entry.to - begin));
      voices.push({ source, gain, entry });
    }
  }

  /**
   * Call every playback tick. `realtime`: frames are coming at real speed
   * (cached). Restarts on drift (seek, loop wrap, stepping) and keeps gains
   * following the Volume keys.
   */
  function tick(t: number, realtime: boolean) {
    if (!realtime) {
      stop();
      return;
    }
    const ctx = audioContext();
    const expected = anchorT + (ctx.currentTime - anchorCtx);
    const drift = Math.abs(expected - t);
    if (voices.length === 0 || drift > 0.12 || (missing && entries.value.every((e) => bufferNow(e.layer.values.src as string)))) {
      stop();
      start(t);
      return;
    }
    for (const v of voices) {
      v.gain.gain.setTargetAtTime(gainAt(v.entry.layer, v.entry.tracks, t - v.entry.offset), ctx.currentTime, 0.015);
    }
  }

  // Sound edits while playing (mute, new src, timing, nested changes): rebuild the voices.
  watch(
    () => entries.value.map((e) => `${e.key}:${e.layer.values.src}:${e.from}:${e.to}`).join("|"),
    () => {
      if (voices.length) stop();
    },
  );

  onBeforeUnmount(stop);
  return { tick, stop };
}

/**
 * Offline mix of every sound (open comp + nested comps) for export (stereo,
 * 48 kHz), or null when the comp has no sound.
 */
export async function renderAudioMix(
  layers: readonly LayerInstance[],
  tracks: readonly PropertyTrack[],
  duration: number,
  resolveComposition?: (compId: string) => CompositionConfig | null | undefined,
  sampleRate = 48000,
): Promise<AudioBuffer | null> {
  const list = collectAudio(layers, tracks, resolveComposition);
  if (!list.length || duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  let any = false;
  for (const e of list) {
    const buffer = await decodeAudio(e.layer.values.src as string);
    if (!buffer) continue;
    const from = Math.max(0, e.from);
    const to = Math.min(e.to, duration);
    if (to <= from) continue;
    const srcAt = from - (e.offset + (e.layer.timing?.in ?? 0));
    if (srcAt >= buffer.duration) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    // Volume automation sampled at 100 Hz (exact for static levels).
    const hasKeys = e.tracks.some((tr) => tr.layerId === e.layer.id && tr.paramName === "volume" && tr.enabled);
    gain.gain.setValueAtTime(gainAt(e.layer, e.tracks, from - e.offset), from);
    if (hasKeys) {
      for (let t = from; t <= to; t += 0.01) gain.gain.linearRampToValueAtTime(gainAt(e.layer, e.tracks, t - e.offset), t);
    }
    source.connect(gain).connect(ctx.destination);
    source.start(from, Math.max(0, srcAt));
    source.stop(to);
    any = true;
  }
  return any ? await ctx.startRendering() : null;
}
