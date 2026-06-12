#ifdef GL_ES
precision highp float;
#endif

// Mesh gradient + terrain warp — continuous field for CPU dither.

uniform vec2 u_resolution;
uniform float u_time;

uniform float softness;
uniform float gain;
uniform float warpAmount;
uniform float warpFreq;
uniform float noiseAmount;
uniform float limeStrength;

vec2 aspectUv(vec2 fragUv) {
  vec2 uv = fragUv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;
  return uv;
}

vec2 pointUv(vec2 pos01) {
  vec2 p = pos01 * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  return p;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + 1.7;
    amp *= 0.5;
  }
  return v;
}

vec2 domainWarp(vec2 uv) {
  float t = u_time * 0.04;
  vec2 q = vec2(
    sin(uv.y * warpFreq + t),
    sin(uv.x * warpFreq * 0.9 - t * 0.55)
  );
  return uv + q * warpAmount;
}

float blobWeight(vec2 uv, vec2 pos01, float radius) {
  vec2 p = pointUv(pos01);
  float d = length(uv - p);
  float r = max(radius, 0.02);
  return exp(-pow(d / r, 2.0) * softness);
}

void main() {
  vec2 uv01 = gl_FragCoord.xy / u_resolution;
  vec2 uv = domainWarp(aspectUv(uv01));

  vec3 c0 = vec3(36.0, 32.0, 36.0) / 255.0;
  vec3 c1 = vec3(52.0, 34.0, 158.0) / 255.0;
  vec3 c2 = vec3(224.0, 128.0, 192.0) / 255.0;
  vec3 c3 = vec3(232.0, 198.0, 180.0) / 255.0;
  vec3 c4 = vec3(248.0, 240.0, 232.0) / 255.0;
  vec3 c5 = vec3(168.0, 198.0, 58.0) / 255.0;

  float w0 = blobWeight(uv, vec2(0.06, 0.92), 1.05);
  float w1 = blobWeight(uv, vec2(0.18, 0.48), 1.15);
  float w2 = blobWeight(uv, vec2(0.90, 0.22), 0.95);
  float w3 = blobWeight(uv, vec2(0.58, 0.40), 0.80);
  float w4 = blobWeight(uv, vec2(0.52, 0.06), 0.42);
  float w5 = blobWeight(uv, vec2(0.78, 0.82), 0.72);

  float wSumPre = w0 + w1 + w2 + w3 + w4 + w5 + 1e-5;
  float darkFrac = w0 / wSumPre;
  float brGate = smoothstep(0.38, 0.78, uv01.x) * smoothstep(0.42, 0.80, uv01.y);
  float darkGate = 1.0 - smoothstep(0.08, 0.40, darkFrac);
  w5 *= limeStrength * brGate * darkGate;
  w4 *= 1.0 - smoothstep(0.15, 0.55, darkFrac) * 0.85;

  float wSum = w0 + w1 + w2 + w3 + w4 + w5 + 1e-5;
  vec3 color = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4 + c5 * w5) / wSum;

  float n = fbm(uv * 2.6 + 0.8) - 0.5;
  color += n * noiseAmount;

  color *= gain;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
