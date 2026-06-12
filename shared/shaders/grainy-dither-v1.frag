#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;

uniform float softness;
uniform float gain;
uniform float grainSize;
uniform float sampleSpread;
uniform float edgeMin;
uniform float edgeMax;
uniform float seamStrength;
uniform float warpAmount;
uniform float warpFreq;
uniform float lightAmount;
uniform float filmGrain;

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

float blobWeight(vec2 uv, vec2 pos01, float radius, float soft) {
  vec2 p = pointUv(pos01);
  float d = length(uv - p);
  float r = max(radius, 0.02);
  return exp(-pow(d / r, 2.0) * soft * softness);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 domainWarp(vec2 uv) {
  float t = u_time * 0.08;
  vec2 q = vec2(
    sin(uv.y * warpFreq * 1.1 + t),
    sin(uv.x * warpFreq * 0.95 - t * 0.8)
  );
  vec2 r = vec2(
    cos(uv.x * warpFreq * 0.7 + t * 0.5 + q.x),
    sin(uv.y * warpFreq * 0.85 - t * 0.6 + q.y)
  );
  return uv + (q + r * 0.55) * warpAmount;
}

vec3 sampleSmooth(vec2 uv) {
  float w0 = blobWeight(uv, vec2(0.05, 0.05), 1.42, 1.35);
  vec3 c0 = vec3(1.0, 0.5, 3.0) / 255.0;
  float w1 = blobWeight(uv, vec2(0.84, 0.11), 0.78, 0.88);
  vec3 c1 = vec3(168.0, 198.0, 58.0) / 255.0;
  float w2 = blobWeight(uv, vec2(0.9, 0.76), 1.08, 1.02);
  vec3 c2 = vec3(212.0, 82.0, 140.0) / 255.0;
  float w3 = blobWeight(uv, vec2(0.5, 0.94), 0.36, 0.62);
  vec3 c3 = vec3(252.0, 246.0, 226.0) / 255.0;
  float w4 = blobWeight(uv, vec2(0.14, 0.42), 1.05, 1.38);
  vec3 c4 = vec3(10.0, 4.0, 36.0) / 255.0;
  float w5 = blobWeight(uv, vec2(0.4, 0.54), 0.92, 0.98);
  vec3 c5 = vec3(52.0, 34.0, 158.0) / 255.0;

  float wSum = w0 + w1 + w2 + w3 + w4 + w5 + 1e-6;
  return (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4 + c5 * w5) / wSum;
}

void topTwoColors(vec2 uv, out float wA, out vec3 cA, out float wB, out vec3 cB) {
  float w0 = blobWeight(uv, vec2(0.05, 0.05), 1.42, 1.35);
  vec3 c0 = vec3(1.0, 0.5, 3.0) / 255.0;
  float w1 = blobWeight(uv, vec2(0.84, 0.11), 0.78, 0.88);
  vec3 c1 = vec3(168.0, 198.0, 58.0) / 255.0;
  float w2 = blobWeight(uv, vec2(0.9, 0.76), 1.08, 1.02);
  vec3 c2 = vec3(212.0, 82.0, 140.0) / 255.0;
  float w3 = blobWeight(uv, vec2(0.5, 0.94), 0.36, 0.62);
  vec3 c3 = vec3(252.0, 246.0, 226.0) / 255.0;
  float w4 = blobWeight(uv, vec2(0.14, 0.42), 1.05, 1.38);
  vec3 c4 = vec3(10.0, 4.0, 36.0) / 255.0;
  float w5 = blobWeight(uv, vec2(0.4, 0.54), 0.92, 0.98);
  vec3 c5 = vec3(52.0, 34.0, 158.0) / 255.0;

  wA = w0; cA = c0;
  wB = w1; cB = c1;
  if (w1 > wA) { wB = wA; cB = cA; wA = w1; cA = c1; }
  else if (w1 > wB) { wB = w1; cB = c1; }
  if (w2 > wA) { wB = wA; cB = cA; wA = w2; cA = c2; }
  else if (w2 > wB) { wB = w2; cB = c2; }
  if (w3 > wA) { wB = wA; cB = cA; wA = w3; cA = c3; }
  else if (w3 > wB) { wB = w3; cB = c3; }
  if (w4 > wA) { wB = wA; cB = cA; wA = w4; cA = c4; }
  else if (w4 > wB) { wB = w4; cB = c4; }
  if (w5 > wA) { wB = wA; cB = cA; wA = w5; cA = c5; }
  else if (w5 > wB) { wB = w5; cB = c5; }
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv = domainWarp(aspectUv(fragCoord / u_resolution));

  float cell = max(grainSize * u_scale, 1.0);
  vec2 blockCoord = floor(fragCoord / cell);
  vec2 blockCenter = blockCoord * cell + cell * 0.5;
  vec2 p = domainWarp(aspectUv(blockCenter / u_resolution));

  vec2 px = vec2(sampleSpread / u_resolution.x, sampleSpread / u_resolution.y);
  vec3 sC = sampleSmooth(p);
  vec3 sL = sampleSmooth(p - vec2(px.x, 0.0));
  vec3 sR = sampleSmooth(p + vec2(px.x, 0.0));
  vec3 sD = sampleSmooth(p - vec2(0.0, px.y));
  vec3 sU = sampleSmooth(p + vec2(0.0, px.y));

  float edge = max(length(sR - sL), length(sU - sD));
  float seam = smoothstep(edgeMin, edgeMax, edge) * seamStrength;

  float wA; vec3 cA; float wB; vec3 cB;
  topTwoColors(p, wA, cA, wB, cB);

  float t = wA / (wA + wB + 1e-6);
  float xi = hash12(blockCoord);
  vec3 seamColor = xi < t ? cA : cB;

  vec3 color = mix(sC, seamColor, seam);

  if (filmGrain > 0.001) {
    float n = hash12(blockCoord * 1.91 + 3.7);
    color += (n - 0.5) * filmGrain;
  }

  vec2 bloomP = pointUv(vec2(0.84, 0.11));
  vec2 darkP = pointUv(vec2(0.05, 0.05));
  float bloom = exp(-pow(length(uv - bloomP) / 0.62, 2.0) * 1.15);
  float shadow = exp(-pow(length(uv - darkP) / 0.82, 2.0) * 0.95);
  float light = 1.0 + lightAmount * (bloom * 0.36 - shadow * 0.26);
  color *= clamp(light, 0.5, 1.38);
  color *= gain;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
