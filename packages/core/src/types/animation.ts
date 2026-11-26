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
  /** Composition size in pixels — the artboard in the editor and the export base. */
  width: number;
  height: number;
  /** Camera-style motion blur: average sub-frame renders across the shutter. */
  motionBlur?: boolean;
  /** Shutter angle in degrees (180 = half the frame interval, AE default). */
  shutterAngle?: number;
  /** Sub-frame renders per frame (cost multiplier). */
  motionBlurSamples?: number;
  /** Musical grid: tempo (0/unset = off), time of a downbeat, beats per bar. */
  bpm?: number;
  bpmOffset?: number;
  beatsPerBar?: number;
  /** Master bus level in dB (mixer). */
  masterVolume?: number;
  /** Master bus effect chain (automate via `fx:<id>:<param>` tracks on layer id "master"). */
  masterEffects?: { id: string; type: string; enabled?: boolean; params: Record<string, number>; source?: string }[];
  /** Named moments on the timeline ("drop", "payoff"); read by the events API. */
  markers?: { time: number; name: string }[];
  /** Comp props: settings of inner layers that precomp layers can set per instance. */
  props?: import("../compiler/comp-props").CompProp[];
};

export const DEFAULT_COMPOSITION_SETTINGS: CompositionSettings = {
  duration: 5,
  fps: 60,
  width: 1920,
  height: 1080,
};
