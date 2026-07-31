#ifdef GL_ES
precision mediump float;
#endif

// Blits an externally rasterized layer texture (text) into the layer FBO.
// The texture is uploaded top-down; gl uv space is y-up, so flip v.

uniform vec2 u_resolution;
uniform sampler2D u_layerTexture;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = texture2D(u_layerTexture, vec2(uv.x, 1.0 - uv.y));
}
