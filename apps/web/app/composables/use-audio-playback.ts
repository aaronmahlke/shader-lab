import { onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import { evaluatePropertyTrack, type LayerInstance, type PropertyTrack } from "@shader-lab/core";

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

/** Linear gain at comp time `t` (Volume is in dB, keyframeable). */
function gainAt(layer: LayerInstance, tracks: readonly PropertyTrack[], t: number): number {
  const base = typeof layer.values.volume === "number" ? layer.values.volume : 0;
  const track = tracks.find((tr) => tr.layerId === layer.id && tr.paramName === "volume");
  const db = track?.enabled ? evaluatePropertyTrack(track, t, base) : base;
  return db <= -48 ? 0 : Math.pow(10, db / 20);
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode; layer: LayerInstance };

export function useAudioPlayback(opts: {
  layers: Ref<LayerInstance[]>;
  tracks: Ref<PropertyTrack[]>;
}) {
  let voices: Voice[] = [];
  /** Comp time ↔ context time anchor of the running voices. */
  let anchorT = 0;
  let anchorCtx = 0;
  let missing = false; // a layer's buffer wasn't decoded yet when we started

  // Decode ahead so pressing play is instant.
  watch(
    () => audioLayersOf(opts.layers.value).map((l) => l.values.src as string),
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
    for (const layer of audioLayersOf(opts.layers.value)) {
      const buffer = bufferNow(layer.values.src as string);
      if (!buffer) {
        missing = true;
        continue;
      }
      const inPt = layer.timing?.in ?? 0;
      const outPt = layer.timing?.out ?? Infinity;
      if (t >= outPt) continue;
      const offset = Math.max(0, t - inPt);
      if (offset >= buffer.duration) continue;
      const when = now + Math.max(0, inPt - t);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = gainAt(layer, opts.tracks.value, t);
      source.connect(gain).connect(ctx.destination);
      source.start(when, offset);
      if (Number.isFinite(outPt)) source.stop(when + (outPt - Math.max(t, inPt)));
      voices.push({ source, gain, layer });
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
    if (voices.length === 0 || drift > 0.12 || (missing && audioLayersOf(opts.layers.value).every((l) => bufferNow(l.values.src as string)))) {
      stop();
      start(t);
      return;
    }
    for (const v of voices) v.gain.gain.setTargetAtTime(gainAt(v.layer, opts.tracks.value, t), ctx.currentTime, 0.015);
  }

  // Layer edits while playing (mute, new src, timing): rebuild the voices.
  watch(
    () => audioLayersOf(opts.layers.value).map((l) => `${l.id}:${l.values.src}:${l.timing?.in}:${l.timing?.out}`).join("|"),
    () => {
      if (voices.length) stop();
    },
  );

  onBeforeUnmount(stop);
  return { tick, stop };
}

/**
 * Offline mix of every audio layer for export (stereo, 48 kHz), or null
 * when the comp has no sound.
 */
export async function renderAudioMix(
  layers: readonly LayerInstance[],
  tracks: readonly PropertyTrack[],
  duration: number,
  sampleRate = 48000,
): Promise<AudioBuffer | null> {
  const list = audioLayersOf(layers);
  if (!list.length || duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  let any = false;
  for (const layer of list) {
    const buffer = await decodeAudio(layer.values.src as string);
    if (!buffer) continue;
    const inPt = layer.timing?.in ?? 0;
    const outPt = Math.min(layer.timing?.out ?? duration, duration);
    if (outPt <= Math.max(0, inPt)) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    // Volume automation sampled at 100 Hz (exact for static levels).
    const hasKeys = tracks.some((tr) => tr.layerId === layer.id && tr.paramName === "volume" && tr.enabled);
    gain.gain.setValueAtTime(gainAt(layer, tracks, Math.max(0, inPt)), 0);
    if (hasKeys) {
      for (let t = Math.max(0, inPt); t <= outPt; t += 0.01) gain.gain.linearRampToValueAtTime(gainAt(layer, tracks, t), t);
    }
    source.connect(gain).connect(ctx.destination);
    const when = Math.max(0, inPt);
    source.start(when, Math.max(0, -inPt));
    source.stop(outPt);
    any = true;
  }
  return any ? await ctx.startRendering() : null;
}
