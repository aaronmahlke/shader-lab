import type { CubicBezierEase } from "../types/animation";

/**
 * Cubic bezier easing, CSS `cubic-bezier()` semantics: curve through (0,0)
 * and (1,1) with control points (x1,y1), (x2,y2). Given progress `u` on the
 * x axis (time), returns the eased progress on the y axis (value).
 *
 * Newton-Raphson with a bisection fallback, same approach as browsers use.
 */
export function cubicBezierProgress(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  u: number,
): number {
  const x = Math.max(0, Math.min(1, u));
  if (x === 0 || x === 1) return x;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  // Newton-Raphson.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const dx = sampleX(t) - x;
    if (Math.abs(dx) < 1e-7) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= dx / d;
  }

  // Bisection fallback (x(t) is monotonic for x1,x2 in 0..1).
  let lo = 0;
  let hi = 1;
  t = x;
  while (hi - lo > 1e-7) {
    t = (lo + hi) / 2;
    if (sampleX(t) < x) lo = t;
    else hi = t;
  }
  return sampleY(t);
}

/** Evaluate a `CubicBezierEase` tuple at progress `u`. */
export function evaluateCubicBezier(curve: CubicBezierEase, u: number): number {
  return cubicBezierProgress(curve[0], curve[1], curve[2], curve[3], u);
}

export type EasingPreset = {
  id: string;
  label: string;
  curve: CubicBezierEase;
};

/** Flow-style easing presets (standard easings.net control points). */
export const EASING_PRESETS: EasingPreset[] = [
  { id: "cubicIn", label: "Cubic In", curve: [0.32, 0, 0.67, 0] },
  { id: "cubicOut", label: "Cubic Out", curve: [0.33, 1, 0.68, 1] },
  { id: "cubicInOut", label: "Cubic In Out", curve: [0.65, 0, 0.35, 1] },
  { id: "expoIn", label: "Expo In", curve: [0.7, 0, 0.84, 0] },
  { id: "expoOut", label: "Expo Out", curve: [0.16, 1, 0.3, 1] },
  { id: "expoInOut", label: "Expo In Out", curve: [0.87, 0, 0.13, 1] },
  { id: "circIn", label: "Circ In", curve: [0.55, 0, 1, 0.45] },
  { id: "circOut", label: "Circ Out", curve: [0, 0.55, 0.45, 1] },
  { id: "circInOut", label: "Circ In Out", curve: [0.85, 0, 0.15, 1] },
  { id: "backIn", label: "Back In", curve: [0.36, 0, 0.66, -0.56] },
  { id: "backOut", label: "Back Out", curve: [0.34, 1.56, 0.64, 1] },
  { id: "backInOut", label: "Back In Out", curve: [0.68, -0.6, 0.32, 1.6] },
];

export function findEasingPreset(id: string): EasingPreset | undefined {
  return EASING_PRESETS.find((preset) => preset.id === id);
}

/** Preset id matching a keyframe's curve, if any (used to check menu items). */
export function matchEasingPreset(curve: CubicBezierEase | undefined): string | undefined {
  if (!curve) return undefined;
  return EASING_PRESETS.find((preset) =>
    preset.curve.every((c, i) => Math.abs(c - curve[i]!) < 1e-9),
  )?.id;
}
