export type KeyframeEasing = "linear" | "easeOut" | "easeIn" | "easeInOut" | "hold";

export type Keyframe = {
  time: number;
  value: number;
  /** Easing from this key toward the next. Ignored on the last key. */
  ease?: KeyframeEasing;
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
