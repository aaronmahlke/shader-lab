import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import type { AudioEffect } from "#shared/editor/audio-effects";
import { buildFxChain, duckCurve, type DuckCurves, type FxAutomation } from "~/utils/audio-fx";
import { triggerHits } from "~/utils/audio-triggers";
import { stageCuesVersion } from "~/composables/use-stage-cues";
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

/** A precomp a sound sits in (its group bus), outermost first. */
export type AudioHost = {
  key: string;
  layer: LayerInstance;
  /** The comp the host layer lives in: its tracks + where that comp's 0 is. */
  tracks: readonly PropertyTrack[];
  offset: number;
};

/**
 * One sound to play: an audio layer of the open comp or of a nested comp.
 * `offset` = comp time where its comp's 0 is (sum of host in points);
 * [from, to) = when it's audible in comp time (its own in/out, cut to every
 * host precomp's window). Volume / pan keys are read on the sound's own comp
 * clock; `hosts` are its group buses (precomps).
 */
export type AudioEntry = {
  key: string;
  layer: LayerInstance;
  tracks: readonly PropertyTrack[];
  offset: number;
  from: number;
  to: number;
  hosts: AudioHost[];
  /** Comp time where the source's 0 plays. */
  start: number;
  /** Mixer strip (trigger hits share their layer's strip). */
  strip: string;
  /** Source override (trigger round-robin). */
  src: string;
  /** Playback rate (pitch); 1 = as recorded. */
  rate: number;
  /** Extra gain for this voice (trigger jitter). */
  gainDb: number;
  /** Fade the voice out to silence by this comp time (trigger fit-to-move). */
  fadeOutAt?: number;
};

/** What trigger expansion needs (anchors read decoded buffers). */
export type AudioEnv = {
  frame: { width: number; height: number };
  buffers: (src: string) => AudioBuffer | null;
  settings?: CompositionConfig["settings"];
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
  hosts: AudioHost[] = [],
  env?: AudioEnv,
): AudioEntry[] {
  const out: AudioEntry[] = [];
  for (const layer of layers) {
    if (!layer.enabled) continue;
    const a = offset + (layer.timing?.in ?? 0);
    const b = offset + (layer.timing?.out ?? Infinity);
    const from = Math.max(win[0], layer.timing?.in != null ? a : -Infinity);
    const to = Math.min(win[1], b);
    if (layer.type === "audio" && typeof layer.values.src === "string" && layer.values.src) {
      const key = `${prefix}${layer.id}`;
      if (layer.trigger && env && resolve) {
        // One voice per picture event (press, motion peak, cue…), anchored.
        const hits = triggerHits(layer, { layers, tracks, settings: env.settings }, { prefix, resolveComposition: resolve, frame: env.frame, buffers: env.buffers });
        hits.forEach((h, i) => {
          const start = offset + h.start;
          const buf = env.buffers(h.src);
          const natural = buf ? start + buf.duration / h.rate : Infinity;
          const hitTo = Math.min(win[1], b, natural, h.fadeOutAt != null ? offset + h.fadeOutAt + 0.02 : Infinity);
          const hitFrom = Math.max(win[0], start);
          if (hitTo > hitFrom) {
            out.push({
              key: `${key}#${i}`, strip: key, layer, tracks, offset, from: hitFrom, to: hitTo, hosts, start,
              src: h.src, rate: h.rate, gainDb: h.gainDb, fadeOutAt: h.fadeOutAt != null ? offset + h.fadeOutAt : undefined,
            });
          }
        });
        continue;
      }
      if (to > from) {
        out.push({ key, strip: key, layer, tracks, offset, from: Math.max(from, a), to, hosts, start: a, src: layer.values.src, rate: 1, gainDb: 0 });
      }
      continue;
    }
    if (layer.type !== "composition" || depth >= 4 || !resolve) continue;
    const compId = typeof layer.values.compRefId === "string" ? layer.values.compRefId : "";
    if (!compId || visited.has(compId)) continue;
    const nested = resolve(compId);
    if (!nested) continue;
    const cfg = applyCompProps(nested, layer);
    const host: AudioHost = { key: `${prefix}${layer.id}`, layer, tracks, offset };
    out.push(
      ...collectAudio(cfg.layers, cfg.tracks ?? [], resolve, `${prefix}${layer.id}::`, a, [from, to], new Set([...visited, compId]), depth + 1, [...hosts, host], env ? { ...env, settings: cfg.settings } : undefined),
    );
  }
  return out;
}

