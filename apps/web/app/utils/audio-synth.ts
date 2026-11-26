/**
 * Synthesized sounds for agents: a sound is a JSON patch instead of a file.
 * An audio layer (or trigger alternate) uses it as `src = "synth:" + JSON`,
 * so it flows through every path a file does (triggers, effects, export,
 * meter, waveform). Rendered offline once per patch and cached.
 *
 *   {
 *     duration: 0.6,                // s
 *     voices: [{
 *       wave: "sine" | "square" | "saw" | "triangle" | "noise" | "pink",
 *       freq: 220, freqEnd?: 880,   // Hz; sweep over the voice (exponential unless sweep: "linear")
 *       sweep?: "exp" | "linear",
 *       detune?: 0,                 // cents
 *       gain?: 0,                   // dB
 *       start?: 0, length?: 0.6,    // s inside the patch (default: whole patch)
 *       attack?: 0.005, decay?: 0.1, sustain?: 1, release?: 0.05,   // s / 0…1
 *       curve?: 1,                  // >1 = snappier decays (exponent on the envelope)
 *       filter?: { type: "lowpass" | "highpass" | "bandpass", freq: 2000, freqEnd?: 200, q?: 0.7 },
 *       pan?: 0,                    // −1 … 1
 *     }],
 *     gain?: 0,                     // dB, whole patch
 *   }
 */
export type SynthVoice = {
  wave: "sine" | "square" | "saw" | "triangle" | "noise" | "pink";
  freq?: number;
  freqEnd?: number;
  sweep?: "exp" | "linear";
  detune?: number;
  gain?: number;
  start?: number;
  length?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  curve?: number;
  filter?: { type: "lowpass" | "highpass" | "bandpass"; freq: number; freqEnd?: number; q?: number };
  pan?: number;
};
export type SynthPatch = { duration: number; voices: SynthVoice[]; gain?: number };

export const SYNTH_PREFIX = "synth:";
export const isSynthSrc = (src: string) => src.startsWith(SYNTH_PREFIX);
export const synthSrc = (patch: SynthPatch) => SYNTH_PREFIX + JSON.stringify(patch);
export function parseSynth(src: string): SynthPatch | null {
  try {
    const p = JSON.parse(src.slice(SYNTH_PREFIX.length)) as SynthPatch;
    return p && Array.isArray(p.voices) && p.duration > 0 ? p : null;
  } catch {
    return null;
  }
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

function noiseBuffer(ctx: BaseAudioContext, seconds: number, pink: boolean, seed: number): AudioBuffer {
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  // Pink: Paul Kellet's filter.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd();
    if (!pink) {
      d[i] = w * 0.5;
      continue;
    }
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

/** Amplitude envelope (ADSR, release at the voice's end) sampled at 1 kHz. */
function envelope(v: SynthVoice, len: number): Float32Array {
  const n = Math.max(2, Math.ceil(len * 1000));
  const out = new Float32Array(n);
  const a = Math.max(0.0005, v.attack ?? 0.005);
  const d = Math.max(0.0005, v.decay ?? 0.1);
  const s = Math.min(1, Math.max(0, v.sustain ?? 1));
  const r = Math.max(0.0005, Math.min(v.release ?? 0.05, len));
  const curve = Math.max(0.1, v.curve ?? 1);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * len;
    let e = t < a ? t / a : t < a + d ? 1 - (1 - s) * Math.pow((t - a) / d, 1 / curve) : s;
    if (t > len - r) e *= Math.max(0, (len - t) / r);
    out[i] = Math.pow(Math.max(0, e), curve);
  }
  return out;
}

const cache = new Map<string, Promise<AudioBuffer | null>>();

/** Render a synth src to a stereo buffer (cached per patch). */
export function renderSynth(src: string, sampleRate = 48000): Promise<AudioBuffer | null> {
  let p = cache.get(src);
  if (p) return p;
  p = (async () => {
    const patch = parseSynth(src);
    if (!patch) return null;
    const dur = Math.min(60, patch.duration);
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
    const master = ctx.createGain();
    master.gain.value = dbToGain(patch.gain ?? 0);
    master.connect(ctx.destination);
    patch.voices.forEach((v, i) => {
      const start = Math.max(0, v.start ?? 0);
      const len = Math.max(0.001, Math.min(v.length ?? dur - start, dur - start));
      if (len <= 0) return;
      let source: AudioScheduledSourceNode;
      if (v.wave === "noise" || v.wave === "pink") {
        const b = ctx.createBufferSource();
        b.buffer = noiseBuffer(ctx, len, v.wave === "pink", i + 1);
        source = b;
      } else {
        const o = ctx.createOscillator();
        o.type = v.wave === "saw" ? "sawtooth" : v.wave;
        const f0 = Math.max(1, v.freq ?? 440);
        o.frequency.setValueAtTime(f0, start);
        if (v.freqEnd != null && v.freqEnd > 0) {
          if (v.sweep === "linear") o.frequency.linearRampToValueAtTime(v.freqEnd, start + len);
          else o.frequency.exponentialRampToValueAtTime(v.freqEnd, start + len);
        }
        o.detune.value = v.detune ?? 0;
        source = o;
      }
      let node: AudioNode = source;
      if (v.filter) {
        const f = ctx.createBiquadFilter();
        f.type = v.filter.type;
        f.Q.value = v.filter.q ?? 0.7;
        f.frequency.setValueAtTime(Math.max(10, v.filter.freq), start);
        if (v.filter.freqEnd != null && v.filter.freqEnd > 0) f.frequency.exponentialRampToValueAtTime(v.filter.freqEnd, start + len);
        node.connect(f);
        node = f;
      }
      const amp = ctx.createGain();
      amp.gain.value = 0;
      const env = envelope(v, len);
      const g = dbToGain(v.gain ?? 0);
      amp.gain.setValueCurveAtTime(env.map((e) => e * g), start, len);
      node.connect(amp);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, v.pan ?? 0));
      amp.connect(pan).connect(master);
      source.start(start);
      source.stop(start + len);
    });
    return ctx.startRendering();
  })().catch((err) => {
    console.warn("[audio] synth failed", err);
    cache.delete(src);
    return null;
  });
  cache.set(src, p);
  return p;
}

