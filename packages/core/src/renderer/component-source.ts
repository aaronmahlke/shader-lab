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