/** A param at time `t` on the layer's own comp clock (keys or static value). */
function paramAt(layer: LayerInstance, tracks: readonly PropertyTrack[], name: string, t: number, fallback: number): number {
  const base = typeof layer.values[name] === "number" ? (layer.values[name] as number) : fallback;
  const track = tracks.find((tr) => tr.layerId === layer.id && tr.paramName === name);
  return track?.enabled ? evaluatePropertyTrack(track, t, base) : base;
}
const dbToGain = (db: number) => (db <= -48 ? 0 : Math.pow(10, db / 20));
const hasKeys = (layer: LayerInstance, tracks: readonly PropertyTrack[], name: string) =>
  tracks.some((tr) => tr.layerId === layer.id && tr.paramName === name && tr.enabled && tr.keys.length > 0);

/** Mute / solo (Ableton rules): solo anywhere → only soloed sounds or groups play. */
function audible(e: AudioEntry, anySolo: boolean): boolean {
  if (e.layer.audioMuted || e.hosts.some((h) => h.layer.audioMuted)) return false;
  if (!anySolo) return true;
  return !!e.layer.audioSolo || e.hosts.some((h) => h.layer.audioSolo);
}
const anySoloIn = (entries: readonly AudioEntry[]) => entries.some((e) => e.layer.audioSolo || e.hosts.some((h) => h.layer.audioSolo));

type Strip = { gain: GainNode; pan: StereoPannerNode; meter: AnalyserNode };

type MixSettings = {
  masterVolume: number;
  masterEffects?: AudioEffect[];
  /** Root comp tracks (master fx automation lives on layer id "master"). */
  rootTracks: readonly PropertyTrack[];
  duration: number;
};

/**
 * Duck curves for every duck effect in the mix: the trigger is an audio
 * layer or a precomp (all sounds inside) of the owner's comp; the curve
 * follows their real level. Needs the trigger buffers decoded.
 */
function duckCurvesFor(entries: readonly AudioEntry[], mix: MixSettings, buffers: (src: string) => AudioBuffer | null): DuckCurves {
  const curves: DuckCurves = new Map();
  const owners: { prefix: string; effects?: AudioEffect[] }[] = [{ prefix: "", effects: mix.masterEffects }];
  const seen = new Set<string>();
  for (const e of entries) {
    const p = e.strip.slice(0, e.strip.length - e.layer.id.length);
    if (!seen.has(e.strip)) owners.push({ prefix: p, effects: e.layer.audioEffects as AudioEffect[] | undefined });
    seen.add(e.strip);
    for (const h of e.hosts) {
      if (seen.has(h.key)) continue;
      seen.add(h.key);
      owners.push({ prefix: h.key.slice(0, h.key.length - h.layer.id.length), effects: h.layer.audioEffects as AudioEffect[] | undefined });
    }
  }
  for (const o of owners) {
    for (const fx of o.effects ?? []) {
      if (fx.type !== "duck" || fx.enabled === false || !fx.source) continue;
      const src = `${o.prefix}${fx.source}`;
      const triggers = entries
        .filter((t) => t.strip === src || t.strip.startsWith(`${src}::`))
        .map((t) => ({ buffer: buffers(t.src), start: t.start, from: t.from, to: t.to }))
        .filter((t): t is { buffer: AudioBuffer; start: number; from: number; to: number } => !!t.buffer);
      if (!triggers.length) continue;
      const par = (n: string, d: number) => fx.params[n] ?? d;
      curves.set(fx.id, duckCurve(triggers, { amount: par("amount", 9), threshold: par("threshold", -30), attack: par("attack", 5), release: par("release", 200) }, mix.duration));
    }
  }
  return curves;
}

/**
 * The mix graph: sound → pan → effects → fader → its precomp buses (pan,
 * effects, fader) → master effects → master fader → out. Same graph for
 * live playback and the offline export mix.
 */
