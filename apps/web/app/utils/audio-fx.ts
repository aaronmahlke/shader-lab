import { evaluatePropertyTrack, type PropertyTrack } from "@shader-lab/core";
import { audioEffectDef, fxTrackName, type AudioEffect } from "#shared/editor/audio-effects";

/**
 * Web Audio nodes for an effect chain (same code for live playback and the
 * offline export mix). Params read keys (`fx:<id>:<param>` tracks on the
 * owner) on the owner's comp clock; `automations` lists every AudioParam the
 * caller should drive over time.
 */
export type FxOwner = { id: string; tracks: readonly PropertyTrack[]; offset: number };
export type FxAutomation = { param: AudioParam; at: (compTime: number) => number; keyed: boolean };
/** Precomputed duck gain curve (100 Hz, comp time from 0), by effect id. */
export type DuckCurves = Map<string, Float32Array>;
export const DUCK_RATE = 100;

export function fxParam(owner: FxOwner, fx: AudioEffect, name: string): { at: (t: number) => number; keyed: boolean } {
  const def = audioEffectDef(fx.type)?.params.find((p) => p.name === name);
  const base = fx.params[name] ?? def?.default ?? 0;
  const track = owner.tracks.find((t) => t.layerId === owner.id && t.paramName === fxTrackName(fx.id, name) && t.enabled && t.keys.length);
  return track
    ? { at: (t) => evaluatePropertyTrack(track, t - owner.offset, base), keyed: true }
    : { at: () => base, keyed: false };
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Noise impulse response with exponential decay, pre-delay and a one-pole tone. */
function impulse(ctx: BaseAudioContext, decay: number, preDelayMs: number, toneHz: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const pre = Math.round((preDelayMs / 1000) * rate);
  const len = pre + Math.max(1, Math.round(decay * rate));
  const buf = ctx.createBuffer(2, len, rate);
  const a = Math.exp((-2 * Math.PI * toneHz) / rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 1234567 + c * 7654321;
    let lp = 0;
    for (let i = pre; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = (seed / 4294967296) * 2 - 1;
      lp = (1 - a) * n + a * lp;
      d[i] = lp * Math.exp((-6.9 * (i - pre)) / (decay * rate)); // −60 dB at `decay`
    }
  }
  return buf;
}

/**
 * Web Audio's DynamicsCompressorNode adds its own makeup gain (spec:
 * (1 / gain-at-0-dBFS)^0.6). Undo it so only our Makeup param adds level.
 */
function autoMakeupCompensation(thresholdDb: number, ratio: number): number {
  const over = Math.max(0, -thresholdDb);
  const atFullScale = thresholdDb + over / Math.max(1, ratio); // dB out for a 0 dBFS input (hard knee)
  const fullRangeGain = Math.pow(10, atFullScale / 20);
  return Math.pow(fullRangeGain, 0.6);
}

/** Soft-kneed clipper: passes up to 90 % of the ceiling, then bends into it. */
function clipCurve(ceilingDb: number): Float32Array<ArrayBuffer> {
  const c = dbToGain(ceilingDb);
  const n = 4096;
  const out = new Float32Array(n);
  const knee = 0.9 * c;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 4; // input range ±4 (+12 dB headroom)
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (c - knee) * Math.tanh((a - knee) / (c - knee));
    out[i] = Math.sign(x) * y;
  }
  return out;
}

