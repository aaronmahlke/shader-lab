import type { Keyframe, KeyframeEasing, PropertyTrack } from "../types/animation";

export function trackId(layerId: string, paramName: string): string {
  return `${layerId}:${paramName}`;
}

export function findPropertyTrack(
  tracks: PropertyTrack[],
  layerId: string,
  paramName: string,
): PropertyTrack | undefined {
  return tracks.find((t) => t.layerId === layerId && t.paramName === paramName);
}

function easeProgress(t: number, ease: KeyframeEasing): number {
  const x = Math.max(0, Math.min(1, t));
  switch (ease) {
    case "hold":
      return 0;
    case "easeIn":
      return x * x;
    case "easeOut":
      return 1 - (1 - x) * (1 - x);
    case "easeInOut":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case "linear":
    default:
      return x;
  }
}

/** Interpolate a sorted keyframe list at `time` (seconds). */
export function evaluateKeyframes(keys: Keyframe[], time: number, fallback: number): number {
  if (keys.length === 0) return fallback;

  const sorted = [...keys].sort((a, b) => a.time - b.time);

  if (time <= sorted[0]!.time) return sorted[0]!.value;
  if (time >= sorted[sorted.length - 1]!.time) return sorted[sorted.length - 1]!.value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      if (span <= 1e-9) return b.value;
      const raw = (time - a.time) / span;
      const eased = easeProgress(raw, a.ease ?? "linear");
      return a.value + (b.value - a.value) * eased;
    }
  }

  return sorted[sorted.length - 1]!.value;
}

export function evaluatePropertyTrack(
  track: PropertyTrack | undefined,
  time: number,
  fallback: number,
): number {
  if (!track?.enabled || track.keys.length === 0) return fallback;
  return evaluateKeyframes(track.keys, time, fallback);
}

export function upsertKeyframe(
  tracks: PropertyTrack[],
  layerId: string,
  paramName: string,
  time: number,
  value: number,
): PropertyTrack[] {
  const next = tracks.map((t) => ({
    ...t,
    keys: t.keys.map((k) => ({ ...k })),
  }));

  let track = findPropertyTrack(next, layerId, paramName);
  if (!track) {
    track = { layerId, paramName, enabled: true, keys: [] };
    next.push(track);
  }

  track.enabled = true;
  const idx = track.keys.findIndex((k) => Math.abs(k.time - time) < 1e-6);
  if (idx >= 0) {
    track.keys[idx] = { ...track.keys[idx]!, value };
  } else {
    track.keys.push({ time, value, ease: "linear" });
    track.keys.sort((a, b) => a.time - b.time);
  }

  return next;
}

export function removeKeyframeAt(
  tracks: PropertyTrack[],
  layerId: string,
  paramName: string,
  time: number,
): PropertyTrack[] {
  const track = findPropertyTrack(tracks, layerId, paramName);
  if (!track) return tracks;

  const keys = track.keys.filter((k) => Math.abs(k.time - time) >= 1e-6);
  if (keys.length === track.keys.length) return tracks;

  return tracks.map((t) =>
    t.layerId === layerId && t.paramName === paramName ? { ...t, keys } : t,
  );
}

export function setTrackEnabled(
  tracks: PropertyTrack[],
  layerId: string,
  paramName: string,
  enabled: boolean,
  seedValue?: number,
  seedTime?: number,
): PropertyTrack[] {
  if (!enabled) {
    return tracks.filter((t) => !(t.layerId === layerId && t.paramName === paramName));
  }

  const existing = findPropertyTrack(tracks, layerId, paramName);
  if (existing) {
    return tracks.map((t) =>
      t.layerId === layerId && t.paramName === paramName ? { ...t, enabled: true } : t,
    );
  }

  const keys: Keyframe[] =
    seedTime != null && seedValue != null
      ? [{ time: seedTime, value: seedValue, ease: "linear" }]
      : [];

  return [...tracks, { layerId, paramName, enabled: true, keys }];
}

export function moveKeyframe(
  tracks: PropertyTrack[],
  layerId: string,
  paramName: string,
  fromTime: number,
  toTime: number,
): PropertyTrack[] {
  const track = findPropertyTrack(tracks, layerId, paramName);
  if (!track) return tracks;

  const idx = track.keys.findIndex((k) => Math.abs(k.time - fromTime) < 1e-6);
  if (idx < 0) return tracks;

  const occupied = track.keys.some(
    (k, i) => i !== idx && Math.abs(k.time - toTime) < 1e-6,
  );
  if (occupied) return tracks;

  return tracks.map((t) => {
    if (t.layerId !== layerId || t.paramName !== paramName) return t;
    const keys = t.keys.map((k) =>
      Math.abs(k.time - fromTime) < 1e-6 ? { ...k, time: toTime } : { ...k },
    );
    keys.sort((a, b) => a.time - b.time);
    return { ...t, keys };
  });
}

export type KeyframeRef = {
  layerId: string;
  paramName: string;
  time: number;
};

/** Move many keys by the same delta (skips moves that would collide). */
export function offsetKeyframes(
  tracks: PropertyTrack[],
  keys: KeyframeRef[],
  deltaTime: number,
): PropertyTrack[] {
  if (Math.abs(deltaTime) < 1e-9 || keys.length === 0) return tracks;

  let next = tracks;
  const sorted =
    deltaTime >= 0
      ? [...keys].sort((a, b) => b.time - a.time)
      : [...keys].sort((a, b) => a.time - b.time);

  for (const key of sorted) {
    next = moveKeyframe(
      next,
      key.layerId,
      key.paramName,
      key.time,
      key.time + deltaTime,
    );
  }

  return next;
}

export function hasKeyframeAt(track: PropertyTrack | undefined, time: number): boolean {
  if (!track) return false;
  return track.keys.some((k) => Math.abs(k.time - time) < 1e-6);
}