/** Starting points for the inspector (agents write their own). */
export const SYNTH_PRESETS: Record<string, SynthPatch> = {
  Whoosh: {
    duration: 0.8,
    voices: [{ wave: "pink", attack: 0.35, decay: 0.1, sustain: 0.8, release: 0.35, filter: { type: "bandpass", freq: 300, freqEnd: 3000, q: 1.2 }, gain: 6 }],
  },
  Riser: {
    duration: 2,
    voices: [
      { wave: "saw", freq: 110, freqEnd: 880, attack: 1.8, release: 0.1, filter: { type: "lowpass", freq: 400, freqEnd: 6000, q: 2 }, gain: -10 },
      { wave: "noise", attack: 1.9, release: 0.05, filter: { type: "highpass", freq: 2000, freqEnd: 8000 }, gain: -14 },
    ],
  },
  Impact: {
    duration: 1.2,
    voices: [
      { wave: "sine", freq: 120, freqEnd: 40, attack: 0.002, decay: 0.9, sustain: 0, release: 0.2, curve: 2 },
      { wave: "noise", length: 0.25, attack: 0.001, decay: 0.2, sustain: 0, curve: 3, filter: { type: "lowpass", freq: 6000, freqEnd: 500 }, gain: -6 },
    ],
  },
  Click: {
    duration: 0.06,
    voices: [
      { wave: "noise", attack: 0.0005, decay: 0.015, sustain: 0, release: 0.01, curve: 2, filter: { type: "bandpass", freq: 3500, q: 1.5 }, gain: 6 },
      { wave: "sine", freq: 1800, freqEnd: 900, attack: 0.0005, decay: 0.02, sustain: 0, curve: 2, gain: -8 },
    ],
  },
  Blip: {
    duration: 0.15,
    voices: [{ wave: "triangle", freq: 1320, freqEnd: 1760, attack: 0.002, decay: 0.12, sustain: 0, release: 0.02, curve: 1.5, gain: -4 }],
  },
  "Sub drop": {
    duration: 1.5,
    voices: [{ wave: "sine", freq: 90, freqEnd: 30, attack: 0.01, decay: 1.4, sustain: 0, release: 0.1, curve: 1.5 }],
  },
  "Tick (UI)": {
    duration: 0.03,
    voices: [{ wave: "square", freq: 2400, attack: 0.0005, decay: 0.012, sustain: 0, release: 0.005, curve: 2, filter: { type: "highpass", freq: 1500 }, gain: -12 }],
  },
};
