/**
 * Audio effects for mixer chains (audio layers, precomp buses, master).
 *
 * Stored as data (`layer.audioEffects`, `settings.masterEffects`) so people
 * and agents edit them the same way. Any param can be automated with a
 * property track named `fx:<effectId>:<param>` on the owning layer (master:
 * on layer id "master"), evaluated on that layer's comp clock.
 */
export type AudioEffectType = "eq" | "filter" | "compressor" | "duck" | "reverb" | "delay" | "saturation" | "width" | "limiter";

export type AudioEffect = {
  id: string;
  type: AudioEffectType;
  enabled?: boolean;
  params: Record<string, number>;
  /** duck: the audio layer (same comp) whose level pushes this one down. */
  source?: string;
};

export type AudioEffectParam = {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  /** Options for stepped params (e.g. filter type). */
  options?: { value: number; label: string }[];
};

export type AudioEffectDef = { type: AudioEffectType; label: string; params: AudioEffectParam[] };

export const AUDIO_EFFECTS: AudioEffectDef[] = [
  {
    type: "eq",
    label: "EQ (3-band)",
    params: [
      { name: "low", label: "Low", min: -24, max: 24, step: 0.1, default: 0, unit: " dB" },
      { name: "lowFreq", label: "Low freq", min: 40, max: 1000, step: 1, default: 200, unit: " Hz" },
      { name: "mid", label: "Mid", min: -24, max: 24, step: 0.1, default: 0, unit: " dB" },
      { name: "midFreq", label: "Mid freq", min: 200, max: 8000, step: 1, default: 1000, unit: " Hz" },
      { name: "midQ", label: "Mid Q", min: 0.1, max: 10, step: 0.01, default: 1 },
      { name: "high", label: "High", min: -24, max: 24, step: 0.1, default: 0, unit: " dB" },
      { name: "highFreq", label: "High freq", min: 1000, max: 16000, step: 1, default: 4000, unit: " Hz" },
    ],
  },
  {
    type: "filter",
    label: "Filter",
    params: [
      {
        name: "mode",
        label: "Mode",
        min: 0,
        max: 2,
        step: 1,
        default: 0,
        options: [
          { value: 0, label: "Low-pass" },
          { value: 1, label: "High-pass" },
          { value: 2, label: "Band-pass" },
        ],
      },
      { name: "freq", label: "Cutoff", min: 20, max: 20000, step: 1, default: 20000, unit: " Hz" },
      { name: "q", label: "Resonance", min: 0.1, max: 20, step: 0.01, default: 0.7 },
    ],
  },
  {
    type: "compressor",
    label: "Compressor",
    params: [
      { name: "threshold", label: "Threshold", min: -60, max: 0, step: 0.1, default: -18, unit: " dB" },
      { name: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, default: 4 },
      { name: "attack", label: "Attack", min: 0, max: 200, step: 0.1, default: 10, unit: " ms" },
      { name: "release", label: "Release", min: 10, max: 1000, step: 1, default: 150, unit: " ms" },
      { name: "knee", label: "Knee", min: 0, max: 40, step: 0.1, default: 6, unit: " dB" },
      { name: "makeup", label: "Makeup", min: 0, max: 24, step: 0.1, default: 0, unit: " dB" },
    ],
  },
  {
    type: "duck",
    label: "Sidechain duck",
    params: [
      { name: "amount", label: "Amount", min: 0, max: 48, step: 0.1, default: 9, unit: " dB" },
      { name: "threshold", label: "Threshold", min: -60, max: 0, step: 0.1, default: -30, unit: " dB" },
      { name: "attack", label: "Attack", min: 0, max: 200, step: 0.1, default: 5, unit: " ms" },
      { name: "release", label: "Release", min: 10, max: 2000, step: 1, default: 200, unit: " ms" },
    ],
  },
  {
    type: "reverb",
    label: "Reverb",
    params: [
      { name: "decay", label: "Decay", min: 0.1, max: 10, step: 0.01, default: 1.8, unit: " s" },
      { name: "preDelay", label: "Pre-delay", min: 0, max: 200, step: 1, default: 15, unit: " ms" },
      { name: "tone", label: "Tone", min: 500, max: 20000, step: 1, default: 8000, unit: " Hz" },
      { name: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
  },
  {
    type: "delay",
    label: "Delay",
    params: [
      { name: "time", label: "Time", min: 1, max: 2000, step: 1, default: 250, unit: " ms" },
      { name: "feedback", label: "Feedback", min: 0, max: 0.95, step: 0.01, default: 0.35 },
      { name: "tone", label: "Tone", min: 500, max: 20000, step: 1, default: 6000, unit: " Hz" },
      { name: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
  },
  {
    type: "saturation",
    label: "Saturation",
    params: [
      { name: "drive", label: "Drive", min: 0, max: 36, step: 0.1, default: 6, unit: " dB" },
      { name: "mix", label: "Mix", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  {
    type: "width",
    label: "Stereo width",
    params: [{ name: "width", label: "Width", min: 0, max: 2, step: 0.01, default: 1 }],
  },
  {
    type: "limiter",
    label: "Limiter",
    params: [
      { name: "ceiling", label: "Ceiling", min: -12, max: 0, step: 0.1, default: -1, unit: " dB" },
      { name: "release", label: "Release", min: 10, max: 500, step: 1, default: 60, unit: " ms" },
    ],
  },
];

export function audioEffectDef(type: AudioEffectType): AudioEffectDef | undefined {
  return AUDIO_EFFECTS.find((d) => d.type === type);
}

export function newAudioEffect(type: AudioEffectType): AudioEffect {
  const def = audioEffectDef(type)!;
  return {
    id: Math.random().toString(36).slice(2, 10),
    type,
    enabled: true,
    params: Object.fromEntries(def.params.map((p) => [p.name, p.default])),
  };
}

export const fxTrackName = (effectId: string, param: string) => `fx:${effectId}:${param}`;
