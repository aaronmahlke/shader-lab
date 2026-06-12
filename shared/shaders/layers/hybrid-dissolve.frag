#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_scale;
uniform sampler2D u_input;
uniform sampler2D u_stipple;
uniform sampler2D u_stbn;
uniform float u_stbnFrame;

uniform float grainMix;
uniform float seed;
uniform float dissolveSpeed;

const float STBN_TILE = 128.0;
const float STBN_ATLAS = 1024.0;
const float STBN_COLS = 8.0;

float h21(vec2 p) {
  vec2 seedOff = vec2(seed * 12.9898, seed * 78.233);
  p = fract(p * vec2(123.34, 456.21) + dot(seedOff, vec2(127.1, 311.7)));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sampleStbn(vec2 pixelCoord) {
  float frame = mod(floor(u_stbnFrame), 64.0);
  float col = mod(frame, STBN_COLS);
  float row = floor(frame / STBN_COLS);
  vec2 local = mod(pixelCoord, STBN_TILE);
  vec2 atlasUv = (local + vec2(col, row) * STBN_TILE + 0.5) / STBN_ATLAS;
  return texture2D(u_stbn, atlasUv).r;
}

float grainAt(vec2 fc, vec2 offset) {
  if (dissolveSpeed > 0.001) {
    return sampleStbn(fc + offset + seed * 0.37);
  }
  return h21(fc + offset);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / u_resolution;

  vec3 cs = texture2D(u_input, uv).rgb;
  vec3 cd = texture2D(u_stipple, uv).rgb;
  vec3 col = mix(cs, cd, grainMix);

  col *= 0.96 + 0.08 * grainAt(fc * 0.731, vec2(0.0));
  col += (vec3(
    grainAt(fc, vec2(1.0, 0.0)),
    grainAt(fc, vec2(2.0, 0.0)),
    grainAt(fc, vec2(3.0, 0.0))
  ) - 0.5) * 0.03;

  gl_FragColor = vec4(col, 1.0);
}
