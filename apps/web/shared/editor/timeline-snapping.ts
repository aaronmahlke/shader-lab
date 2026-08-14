/**
 * Edge snapping for timeline bar drags, mirroring the canvas gizmo snapping:
 * dragged bar edges lock onto the composition bounds, the playhead, and the
 * in/out points of other layers when within a small pixel radius.
 */
import { findSnap } from "./snapping";

/** Same pixel radius and guide color as the canvas gizmos. */
export const TIMELINE_SNAP_THRESHOLD_PX = 6;
export const TIMELINE_GUIDE_COLOR = "#FF5D8F";

export type TimelineWindow = { in: number; out: number };

/**
 * Times a dragged edge can lock onto: composition start/end, the playhead,
 * and the in/out points of every layer that is not being dragged.
 */
export function collectBarSnapTargets(
  windows: ReadonlyArray<{ id: string } & TimelineWindow>,
  excludeIds: ReadonlySet<string>,
  duration: number,
  playhead: number,
): number[] {
  const targets = [0, duration, playhead];
  for (const w of windows) {
    if (excludeIds.has(w.id)) continue;
    targets.push(w.in, w.out);
  }
  return targets;
}

/**
 * Snap a group-move delta so the moved edge closest to a target lands on it.
 * All bars share one delta, so any of the group's edges may trigger the snap.
 * Returns the guide time for drawing, or null when nothing is in range.
 */
export function snapBarMoveDelta(
  delta: number,
  windows: ReadonlyArray<TimelineWindow>,
  targets: number[],
  threshold: number,
): { delta: number; guide: number | null } {
  const candidates: number[] = [];
  for (const w of windows) candidates.push(w.in + delta, w.out + delta);
  const hit = findSnap(candidates, targets, threshold);
  if (!hit) return { delta, guide: null };
  return { delta: delta + hit.delta, guide: hit.target };
}

/** Snap a single trimmed edge onto the nearest target in range. */
export function snapEdgeTime(
  time: number,
  targets: number[],
  threshold: number,
): { time: number; guide: number | null } {
  const hit = findSnap([time], targets, threshold);
  if (!hit) return { time, guide: null };
  return { time: hit.target, guide: hit.target };
}
