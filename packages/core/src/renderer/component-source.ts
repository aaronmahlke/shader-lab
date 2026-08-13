/**
 * Component layer sources.
 *
 * A component layer renders a texture that the host app captures from a live
 * DOM element (or any raster source) and pushes into the renderer. Core stays
 * synchronous and environment-agnostic: capture is async and browser-only, so
 * it lives with the host. The renderer only ever reads "the latest frame for
 * layer X" and re-uploads when the version changes.
 *
 * Without a pushed source the layer renders fully transparent — never black —
 * so headless exports (OG images, `renderCompositionToBuffer`) degrade to an
 * invisible layer instead of a wrong one.
 */

/** A frame pushed by the host: a DOM texture source (browser) or raw RGBA pixels (node/tests). */
export type ComponentSourceFrame =
  | TexImageSource
  | { width: number; height: number; data: Uint8Array };

/** What the host pushes per layer via `CompositionRenderer.setComponentSource`. */
export type ComponentSourceInput = {
  frame: ComponentSourceFrame;
  /**
   * Layout size of the captured element in composition px. The frame itself is
   * usually supersampled (capture scale × devicePixelRatio-independent), so the
   * renderer draws it at this size, not the frame's pixel size.
   */
  cssWidth: number;
  cssHeight: number;
};

/** Stored source; `version` bumps on every push so uploads happen only on change. */
export type ComponentSource = ComponentSourceInput & { version: number };

/** The component a layer stages, as stored in `layer.values`. */
export function componentNameFromValues(values: Record<string, unknown>): string {
  return typeof values.componentName === "string" ? values.componentName : "";
}

/** Layout width (CSS px) the host should give the staged element. */
export function componentStageWidthFromValues(values: Record<string, unknown>): number {
  return typeof values.stageWidth === "number" ? values.stageWidth : 640;
}

// --- Media layer sources (image / video) -----------------------------------
//
// Image and video layers follow the exact same push model as components: the
// host loads/decodes the media (async, environment-specific) and pushes the
// latest frame per layer via `CompositionRenderer.setMediaSource`. Without a
// pushed source the layer renders fully transparent — never black.

/** A media frame pushed by the host: a DOM texture source (browser) or raw RGBA pixels (node/tests). */
export type MediaSourceFrame =
  | TexImageSource
  | { width: number; height: number; data: Uint8Array };

/** What the host pushes per layer via `CompositionRenderer.setMediaSource`. */
export type MediaSource = {
  source: MediaSourceFrame;
  /**
   * Uncropped display size in composition px. Decoupled from the frame's own
   * pixel size so hi-res sources just minify; crops shrink it in-shader.
   */
  width: number;
  height: number;
  /** Host bumps this on every new frame (each decoded video frame); uploads happen only on change. */
  version: number;
};

/** The media a layer shows, as stored in `layer.values` (the host resolves and decodes it). */
export function mediaSrcFromValues(values: Record<string, unknown>): string {
  return typeof values.src === "string" ? values.src : "";
}

/** Whether a video layer's host-side playback should loop. */
export function videoLoopFromValues(values: Record<string, unknown>): boolean {
  return typeof values.loop === "boolean" ? values.loop : true;
}

/** Seconds into the video the host should start playback from. */
export function videoTrimStartFromValues(values: Record<string, unknown>): number {
  return typeof values.trimStart === "number" ? values.trimStart : 0;
}
