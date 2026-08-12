#ifdef GL_ES
precision highp float;
#endif

// Bloom downsample: 13-tap filter over the previous (larger) level.
// Standard technique (Jimenez, "Next Generation Post Processing", 2014);
// the overlapping taps kill the fireflies a plain box average leaves behind.

uniform vec2 u_resolution;   // this target's size
uniform vec2 u_inputSize;    // previous level's size
uniform sampler2D u_input;

vec3 S(vec2 uv) {
  return texture2D(u_input, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 t = 1.0 / u_inputSize;

  vec3 a = S(uv + t * vec2(-2.0,  2.0));
  vec3 b = S(uv + t * vec2( 0.0,  2.0));
  vec3 c = S(uv + t * vec2( 2.0,  2.0));
  vec3 d = S(uv + t * vec2(-2.0,  0.0));
  vec3 e = S(uv);
  vec3 f = S(uv + t * vec2( 2.0,  0.0));
  vec3 g = S(uv + t * vec2(-2.0, -2.0));
  vec3 h = S(uv + t * vec2( 0.0, -2.0));
  vec3 i = S(uv + t * vec2( 2.0, -2.0));
  vec3 j = S(uv + t * vec2(-1.0,  1.0));
  vec3 k = S(uv + t * vec2( 1.0,  1.0));
  vec3 l = S(uv + t * vec2(-1.0, -1.0));
  vec3 m = S(uv + t * vec2( 1.0, -1.0));

  vec3 result = e * 0.125
    + (a + c + g + i) * 0.03125
    + (b + d + f + h) * 0.0625
    + (j + k + l + m) * 0.125;

  gl_FragColor = vec4(result, 1.0);
}
