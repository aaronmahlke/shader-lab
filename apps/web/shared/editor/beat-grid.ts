/** Musical grid from comp settings (bpm, bpmOffset, beatsPerBar). */
export type BeatGridSettings = { bpm?: number; bpmOffset?: number; beatsPerBar?: number };

export function beatGridOn(s: BeatGridSettings): boolean {
  return typeof s.bpm === "number" && s.bpm > 0;
}

/** Every beat in [0, duration] (bar = downbeat). */
export function beatTimes(s: BeatGridSettings, duration: number): { time: number; bar: boolean; beat: number }[] {
  if (!beatGridOn(s)) return [];
  const step = 60 / s.bpm!;
  const per = Math.max(1, Math.round(s.beatsPerBar ?? 4));
  const off = s.bpmOffset ?? 0;
  const first = Math.ceil((0 - off) / step - 1e-9);
  const out: { time: number; bar: boolean; beat: number }[] = [];
  for (let i = first; ; i++) {
    const time = off + i * step;
    if (time > duration + 1e-9) break;
    if (time >= -1e-9) out.push({ time: Math.max(0, time), bar: ((i % per) + per) % per === 0, beat: i });
    if (out.length > 5000) break;
  }
  return out;
}

/** Nearest beat when within `tolerance` seconds, else null. */
export function nearestBeat(s: BeatGridSettings, t: number, tolerance: number): number | null {
  if (!beatGridOn(s)) return null;
  const step = 60 / s.bpm!;
  const off = s.bpmOffset ?? 0;
  const b = off + Math.round((t - off) / step) * step;
  return Math.abs(b - t) <= tolerance ? b : null;
}