function tanhCurve(driveDb: number): Float32Array<ArrayBuffer> {
  const k = dbToGain(driveDb);
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/** Build the chain between `input` and `output`; returns the params to automate. */
export function buildFxChain(
  ctx: BaseAudioContext,
  effects: readonly AudioEffect[] | undefined,
  owner: FxOwner,
  input: AudioNode,
  output: AudioNode,
  ducks: DuckCurves,
): FxAutomation[] {
  const autos: FxAutomation[] = [];
  const drive = (param: AudioParam, fx: AudioEffect, name: string, map: (v: number) => number = (v) => v) => {
    const p = fxParam(owner, fx, name);
    autos.push({ param, at: (t) => map(p.at(t)), keyed: p.keyed });
    param.value = map(p.at(0));
  };
  let node: AudioNode = input;
  for (const fx of effects ?? []) {
    if (fx.enabled === false) continue;
    const v = (name: string) => fxParam(owner, fx, name).at(0);
    switch (fx.type) {
      case "eq": {
        const lo = new BiquadFilterNode(ctx, { type: "lowshelf" });
        const mid = new BiquadFilterNode(ctx, { type: "peaking" });
        const hi = new BiquadFilterNode(ctx, { type: "highshelf" });
        drive(lo.gain, fx, "low");
        drive(lo.frequency, fx, "lowFreq");
        drive(mid.gain, fx, "mid");
        drive(mid.frequency, fx, "midFreq");
        drive(mid.Q, fx, "midQ");
        drive(hi.gain, fx, "high");
        drive(hi.frequency, fx, "highFreq");
        node.connect(lo).connect(mid).connect(hi);
        node = hi;
        break;
      }
      case "filter": {
        const types: BiquadFilterType[] = ["lowpass", "highpass", "bandpass"];
        const f = new BiquadFilterNode(ctx, { type: types[Math.round(v("mode"))] ?? "lowpass" });
        drive(f.frequency, fx, "freq");
        drive(f.Q, fx, "q");
        node.connect(f);
        node = f;
        break;
      }
      case "compressor": {
        const c = new DynamicsCompressorNode(ctx);
        drive(c.threshold, fx, "threshold");
        drive(c.ratio, fx, "ratio");
        drive(c.attack, fx, "attack", (ms) => ms / 1000);
        drive(c.release, fx, "release", (ms) => ms / 1000);
        drive(c.knee, fx, "knee");
        const makeup = new GainNode(ctx);
        const thr = fxParam(owner, fx, "threshold");
        const rat = fxParam(owner, fx, "ratio");
        const mk = fxParam(owner, fx, "makeup");
        const level = (t: number) => dbToGain(mk.at(t)) * autoMakeupCompensation(thr.at(t), rat.at(t));
        makeup.gain.value = level(0);
        autos.push({ param: makeup.gain, at: level, keyed: thr.keyed || rat.keyed || mk.keyed });
        node.connect(c).connect(makeup);
        node = makeup;
        break;
      }
      case "limiter": {
        // Fast compressor (auto makeup undone) + a clipper at the ceiling:
        // peaks can't pass, whatever slips through the attack is caught.
        const c = new DynamicsCompressorNode(ctx, { ratio: 20, knee: 0, attack: 0.001 });
        drive(c.threshold, fx, "ceiling");
        drive(c.release, fx, "release", (ms) => ms / 1000);
        const comp = new GainNode(ctx, { gain: autoMakeupCompensation(v("ceiling"), 20) });
        const clip = new WaveShaperNode(ctx, { curve: clipCurve(v("ceiling")) });
        // WaveShaper maps [-1, 1] onto the curve: scale the ±4 input range in and out.
        const pre = new GainNode(ctx, { gain: 0.25 });
        node.connect(c).connect(comp).connect(pre).connect(clip);
        node = clip;
        break;
      }
      case "duck": {
        const g = new GainNode(ctx);
        const curve = ducks.get(fx.id);
        if (curve) autos.push({ param: g.gain, at: (t) => curve[Math.max(0, Math.min(curve.length - 1, Math.round(t * DUCK_RATE)))] ?? 1, keyed: true });
        node.connect(g);
        node = g;
        break;
      }
      case "reverb": {
        const dry = new GainNode(ctx);
        const wet = new GainNode(ctx);
        const conv = new ConvolverNode(ctx, { buffer: impulse(ctx, v("decay"), v("preDelay"), v("tone")) });
        drive(wet.gain, fx, "mix");
        drive(dry.gain, fx, "mix", (m) => 1 - m);
        const sum = new GainNode(ctx);
        node.connect(dry).connect(sum);
        node.connect(conv).connect(wet).connect(sum);
        node = sum;
        break;
      }
      case "delay": {
        const dry = new GainNode(ctx);
        const wet = new GainNode(ctx);
        const d = new DelayNode(ctx, { maxDelayTime: 2.5 });
        const fb = new GainNode(ctx);
        const tone = new BiquadFilterNode(ctx, { type: "lowpass" });
        drive(d.delayTime, fx, "time", (ms) => ms / 1000);
        drive(fb.gain, fx, "feedback");
        drive(tone.frequency, fx, "tone");
        drive(wet.gain, fx, "mix");
        drive(dry.gain, fx, "mix", (m) => 1 - m);
        const sum = new GainNode(ctx);
        node.connect(dry).connect(sum);
        node.connect(d).connect(tone).connect(wet).connect(sum);
        tone.connect(fb).connect(d);
        node = sum;
        break;
      }
      case "saturation": {
        const dry = new GainNode(ctx);
        const wet = new GainNode(ctx);
        const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(v("drive")), oversample: "4x" });
        drive(wet.gain, fx, "mix");
        drive(dry.gain, fx, "mix", (m) => 1 - m);
        const sum = new GainNode(ctx);
        node.connect(dry).connect(sum);
        node.connect(shaper).connect(wet).connect(sum);
        node = sum;
        break;
      }
      case "width": {
        // L' = (1+w)/2·L + (1−w)/2·R ; R' = (1−w)/2·L + (1+w)/2·R
        const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
        const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
        const ll = new GainNode(ctx), rl = new GainNode(ctx), lr = new GainNode(ctx), rr = new GainNode(ctx);
        drive(ll.gain, fx, "width", (w) => (1 + w) / 2);
        drive(rr.gain, fx, "width", (w) => (1 + w) / 2);
        drive(rl.gain, fx, "width", (w) => (1 - w) / 2);
        drive(lr.gain, fx, "width", (w) => (1 - w) / 2);
        node.connect(split);
        split.connect(ll, 0).connect(merge, 0, 0);
        split.connect(rl, 1).connect(merge, 0, 0);
        split.connect(lr, 0).connect(merge, 0, 1);
        split.connect(rr, 1).connect(merge, 0, 1);
        node = merge;
        break;
      }
    }
  }
  node.connect(output);
  return autos;
}

