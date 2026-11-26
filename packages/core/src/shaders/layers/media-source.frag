#ifdef GL_ES
precision mediump float;
#endif

// Blits a host-pushed media frame (image or video) into the layer FBO,
// centered at its display size in buffer px, with per-edge cropping.
// Everything outside the (cropped) content rect stays transparent so the
// composite pass treats the result as a coverage mask, exactly like any other
// generator.
// The frame is uploaded top-down; gl uv space is y-up, so flip v.

uniform vec2 u_resolution;
uniform vec4 u_window; // layer-UV rect held by this buffer; (0,0,1,1) = whole layer
uniform sampler2D u_layerTexture;
// Uncropped draw size in buffer px: the media's display size × content scale.
// Decoupled from the texture's own pixel size so hi-res sources just minify.
uniform vec2 u_contentSize;
// 0 until the host pushes a first frame — render transparent, never black.
uniform int u_hasTexture;
// Per-edge crops as fractions of the media (0 … 0.45). Cropping shrinks the
// displayed rect and remaps sampling to the kept texture window.
uniform float cropLeft;
uniform float cropRight;
uniform float cropTop;
uniform float cropBottom;

void main() {
  if (u_hasTexture == 0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // The displayed rect shrinks by the cropped fractions. Clamp so degenerate
  // crop sums (>= 1) can't collapse the rect to zero and divide by it.
  vec2 keep = vec2(1.0 - cropLeft - cropRight, 1.0 - cropTop - cropBottom);
  vec2 displayedSize = max(u_contentSize * keep, vec2(1e-3));

  // Content window: this buffer holds layer-UV rect u_window (x0, y0, w, h),
  // so zoomed-in layers spend every buffer pixel on the visible part.
  vec2 fc = (u_window.xy + (gl_FragCoord.xy / u_resolution) * u_window.zw) * u_resolution;
  vec2 p = fc - 0.5 * u_resolution;
  vec2 uv = (p + 0.5 * displayedSize) / displayedSize;

  // 1-buffer-px anti-aliased coverage at the content rect edges; CLAMP_TO_EDGE
  // keeps the partially covered fringe sampling valid texels.
  vec2 aa = u_window.zw / displayedSize;
  vec2 inside = smoothstep(vec2(0.0), aa, uv) * smoothstep(vec2(0.0), aa, 1.0 - uv);
  float coverage = inside.x * inside.y;
  // Remap into the kept texture window [cropLeft .. 1-cropRight] ×
  // [cropTop .. 1-cropBottom]. The texture is stored top-down (v = 0 is the
  // media's top row) while uv.y is y-up, so v runs from 1-cropBottom at the
  // rect's bottom to cropTop at its top — cropTop trims the visual top.
  float u = mix(cropLeft, 1.0 - cropRight, uv.x);
  float v = mix(1.0 - cropBottom, cropTop, uv.y);

  // Sampled in uniform control flow (see component-source.frag): an early-out
  // before the fetch broke mip selection along the rect edge (1 px line).
  vec4 content = texture2D(u_layerTexture, clamp(vec2(u, v), 0.0, 1.0));
  if (coverage <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(content.rgb, content.a * coverage);
}
