#ifdef GL_ES
precision highp float;
#endif

// Height-field terraces: palette bands from scalar h(uv).
// Boundaries get stochastic two-color stipple (hash), not Bayer.

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
uniform float seamStrength;
uniform float limeStrength;
uniform float gain;

const int BAND_COUNT = 5;

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

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv01 = fragCoord / u_resolution;

  float h = sampleHeight(uv01);

  float bounds[4];
  bounds[0] = 0.18;
  bounds[1] = 0.34;
  bounds[2] = 0.5;
  bounds[3] = 0.66;

  vec3 palette[BAND_COUNT];
  palette[0] = vec3(10.0, 4.0, 36.0) / 255.0;
  palette[1] = vec3(52.0, 34.0, 158.0) / 255.0;
  palette[2] = vec3(212.0, 82.0, 140.0) / 255.0;
  palette[3] = vec3(180.0, 72.0, 128.0) / 255.0;
  palette[4] = vec3(252.0, 246.0, 226.0) / 255.0;

  int band = BAND_COUNT - 1;
  if (h < bounds[0]) band = 0;
  else if (h < bounds[1]) band = 1;
  else if (h < bounds[2]) band = 2;
  else if (h < bounds[3]) band = 3;

  float fog = smoothstep(0.5, 0.98, uv01.y);
  float spread = mix(spreadTight, spreadWide, fog);

  float nearest = 1.0;
  int seamK = 0;
  for (int i = 0; i < 4; i++) {
    float d = abs(h - bounds[i]);
    if (d < nearest) {
      nearest = d;
      seamK = i;
    }
  }

  vec3 cLo = palette[seamK];
  vec3 cHi = palette[seamK + 1];
  float t = smoothstep(bounds[seamK] - spread, bounds[seamK] + spread, h);
  float seam = (1.0 - smoothstep(0.0, spread, nearest)) * seamStrength;

  float xi = hash22(fragCoord + hash12(floor(fragCoord * 0.37)));
  vec3 stipple = xi < t ? cLo : cHi;
  vec3 interior = palette[band];

  vec3 color = mix(interior, stipple, seam);

  vec2 w = domainWarp(aspectUv(uv01));
  float limeMask = exp(-pow(length(w - pointUv(vec2(0.88, 0.13))) / 0.28, 2.0));
  vec3 cLime = vec3(168.0, 198.0, 58.0) / 255.0;
  float limeSeam = limeMask * limeStrength;
  float xiLime = hash22(fragCoord * 1.13 + 7.1);
  vec3 limePick = xiLime < 0.55 ? cLime : palette[2];
  color = mix(color, limePick, limeSeam * smoothstep(0.08, 0.35, limeMask));

  color *= gain;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