/**
 * Duck gain curve (100 Hz over [0, duration]) from the trigger sound's
 * actual level: RMS in 10 ms windows → reduction above threshold (up to
 * `amount` dB), smoothed with attack / release. Deterministic, identical in
 * playback and export.
 */
export function duckCurve(
  triggers: { buffer: AudioBuffer; start: number; from: number; to: number }[],
  params: { amount: number; threshold: number; attack: number; release: number },
  duration: number,
): Float32Array {
  const n = Math.ceil(duration * DUCK_RATE) + 1;
  // Loudest trigger per 10 ms step (dB).
  const level = new Float32Array(n).fill(-Infinity);
  for (const tr of triggers) {
    const { buffer } = tr;
    const data = buffer.getChannelData(0);
    const data2 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data;
    const win = Math.max(1, Math.round(buffer.sampleRate / DUCK_RATE));
    const i0 = Math.max(0, Math.floor(tr.from * DUCK_RATE));
    const i1 = Math.min(n, Math.ceil(Math.min(tr.to, duration) * DUCK_RATE));
    for (let i = i0; i < i1; i++) {
      const s0 = Math.round((i / DUCK_RATE - tr.start) * buffer.sampleRate);
      if (s0 < 0 || s0 >= data.length) continue;
      let sum = 0;
      const end = Math.min(data.length, s0 + win);
      for (let k = s0; k < end; k++) sum += (data[k]! * data[k]! + data2[k]! * data2[k]!) / 2;
      const db = 10 * Math.log10(sum / Math.max(1, end - s0) + 1e-12);
      if (db > level[i]!) level[i] = db;
    }
  }
  const out = new Float32Array(n);
  const aCoef = Math.exp(-1 / Math.max(1e-3, (params.attack / 1000) * DUCK_RATE));
  const rCoef = Math.exp(-1 / Math.max(1e-3, (params.release / 1000) * DUCK_RATE));
  let red = 0; // current reduction in dB
  for (let i = 0; i < n; i++) {
    const over = level[i]! - params.threshold;
    const target = over > 0 ? Math.min(params.amount, over) : 0;
    const c = target > red ? aCoef : rCoef;
    red = target + (red - target) * c;
    out[i] = dbToGain(-red);
  }
  return out;
}