function buildGraph(ctx: BaseAudioContext, entries: readonly AudioEntry[], mix: MixSettings, ducks: DuckCurves) {
  const sum = ctx.createGain();
  const master = ctx.createGain();
  master.gain.value = dbToGain(mix.masterVolume);
  const masterMeter = ctx.createAnalyser();
  masterMeter.fftSize = 1024;
  const autos: FxAutomation[] = buildFxChain(ctx, mix.masterEffects, { id: "master", tracks: mix.rootTracks, offset: 0 }, sum, master, ducks);
  master.connect(masterMeter);
  masterMeter.connect(ctx.destination);
  const strips = new Map<string, Strip>();
  const strip = (key: string, to: AudioNode, owner: { layer: LayerInstance; tracks: readonly PropertyTrack[]; offset: number }): Strip => {
    let st = strips.get(key);
    if (!st) {
      const pan = ctx.createStereoPanner();
      const gain = ctx.createGain();
      const meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      autos.push(
        ...buildFxChain(ctx, owner.layer.audioEffects as AudioEffect[] | undefined, { id: owner.layer.id, tracks: owner.tracks, offset: owner.offset }, pan, gain, ducks),
      );
      gain.connect(meter).connect(to);
      st = { gain, pan, meter };
      strips.set(key, st);
    }
    return st;
  };
  /** Input node for a sound: its strip, routed through its group buses. */
  const inputFor = (e: AudioEntry): Strip => {
    // Outer → inner: each group's input feeds the level above it.
    let parent: AudioNode = sum;
    for (const h of e.hosts) parent = strip(h.key, parent, h).pan;
    return strip(e.strip, parent, e);
  };
  // Every strip up front: their effect automations must exist before the
  // caller schedules them (they used to appear lazily, after scheduling).
  for (const e of entries) inputFor(e);
  return { master, masterMeter, strips, inputFor, autos };
}

/**
 * Per-voice gain: trigger jitter + fades. `at(compTime)` maps comp time to
 * the context's clock (live: offset from now; offline: comp time itself).
 */
function voiceGain(ctx: BaseAudioContext, e: AudioEntry, at: (compTime: number) => number): GainNode {
  const g = ctx.createGain();
  const level = dbToGain(e.gainDb);
  g.gain.setValueAtTime(level, Math.max(0, at(e.from)));
  if (e.fadeOutAt != null) {
    const end = at(e.fadeOutAt);
    g.gain.setValueAtTime(level, Math.max(0, end - 0.06));
    g.gain.linearRampToValueAtTime(0, Math.max(0, end));
  }
  return g;
}

type Voice = { source: AudioBufferSourceNode; entry: AudioEntry };

