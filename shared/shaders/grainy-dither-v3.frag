#ifdef GL_ES
precision highp float;
#endif

// v3: multi-color stipple grain on terrain field.
// Variable grain via jittered sample offset (not block cells).

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;

uniform float terrainScale;
uniform float basinDepth;
uniform float ridgeAmount;
uniform float warpAmount;
uniform float warpFreq;
uniform float noiseAmount;
uniform float spreadTight;
uniform float spreadWide;
uniform float grainStrength;
uniform float grainSize;
uniform float grainSizeVar;
uniform float colorJitter;
uniform float limeStrength;
uniform float limeRadius;
uniform float gain;

const int PALETTE_SIZE = 6;

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

float hash22(vec2 p) {
  return hash12(p + hash12(p * 1.73));
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + 1.7;
    amp *= 0.5;
  }
  return v;
}

vec2 domainWarp(vec2 uv) {
  float t = u_time * 0.05;
  vec2 q = vec2(
    sin(uv.y * warpFreq + t),
    sin(uv.x * warpFreq * 0.93 - t * 0.7)
  );
  return uv + q * warpAmount;
}

float sampleHeight(vec2 uv01) {
  vec2 w = domainWarp(aspectUv(uv01));
  float h = uv01.y * 0.28 + uv01.x * 0.2;
  h += 0.12 * dot(normalize(vec2(0.72, 0.55)), w);

  float basin = exp(-pow(length(w - pointUv(vec2(0.07, 0.08))) / 0.55, 2.0));
  h -= basin * basinDepth;

  vec2 ridgeDir = normalize(vec2(0.8, 0.45));
  float ridge = dot(w - pointUv(vec2(-0.25, -0.32)), ridgeDir);
  h += smoothstep(-0.05, 0.55, ridge) * (1.0 - smoothstep(0.45, 1.0, ridge)) * ridgeAmount;

  float pinkHill = exp(-pow(length(w - pointUv(vec2(0.78, 0.62))) / 0.5, 2.0));
  h += pinkHill * 0.22;

  h += (fbm(w * 1.35) - 0.5) * noiseAmount;
  h += (fbm(w * 3.1 + 2.0) - 0.5) * noiseAmount * 0.35;
  return clamp(h * terrainScale, 0.0, 1.0);
}

float bandWeight(float h, float lo, float hi, float soft) {
  return smoothstep(lo - soft, lo + soft, h) * (1.0 - smoothstep(hi - soft, hi + soft, h));
}

void insertTop3(float w, vec3 c, inout float wA, inout vec3 cA, inout float wB, inout vec3 cB, inout float wC, inout vec3 cC) {
  if (w > wA) {
    wC = wB; cC = cB;
    wB = wA; cB = cA;
    wA = w; cA = c;
  } else if (w > wB) {
    wC = wB; cC = cB;
    wB = w; cB = c;
  } else if (w > wC) {
    wC = w; cC = c;
  }
}

vec3 jitterColor(vec3 c, vec2 seed, float amount) {
  vec3 n = vec3(
    hash22(seed),
    hash22(seed + 1.91),
    hash22(seed + 3.17)
  );
  return clamp(c + (n - 0.5) * amount, 0.0, 1.0);
}

vec3 pickWeighted3(float wA, vec3 cA, float wB, vec3 cB, float wC, vec3 cC, float r, float jitter) {
  float sum = wA + wB + wC + 1e-5;
  float t = r * sum;
  vec3 pick;
  vec2 seed;
  if (t < wA) {
    pick = cA;
    seed = vec2(r, 0.2);
  } else if (t < wA + wB) {
    pick = cB;
    seed = vec2(r, 1.4);
  } else {
    pick = cC;
    seed = vec2(r, 2.6);
  }
  return jitterColor(pick, seed, jitter);
}

