#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_scale;
uniform sampler2D u_input;
uniform sampler2D u_stipple;

uniform float grainMix;
uniform float dotSize;
uniform float seed;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + seed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / u_resolution;

  vec3 cs = texture2D(u_input, uv).rgb;
  vec3 cd = texture2D(u_stipple, uv).rgb;
  vec3 col = mix(cs, cd, grainMix);

  col *= 0.96 + 0.08 * h21(fc * 0.731);
  col += (vec3(h21(fc + 1.0), h21(fc + 2.0), h21(fc + 3.0)) - 0.5) * 0.03;

  gl_FragColor = vec4(col, 1.0);
}