export function useAudioPlayback(opts: {
  layers: Ref<LayerInstance[]>;
  tracks: Ref<PropertyTrack[]>;
  resolveComposition?: (compId: string) => CompositionConfig | null | undefined;
  /** Bumps when nested comps load/change (re-collects sounds). */
  registryVersion?: Ref<number>;
  /** Master level in dB (comp settings). */
  masterVolume?: () => number;
  /** Master effect chain (comp settings). */
  masterEffects?: () => AudioEffect[] | undefined;
  /** Comp length (duck curves span it). */
  duration?: () => number;
  /** Comp size (motion speeds for trigger events). */
  frame?: () => { width: number; height: number };
  /** Comp settings (markers for trigger events). */
  settings?: () => CompositionConfig["settings"];
}) {
  let voices: Voice[] = [];
  let graph: ReturnType<typeof buildGraph> | null = null;
  /** Comp time ↔ context time anchor of the running voices. */
  let anchorT = 0;
  let anchorCtx = 0;
  let missing = false; // a layer's buffer wasn't decoded yet when we started

  /** Bumps when a decode finishes (trigger anchors need buffers). */
  const decodedVersion = shallowRef(0);
  const entries = computed(() => {
    void opts.registryVersion?.value;
    void decodedVersion.value;
    void stageCuesVersion.value;
    return collectAudio(opts.layers.value, opts.tracks.value, opts.resolveComposition, "", 0, [-Infinity, Infinity], new Set(), 0, [], {
      frame: opts.frame?.() ?? { width: 1920, height: 1080 },
      buffers: (src) => ready.get(src) ?? null,
      settings: opts.settings?.(),
    });
  });

  /** Peak level per strip key (+ "master") in dB while playing; -Infinity when silent. */
  const meters = shallowRef<Record<string, number>>({});
  let meterRaf: number | null = null;
  const scratch = new Float32Array(1024);
  const peakDb = (a: AnalyserNode) => {
    a.getFloatTimeDomainData(scratch);
    let m = 0;
    for (let i = 0; i < scratch.length; i++) m = Math.max(m, Math.abs(scratch[i]!));
    return m > 0 ? 20 * Math.log10(m) : -Infinity;
  };
  function meterLoop() {
    meterRaf = null;
    if (!graph) {
      meters.value = {};
      return;
    }
    const next: Record<string, number> = { master: peakDb(graph.masterMeter) };
    for (const [k, st] of graph.strips) next[k] = peakDb(st.meter);
    meters.value = next;
    meterRaf = requestAnimationFrame(meterLoop);
  }

  // Decode ahead so pressing play is instant.
  watch(
    () => [
      ...new Set(
        opts.layers.value.flatMap((l) => (l.type === "audio" ? [l.values.src as string, ...(((l.trigger as { alternates?: string[] } | undefined)?.alternates) ?? [])] : [])).concat(entries.value.map((e) => e.src)),
      ),
    ].filter(Boolean),
    (srcs) =>
      srcs.forEach((s) => {
        if (!ready.has(s)) void decodeAudio(s).then((b) => b && (ready.set(s, b), decodedVersion.value++));
      }),
    { immediate: true },
  );

  function stop() {
    for (const v of voices) {
      try {
        v.source.stop();
      } catch {}
      v.source.disconnect();
    }
    voices = [];
    if (graph) {
      graph.master.disconnect();
      graph.masterMeter.disconnect();
      for (const st of graph.strips.values()) {
        st.pan.disconnect();
        st.gain.disconnect();
        st.meter.disconnect();
      }
    }
    graph = null;
    meters.value = {};
  }

  /** Set every fader / pan for comp time `t` (smoothly while playing). */
  function applyLevels(t: number, smooth: boolean) {
    if (!graph) return;
    const ctx = audioContext();
    const set = (p: AudioParam, v: number) => (smooth ? p.setTargetAtTime(v, ctx.currentTime, 0.015) : (p.value = v));
    set(graph.master.gain, dbToGain(opts.masterVolume?.() ?? 0));
    // Effect automation (fx keys, duck curves).
    for (const a of graph.autos) if (a.keyed) set(a.param, a.at(t));
    const solo = anySoloIn(entries.value);
    const seenHosts = new Set<string>();
    for (const e of entries.value) {
      const st = graph.strips.get(e.key);
      if (st) {
        set(st.gain, audible(e, solo) ? dbToGain(paramAt(e.layer, e.tracks, "volume", t - e.offset, 0)) : 0);
        set(st.pan.pan, paramAt(e.layer, e.tracks, "pan", t - e.offset, 0));
      }
      for (const h of e.hosts) {
        if (seenHosts.has(h.key)) continue;
        seenHosts.add(h.key);
        const hs = graph.strips.get(h.key);
        if (!hs) continue;
        set(hs.gain, dbToGain(paramAt(h.layer, h.tracks, "audioVolume", t - h.offset, 0)));
        set(hs.pan.pan, paramAt(h.layer, h.tracks, "audioPan", t - h.offset, 0));
      }
    }
  }

  function start(t: number) {
    const ctx = audioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.01;
    anchorT = t;
    anchorCtx = now;
    missing = false;
    const mix: MixSettings = {
      masterVolume: opts.masterVolume?.() ?? 0,
      masterEffects: opts.masterEffects?.(),
      rootTracks: opts.tracks.value,
      duration: Math.max(1, opts.duration?.() ?? 60),
    };
    graph = buildGraph(ctx, entries.value, mix, duckCurvesFor(entries.value, mix, bufferNow));
    for (const entry of entries.value) {
      const buffer = bufferNow(entry.src);
      if (!buffer) {
        missing = true;
        continue;
      }
      const input = graph.inputFor(entry);
      if (t >= entry.to) continue;
      const begin = Math.max(t, entry.from);
      // Source time (buffer seconds) at `begin`.
      const srcAt = (begin - entry.start) * entry.rate;
      if (srcAt >= buffer.duration) continue;
      const when = now + (begin - t);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = entry.rate;
      const vg = voiceGain(ctx, entry, (ct) => when + (ct - begin));
      source.connect(vg).connect(input.pan);
      source.start(when, Math.max(0, srcAt));
      if (Number.isFinite(entry.to)) source.stop(when + (entry.to - begin));
      voices.push({ source, entry });
    }
    applyLevels(t, false);
    if (meterRaf === null) meterRaf = requestAnimationFrame(meterLoop);
  }

  /**
   * Call every playback tick. `realtime`: frames are coming at real speed
   * (cached). Restarts on drift (seek, loop wrap, stepping) and keeps faders
   * and pans following their keys.
   */
  function tick(t: number, realtime: boolean) {
    if (!realtime) {
      stop();
      return;
    }
    const ctx = audioContext();
    const expected = anchorT + (ctx.currentTime - anchorCtx);
    const drift = Math.abs(expected - t);
    if (!graph || drift > 0.12 || (missing && entries.value.every((e) => bufferNow(e.src)))) {
      stop();
      start(t);
      return;
    }
    applyLevels(t, true);
  }

  // Sound edits while playing (src, timing, nested changes): rebuild the voices.
  watch(
    () =>
      entries.value.map((e) => `${e.key}:${e.src}:${e.from}:${e.to}:${JSON.stringify(e.layer.audioEffects ?? null)}:${JSON.stringify(e.hosts.map((h) => h.layer.audioEffects ?? null))}`).join("|") +
      JSON.stringify(opts.masterEffects?.() ?? null),
    () => {
      if (graph) stop();
    },
  );

  onBeforeUnmount(() => {
    stop();
    if (meterRaf !== null) cancelAnimationFrame(meterRaf);
  });
  return { tick, stop, meters, entries };
}

