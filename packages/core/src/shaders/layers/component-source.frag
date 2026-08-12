#ifdef GL_ES
precision mediump float;
#endif

// Blits a host-captured component texture (live DOM capture) into the layer
// FBO, centered at its layout size in buffer px. Everything outside the
// content rect stays transparent so the composite pass treats the result as a
// coverage mask, exactly like any other generator.
// The capture is uploaded top-down; gl uv space is y-up, so flip v.

uniform vec2 u_resolution;
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

  vec2 p = gl_FragCoord.xy - 0.5 * u_resolution;
  vec2 uv = (p + 0.5 * u_contentSize) / u_contentSize;

  // 1-buffer-px anti-aliased coverage at the content rect edges; CLAMP_TO_EDGE
  // keeps the partially covered fringe sampling valid texels.
  vec2 aa = 1.0 / u_contentSize;
  vec2 inside = smoothstep(vec2(0.0), aa, uv) * smoothstep(vec2(0.0), aa, 1.0 - uv);
  float coverage = inside.x * inside.y;
  if (coverage <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec4 content = texture2D(u_layerTexture, vec2(uv.x, 1.0 - uv.y));
  gl_FragColor = vec4(content.rgb, content.a * coverage);
}