void regionWeights(vec2 uv01, out float dispersion, out float wA, out vec3 cA, out float wB, out vec3 cB, out float wC, out vec3 cC) {
  float h = sampleHeight(uv01);

  float bounds[4];
  bounds[0] = 0.18;
  bounds[1] = 0.34;
  bounds[2] = 0.5;
  bounds[3] = 0.66;

  float fog = smoothstep(0.5, 0.98, uv01.y);
  float spread = mix(spreadTight, spreadWide, fog);

  float nearest = 1.0;
  for (int i = 0; i < 4; i++) {
    nearest = min(nearest, abs(h - bounds[i]));
  }
  dispersion = 1.0 - smoothstep(0.0, spread * 1.35, nearest);

  vec3 palette[PALETTE_SIZE];
  palette[0] = vec3(36.0, 32.0, 36.0) / 255.0;
  palette[1] = vec3(52.0, 34.0, 158.0) / 255.0;
  palette[2] = vec3(224.0, 128.0, 192.0) / 255.0;
  palette[3] = vec3(232.0, 198.0, 180.0) / 255.0;
  palette[4] = vec3(248.0, 240.0, 232.0) / 255.0;
  palette[5] = vec3(168.0, 198.0, 58.0) / 255.0;

  float soft = spread * 0.85;
  float w0 = 1.0 - smoothstep(bounds[0] - soft, bounds[0] + soft, h);
  float w1 = bandWeight(h, bounds[0], bounds[1], soft);
  float w2 = bandWeight(h, bounds[1], bounds[2], soft);
  float w3 = bandWeight(h, bounds[2], bounds[3], soft);
  float w4 = smoothstep(bounds[3] - soft, bounds[3] + soft, h);

  float darkSuppress = smoothstep(0.12, 0.58, w0);
  w3 *= 1.0 - darkSuppress * 0.96;
  w4 *= 1.0 - darkSuppress * 0.98;
  w2 *= 1.0 - darkSuppress * 0.35;

  vec2 wuv = domainWarp(aspectUv(uv01));
  float r = max(limeRadius, 0.08);
  float limeDist = length(wuv - pointUv(vec2(0.88, 0.13)));
  float limeCore = exp(-pow(limeDist / r, 2.0) * 3.2);
  float brGate = smoothstep(0.42, 0.82, uv01.x) * smoothstep(0.38, 0.78, 1.0 - uv01.y);
  float darkGate = 1.0 - smoothstep(0.12, 0.55, w0);
  float w5 = pow(limeCore, 2.2) * limeStrength * brGate * darkGate;

  wA = 0.0; cA = vec3(0.0);
  wB = 0.0; cB = vec3(0.0);
  wC = 0.0; cC = vec3(0.0);
  insertTop3(w0, palette[0], wA, cA, wB, cB, wC, cC);
  insertTop3(w1, palette[1], wA, cA, wB, cB, wC, cC);
  insertTop3(w2, palette[2], wA, cA, wB, cB, wC, cC);
  insertTop3(w3, palette[3], wA, cA, wB, cB, wC, cC);
  insertTop3(w4, palette[4], wA, cA, wB, cB, wC, cC);
  if (w5 > 0.02) {
    insertTop3(w5, palette[5], wA, cA, wB, cB, wC, cC);
  }
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv01 = fragCoord / u_resolution;
  vec2 wuv = domainWarp(aspectUv(uv01));

  float dispersionFine;
  float wAf; vec3 cAf;
  float wBf; vec3 cBf;
  float wCf; vec3 cCf;
  regionWeights(uv01, dispersionFine, wAf, cAf, wBf, cBf, wCf, cCf);

  float varField = fbm(wuv * 1.35 + 2.0) * grainSizeVar + dispersionFine * (1.0 - grainSizeVar);
  float gSize = grainSize * (0.55 + varField * 1.1);
  vec2 jitter = (vec2(hash22(fragCoord * 0.71), hash22(fragCoord * 0.71 + 19.0)) - 0.5) * gSize;
  vec2 uvCoarse = clamp((fragCoord + jitter) / u_resolution, 0.001, 0.999);

  float dispersionCoarse;
  float wAc; vec3 cAc;
  float wBc; vec3 cBc;
  float wCc; vec3 cCc;
  regionWeights(uvCoarse, dispersionCoarse, wAc, cAc, wBc, cBc, wCc, cCc);

  float rFine = hash22(fragCoord + 0.31);
  float rCoarse = hash22(fragCoord + 13.7);
  float floorFine = dispersionFine * 0.06 * grainStrength;
  float floorCoarse = dispersionCoarse * 0.1 * grainStrength;

  vec3 fine = pickWeighted3(
    max(wAf, floorFine * 0.4), cAf,
    max(wBf, floorFine), cBf,
    max(wCf, floorFine), cCf,
    rFine, colorJitter
  );
  vec3 coarse = pickWeighted3(
    max(wAc, floorCoarse * 0.4), cAc,
    max(wBc, floorCoarse), cBc,
    max(wCc, floorCoarse), cCc,
    rCoarse, colorJitter * 1.15
  );

  float coarseMix = smoothstep(0.6, 2.0, gSize) * (0.55 + dispersionFine * 0.4);
  vec3 color = mix(fine, coarse, coarseMix * grainStrength);
  color *= gain;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
