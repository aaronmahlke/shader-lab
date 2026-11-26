#ifdef GL_ES
precision mediump float;
#endif

// Blits a host-captured component texture (live DOM capture) into the layer
// FBO, centered at its layout size in buffer px. Everything outside the
// content rect stays transparent so the composite pass treats the result as a
// coverage mask, exactly like any other generator.
// The capture is uploaded top-down; gl uv space is y-up, so flip v.

uniform vec2 u_resolution;
uniform vec4 u_window; // layer-UV rect held by this buffer; (0,0,1,1) = whole layer
uniform sampler2D u_layerTexture;
// Draw size in buffer px: the element's CSS size × content scale. Decoupled
// from the texture's own pixel size so supersampled captures just minify.
uniform vec2 u_contentSize;
// 0 until the host pushes a first frame — render transparent, never black.
uniform int u_hasTexture;

void main() {
  if (u_hasTexture == 0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Content window: this buffer holds layer-UV rect u_window (x0, y0, w, h),
  // so zoomed-in layers spend every buffer pixel on the visible part.
  vec2 fc = (u_window.xy + (gl_FragCoord.xy / u_resolution) * u_window.zw) * u_resolution;
  vec2 p = fc - 0.5 * u_resolution;
  vec2 uv = (p + 0.5 * u_contentSize) / u_contentSize;

  // 1-buffer-px anti-aliased coverage at the content rect edges; CLAMP_TO_EDGE
  // keeps the partially covered fringe sampling valid texels.
  vec2 aa = u_window.zw / u_contentSize;
  vec2 inside = smoothstep(vec2(0.0), aa, uv) * smoothstep(vec2(0.0), aa, 1.0 - uv);
  float coverage = inside.x * inside.y;

  // Sample BEFORE any early-out: mip level selection uses screen-space
  // derivatives across 2x2 pixel quads, which are undefined in divergent
  // control flow. Sampling inside the branch picked garbage LODs along the
  // rect edge — a faint 1 px line (the whole texture's average) at its border.
  vec4 content = texture2D(u_layerTexture, clamp(vec2(uv.x, 1.0 - uv.y), 0.0, 1.0));
  if (coverage <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(content.rgb, content.a * coverage);
}
