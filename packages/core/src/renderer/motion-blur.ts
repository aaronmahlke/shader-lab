import type { CompositionSettings } from "../types/animation";

/**
 * Sub-frame times for camera-style motion blur: `samples` renders spread
 * evenly across a shutter window centered on `time` (shutter angle / 360 of
 * a frame interval). Returns just [time] when motion blur is off.
 * `maxSamples` caps the count (e.g. a cheaper preview while playing).
 */
/** On unless a comp explicitly turned it off (AE-style default on). */
export function motionBlurEnabled(settings: Pick<CompositionSettings, "motionBlur">): boolean {
  return settings.motionBlur !== false;
}

export function motionBlurSampleTimes(
  time: number,
  settings: Pick<CompositionSettings, "fps" | "motionBlur" | "shutterAngle" | "motionBlurSamples">,
  maxSamples = Infinity,
): number[] {
  if (!motionBlurEnabled(settings)) return [time];
  const samples = Math.max(1, Math.min(Math.round(settings.motionBlurSamples ?? 8), maxSamples, 64));
  const angle = Math.max(0, Math.min(720, settings.shutterAngle ?? 180));
  if (samples <= 1 || angle <= 0) return [time];
  const window = angle / 360 / Math.max(1, settings.fps);
  return Array.from({ length: samples }, (_, i) => time + ((i + 0.5) / samples - 0.5) * window);
}
