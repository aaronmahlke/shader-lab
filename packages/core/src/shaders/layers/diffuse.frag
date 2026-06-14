#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_input;
uniform sampler2D u_stbn;
uniform float u_stbnFrame;

uniform float amount;
uniform float grain;
uniform float direction;
uniform float speed;
uniform float seed;

const float STBN_TILE = 128.0;
const float STBN_ATLAS = 1024.0;
const float STBN_COLS = 8.0;

float h21(vec2 p) {
  vec2 s = vec2(seed * 12.9898, seed * 78.233);
  p = fract(p * vec2(123.34, 456.21) + dot(s, vec2(127.1, 311.7)));
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

float noiseAt(vec2 fc, float t) {
  if (speed > 0.001) {
    return sampleStbn(fc + vec2(t * 17.3, t * 31.7));
  }
  return h21(fc + vec2(t * 9.0, t * 13.0));
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / u_resolution;

  vec3 base = texture2D(u_input, uv).rgb;
  float energy = luma(base);

  if (amount < 0.0001) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  float rad = direction * 0.01745329252;
  vec2 dir = vec2(cos(rad), sin(rad));
  float reach = amount * (0.35 + energy * 0.65);

  vec3 accum = vec3(0.0);
  float wSum = 0.0;

  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float t = fi / 11.0 - 0.5;
    float w = 1.0 - abs(t * 2.0);

    float n0 = noiseAt(fc, fi);
    float n1 = noiseAt(fc + vec2(31.0, 17.0), fi + 13.0);
    vec2 jitter = (vec2(n0, n1) - 0.5) * grain * 0.06;

    vec2 offset = dir * t * reach * 0.12 + jitter;
    vec3 s = texture2D(u_input, uv + offset).rgb;

    accum += s * w;
    wSum += w;
  }

  vec3 col = accum / max(wSum, 1e-4);

  float cell = max(1.0, grain * 1.8 + 0.5);
  float g = h21(floor(fc / cell));
  float particulate = mix(1.0, 0.82 + 0.36 * g, grain * smoothstep(0.05, 0.45, energy));
  col *= particulate;

  gl_FragColor = vec4(col, 1.0);
}
