#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform sampler2D u_input;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = texture2D(u_input, uv);
}