/**
 * Offline mix of every sound (open comp + nested comps) through the same
 * graph (faders, pans, buses, mute/solo, master) for export (stereo,
 * 48 kHz), or null when the comp has no sound.
 */
export async function renderAudioMix(
  layers: readonly LayerInstance[],
  tracks: readonly PropertyTrack[],
  duration: number,
  resolveComposition?: (compId: string) => CompositionConfig | null | undefined,
  masterVolume = 0,
  masterEffects?: AudioEffect[],
  extra: { frame?: { width: number; height: number }; settings?: CompositionConfig["settings"] } = {},
  sampleRate = 48000,
): Promise<AudioBuffer | null> {
  const { frame, settings } = extra;
  // Decode every source first (trigger anchors + duck curves read them).
  const decodedBufs = new Map<string, AudioBuffer | null>();
  const decodeAll = async (srcs: string[]) => {
    for (const src of srcs) if (src && !decodedBufs.has(src)) decodedBufs.set(src, await decodeAudio(src));
  };
  const allSrcs = (ls: readonly LayerInstance[]) =>
    ls.flatMap((l) => (l.type === "audio" ? [l.values.src as string, ...(((l.trigger as { alternates?: string[] } | undefined)?.alternates) ?? [])] : []));
  await decodeAll(allSrcs(layers));
  const env: AudioEnv = { frame: frame ?? { width: 1920, height: 1080 }, buffers: (src) => decodedBufs.get(src) ?? null, settings };
  let list = collectAudio(layers, tracks, resolveComposition, "", 0, [-Infinity, Infinity], new Set(), 0, [], env);
  await decodeAll(list.map((e) => e.src));
  list = collectAudio(layers, tracks, resolveComposition, "", 0, [-Infinity, Infinity], new Set(), 0, [], env);
  if (!list.length || duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const mix: MixSettings = { masterVolume, masterEffects, rootTracks: tracks, duration };
  const graph = buildGraph(ctx, list, mix, duckCurvesFor(list, mix, (src) => decodedBufs.get(src) ?? null));
  for (const a of graph.autos) {
    a.param.setValueAtTime(a.at(0), 0);
    if (a.keyed) for (let t = 0; t <= duration; t += 0.01) a.param.linearRampToValueAtTime(a.at(t), t);
  }
  const solo = anySoloIn(list);
  /** Static value, or automation sampled at 100 Hz over [from, to]. */
  const automate = (p: AudioParam, f: (t: number) => number, keyed: boolean, from: number, to: number) => {
    p.setValueAtTime(f(from), 0);
    if (keyed) for (let t = from; t <= to; t += 0.01) p.linearRampToValueAtTime(f(t), t);
  };
  let any = false;
  const doneHosts = new Set<string>();
  for (const e of list) {
    const buffer = decodedBufs.get(e.src) ?? null;
    if (!buffer) continue;
    const from = Math.max(0, e.from);
    const to = Math.min(e.to, duration);
    if (to <= from) continue;
    const srcAt = (from - e.start) * e.rate;
    if (srcAt >= buffer.duration) continue;
    const st = graph.inputFor(e);
    const on = audible(e, solo);
    automate(st.gain.gain, (t) => (on ? dbToGain(paramAt(e.layer, e.tracks, "volume", t - e.offset, 0)) : 0), hasKeys(e.layer, e.tracks, "volume"), from, to);
    automate(st.pan.pan, (t) => paramAt(e.layer, e.tracks, "pan", t - e.offset, 0), hasKeys(e.layer, e.tracks, "pan"), from, to);
    for (const h of e.hosts) {
      if (doneHosts.has(h.key)) continue;
      doneHosts.add(h.key);
      const hs = graph.strips.get(h.key)!;
      automate(hs.gain.gain, (t) => dbToGain(paramAt(h.layer, h.tracks, "audioVolume", t - h.offset, 0)), hasKeys(h.layer, h.tracks, "audioVolume"), 0, duration);
      automate(hs.pan.pan, (t) => paramAt(h.layer, h.tracks, "audioPan", t - h.offset, 0), hasKeys(h.layer, h.tracks, "audioPan"), 0, duration);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = e.rate;
    source.connect(voiceGain(ctx, e, (ct) => ct)).connect(st.pan);
    source.start(from, Math.max(0, srcAt));
    source.stop(to);
    any = true;
  }
  return any ? await ctx.startRendering() : null;
}
