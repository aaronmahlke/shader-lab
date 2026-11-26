import type { CompositionConfig, LayerInstance, PropertyTrack } from "@shader-lab/core";
import { collectCompEvents, type CompEvent } from "~/utils/comp-events";

/**
 * Picture-locked triggers: an audio layer with `trigger` plays its sound
 * once per matching event of its comp (a pointer press, a motion's speed
 * peak, a component cue, a marker…), lined up by the sound's own anchor.
 *
 *   layer.trigger = {
 *     on: "press" | "release" | "motionPeak" | "motionStart" | "motionEnd" | "in" | "out" | "cue" | "marker",
 *     target?: layerId,            // only events of this layer (or anything inside this precomp)
 *     name?: string,               // cue / marker name filter
 *     anchor?: "onset" | "peak" | "end",   // which point of the sound lands on the event (default onset)
 *     offsetMs?: number,           // nudge
 *     fit?: boolean,               // motion events: fade the tail out by the move's end
 *     alternates?: string[],       // round-robin sources (besides values.src)
 *     pitchJitter?: number,        // ± semitones per hit
 *     gainJitter?: number,         // ± dB per hit
 *     seed?: number,
 *   }
 * Only events inside the layer's own in/out window fire.
 */
export type AudioTrigger = {
  on: "press" | "release" | "motionPeak" | "motionStart" | "motionEnd" | "in" | "out" | "cue" | "marker";
  target?: string;
  name?: string;
  anchor?: "onset" | "peak" | "end";
  offsetMs?: number;
  fit?: boolean;
  alternates?: string[];
  pitchJitter?: number;
  gainJitter?: number;
  seed?: number;
};

export type TriggerHit = {
  /** Comp-local time the sound's source starts (its 0). */
  start: number;
  src: string;
  rate: number;
  gainDb: number;
  /** Fade the tail out to silence by this local time (fit to move). */
  fadeOutAt?: number;
  event: CompEvent;
};

/** Where in a sound its onset / peak / end are (s), from its level (cached). */
const anchors = new WeakMap<AudioBuffer, { onset: number; peak: number; end: number }>();
export function soundAnchors(buffer: AudioBuffer) {
  let a = anchors.get(buffer);
  if (a) return a;
  const d = buffer.getChannelData(0);
  const win = Math.max(1, Math.round(buffer.sampleRate / 200)); // 5 ms
  const levels: number[] = [];
  for (let i = 0; i < d.length; i += win) {
    let s = 0;
    const end = Math.min(d.length, i + win);
    for (let k = i; k < end; k++) s += d[k]! * d[k]!;
    levels.push(Math.sqrt(s / (end - i)));
  }
  const max = Math.max(...levels, 1e-9);
  const thr = max * 0.1; // −20 dB under the peak
  const onsetIdx = Math.max(0, levels.findIndex((l) => l >= thr));
  let peakIdx = 0;
  levels.forEach((l, i) => l > (levels[peakIdx] ?? 0) && (peakIdx = i));
  let endIdx = levels.length - 1;
  while (endIdx > 0 && levels[endIdx]! < thr) endIdx--;
  a = { onset: (onsetIdx * win) / buffer.sampleRate, peak: (peakIdx * win) / buffer.sampleRate, end: ((endIdx + 1) * win) / buffer.sampleRate };
  anchors.set(buffer, a);
  return a;
}

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1; // −1 … 1
  };
}

const EVENT_TYPE: Record<AudioTrigger["on"], CompEvent["type"]> = {
  press: "press",
  release: "release",
  motionPeak: "motion",
  motionStart: "motion",
  motionEnd: "motion",
  in: "in",
  out: "out",
  cue: "cue",
  marker: "marker",
};

/** Every hit of a trigger layer, in its comp's local time. */
export function triggerHits(
  layer: LayerInstance,
  comp: { layers: readonly LayerInstance[]; tracks: readonly PropertyTrack[]; settings?: CompositionConfig["settings"] },
  opts: {
    prefix: string;
    resolveComposition: (id: string) => CompositionConfig | null | undefined;
    frame: { width: number; height: number };
    buffers: (src: string) => AudioBuffer | null;
  },
): TriggerHit[] {
  const trig = layer.trigger as AudioTrigger | undefined;
  const mainSrc = typeof layer.values.src === "string" ? layer.values.src : "";
  if (!trig?.on || !mainSrc) return [];
  const events = collectCompEvents(
    { version: 1, layers: comp.layers as LayerInstance[], lfos: [], assignments: [], settings: comp.settings, tracks: comp.tracks as PropertyTrack[] },
    { resolveComposition: opts.resolveComposition, frame: opts.frame, prefix: opts.prefix },
  );
  const type = EVENT_TYPE[trig.on];
  const inWin = (t: number) => t >= (layer.timing?.in ?? -Infinity) && t < (layer.timing?.out ?? Infinity);
  const targetId = trig.target ? `${opts.prefix}${trig.target}` : null;
  const picked = events.filter((e) => {
    if (e.type !== type || e.layerId === `${opts.prefix}${layer.id}`) return false;
    if (targetId && e.layerId !== targetId && !e.layerId?.startsWith(`${targetId}::`)) return false;
    if (trig.name && e.name !== trig.name) return false;
    const at = trig.on === "motionStart" ? (e.start ?? e.time) : trig.on === "motionEnd" ? (e.end ?? e.time) : e.time;
    return inWin(at);
  });
  const sources = [mainSrc, ...(trig.alternates ?? []).filter(Boolean)];
  const rand = rng(trig.seed ?? 1);
  return picked.map((e, i) => {
    const src = sources[i % sources.length]!;
    const rate = Math.pow(2, ((trig.pitchJitter ?? 0) * rand()) / 12);
    const gainDb = (trig.gainJitter ?? 0) * rand();
    const at = (trig.on === "motionStart" ? (e.start ?? e.time) : trig.on === "motionEnd" ? (e.end ?? e.time) : e.time) + (trig.offsetMs ?? 0) / 1000;
    const buf = opts.buffers(src);
    const anchorSec = buf ? soundAnchors(buf)[trig.anchor ?? "onset"] : 0;
    // Anchor point (in source seconds) plays at `at`; playbackRate shortens it.
    const start = at - anchorSec / rate;
    const fadeOutAt = trig.fit && e.type === "motion" && e.end != null ? e.end : undefined;
    return { start, src, rate, gainDb, fadeOutAt, event: e };
  });
}
