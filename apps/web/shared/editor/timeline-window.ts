/** Math for layer in/out bars overhanging the composition window and zoom-to-fit. */

/** Smallest slice of a bar (seconds) that must stay inside the composition. */
export const MIN_BAR_INSIDE_SECONDS = 0.25;
/** ...or this fraction of the bar, whichever is larger. */
export const MIN_BAR_INSIDE_FRACTION = 0.05;

/**
 * Seconds of a bar that must remain inside [0, duration] so it can always be
 * grabbed and dragged back. Never more than the bar itself.
 */
export function minBarInside(length: number): number {
  return Math.min(
    length,
    Math.max(MIN_BAR_INSIDE_SECONDS, length * MIN_BAR_INSIDE_FRACTION),
  );
}

/**
 * Clamp a moved bar's in-point. The bar may overhang either end of the
 * composition as long as `minBarInside(length)` seconds stay inside.
 */
export function clampBarMoveIn(inPoint: number, length: number, duration: number): number {
  const inside = minBarInside(length);
  const min = inside - length;
  const max = duration - inside;
  return Math.max(min, Math.min(max, inPoint));
}

/**
 * Clamp a shared move delta so every bar in the group keeps its grabbable
 * slice inside the composition. The one delta preserves the group's relative
 * offsets: the whole group stops when any bar hits its limit.
 */
export function clampGroupBarMoveDelta(
  delta: number,
  windows: ReadonlyArray<{ in: number; out: number }>,
  duration: number,
): number {
  let min = Number.NEGATIVE_INFINITY;
  let max = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    const length = w.out - w.in;
    const inside = minBarInside(length);
    min = Math.max(min, inside - length - w.in);
    max = Math.min(max, duration - inside - w.in);
  }
  if (min > max) return 0;
  return Math.max(min, Math.min(max, delta));
}

/**
 * Px-per-second so `duration` exactly fills `availableWidth`, clamped to the
 * zoom bounds. Null when there is nothing sensible to fit to.
 */
export function fitPxPerSecond(
  availableWidth: number,
  duration: number,
  minPxPerSecond: number,
  maxPxPerSecond: number,
): number | null {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(minPxPerSecond, Math.min(maxPxPerSecond, availableWidth / duration));
}

export const MIN_COMPOSITION_DURATION = 1;
export const MAX_COMPOSITION_DURATION = 300;

/** Parse a duration input like "8" or "7,5"; null when not a number. */
export function parseCompositionDuration(text: string): number | null {
  const parsed = Number.parseFloat(text.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_COMPOSITION_DURATION, Math.max(MIN_COMPOSITION_DURATION, parsed));
}
