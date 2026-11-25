import type { EnvelopeSource } from "../types/editor";

export type EnvelopeShape = Pick<EnvelopeSource, "attack" | "decay" | "sustain" | "gate" | "release">;

/** Level while the gate is open, `x` seconds after a trigger that started at `start`. */
function gateLevel(env: EnvelopeShape, start: number, x: number): number {
  const sustain = clamp01(env.sustain);
  if (x < env.attack) return start + (1 - start) * (x / env.attack);
  const intoDecay = x - Math.max(0, env.attack);
  if (intoDecay < env.decay) return 1 + (sustain - 1) * (intoDecay / env.decay);
  return sustain;
}

/** Level `x` seconds after a trigger whose attack starts from level `start`. */
function triggerLevel(env: EnvelopeShape, start: number, x: number): number {
  const gate = Math.max(0, env.gate);
  if (x < gate) return gateLevel(env, start, x);
  const releaseFrom = gateLevel(env, start, gate);
  const intoRelease = x - gate;
  if (env.release <= 0 || intoRelease >= env.release) return 0;
  return releaseFrom * (1 - intoRelease / env.release);
}

/**
 * ADSR level (0..1) at `time`, given trigger times in the same clock. Before
 * the first trigger the level is 0. A retrigger is legato: its attack ramps
 * from wherever the previous trigger had got to.
 */
export function evaluateEnvelope(env: EnvelopeShape, triggers: readonly number[], time: number): number {
  const sorted = [...triggers].sort((a, b) => a - b);
  let level = 0;
  let current: number | null = null;
  let start = 0;

  for (const trigger of sorted) {
    if (trigger > time) break;
    if (current !== null) start = triggerLevel(env, start, trigger - current);
    current = trigger;
  }

  if (current === null) return level;
  level = triggerLevel(env, start, time - current);
  return clamp01(level);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
