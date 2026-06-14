import type { WavePoint } from "@shader-lab/core";

type LFOPreset = {
  label: string;
  points: WavePoint[];
};

export const LFO_PRESETS: Record<string, LFOPreset> = {
  sine: {
    label: "Sine",
    points: [
      { x: 0, y: 0.5, curve: -0.4 },
      { x: 0.25, y: 1, curve: -0.4 },
      { x: 0.5, y: 0.5, curve: 0.4 },
      { x: 0.75, y: 0, curve: 0.4 },
      { x: 1, y: 0.5, curve: 0 },
    ],
  },
  triangle: {
    label: "Triangle",
    points: [
      { x: 0, y: 0, curve: 0 },
      { x: 0.5, y: 1, curve: 0 },
      { x: 1, y: 0, curve: 0 },
    ],
  },
  square: {
    label: "Square",
    points: [
      { x: 0, y: 0, curve: 0 },
      { x: 0, y: 1, curve: 0 },
      { x: 0.5, y: 1, curve: 0 },
      { x: 0.5, y: 0, curve: 0 },
      { x: 1, y: 0, curve: 0 },
    ],
  },
};

/** Clone a preset's points (deep copy) */
export function clonePresetPoints(presetKey: string): WavePoint[] {
  const preset = LFO_PRESETS[presetKey];
  if (!preset) return LFO_PRESETS.sine!.points.map((p) => ({ ...p }));
  return preset.points.map((p) => ({ ...p }));
}
