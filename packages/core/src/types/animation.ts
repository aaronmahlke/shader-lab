export type KeyframeEasing = "linear" | "easeOut" | "easeIn" | "easeInOut" | "hold";

/** CSS-style cubic bezier control points: x1, y1, x2, y2 (x clamped to 0..1). */
export type CubicBezierEase = [number, number, number, number];

export type Keyframe = {
  time: number;
  value: number;
  /** Easing from this key toward the next. Ignored on the last key. */
  ease?: KeyframeEasing;
  /** Custom cubic bezier for the outgoing segment. Takes precedence over `ease`. */
  curve?: CubicBezierEase;
};

export type PropertyTrack = {
  layerId: string;
  paramName: string;
  /** Stopwatch enabled — property is animatable and shown in the filtered timeline. */
  enabled: boolean;
  keys: Keyframe[];
};

export type CompositionSettings = {
  duration: number;
  fps: number;
};

export const DEFAULT_COMPOSITION_SETTINGS: CompositionSettings = {
  duration: 5,
  fps: 60,
};
