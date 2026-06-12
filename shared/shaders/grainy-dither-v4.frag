#ifdef GL_ES
precision highp float;
#endif

// Top: dissolved two-band bg. Bottom: six stacked sine cycles.

uniform vec2 u_resolution;
uniform float u_grainMix;
uniform float u_edge;
uniform float u_dissolveReach;
uniform float u_edgeBg;
uniform float u_edgePale;
uniform float u_edgeLime;
uniform float u_edgeBlue;
uniform float u_edgeBlack;
uniform float u_edgeBlue2;
uniform float u_edgeBlack2;
uniform float u_dot;
uniform float u_seed;

uniform float u_bgBandY;

uniform float u_paleBase;
uniform float u_paleAmp;
uniform float u_paleFreq;
uniform float u_palePhase;

uniform float u_limeBase;
uniform float u_limeAmp;
uniform float u_limeFreq;
uniform float u_limePhase;

uniform float u_blueBase;
uniform float u_blueAmp;
uniform float u_blueFreq;
uniform float u_bluePhase;

uniform float u_blackBase;
uniform float u_blackAmp;
uniform float u_blackFreq;
uniform float u_blackPhase;

uniform float u_blue2Base;
uniform float u_blue2Amp;
uniform float u_blue2Freq;
uniform float u_blue2Phase;

uniform float u_black2Base;
uniform float u_black2Amp;
uniform float u_black2Freq;
uniform float u_black2Phase;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + u_seed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
    mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fine(vec2 fc, float k) {
  vec2 o = vec2(k * 31.7, k * 57.3);
  float n1 = h21(floor((fc + o) / u_dot));
  float n2 = h21(floor((fc + o) / (u_dot * 2.0)) + 9.0);
  float n = n1 * 0.8 + n2 * 0.2;
  n += (vnoise((fc + o) / 70.0) - 0.5) * 0.12;
  return clamp(n, 0.0, 1.0);
}

float shapeAt(float m, float edgeScale) {
  float e = u_edge * edgeScale;
  return smoothstep(0.5 - e, 0.5 + e, m);
}

float seamSoft(float edgeScale) {
  return u_edge * edgeScale;
}

const float TAU = 6.2831853;
const float HALF_PI = 1.57079632;

// One sine cycle (−1 → +1 → −1), then flat shelves at −1 on both sides.
// cycleX = center of the cycle in [0,1], cycleWidth = span of one cycle in [0,1].
float oneCycleWithShelves(float x, float cycleX, float cycleWidth) {
  float halfW = max(cycleWidth * 0.5, 0.001);
  float x0 = cycleX - halfW;
  float x1 = cycleX + halfW;

  if (x < x0 || x > x1) return -1.0;

  float u = (x - x0) / (x1 - x0);
  float angle = -HALF_PI + TAU * u;
  return sin(angle);
}

float bumpLine(float x, float centerY, float amp, float cycleWidth, float cycleX) {
  return centerY + amp * oneCycleWithShelves(x, cycleX, cycleWidth);
}

float coverageMask(float lineY, float py, float edgeScale, float reach) {
  float soft = seamSoft(edgeScale) * reach;
  return smoothstep(lineY + soft, lineY - soft, py);
}

// Smooth geometric edge (red line) vs wider dissolve falloff (green grain zone).
vec2 layerMasks(float x, float py, float centerY, float amp, float cycleWidth, float cycleX, float edgeScale) {
  float lineY = bumpLine(x, centerY, amp, cycleWidth, cycleX);
  float mSmooth = shapeAt(coverageMask(lineY, py, edgeScale, 1.0), edgeScale);
  float mDissolve = coverageMask(lineY, py, edgeScale, u_dissolveReach);
  return vec2(mSmooth, mDissolve);
}

float stippleReveal(vec2 fc, float k, float mDissolve, float edgeScale) {
  return step(fine(fc, k), shapeAt(mDissolve, edgeScale));
}

// Internal gradients per shape (reference uses color fields, not flat fills).
vec3 bgBeige(vec2 p) {
  return mix(vec3(0.98, 0.97, 0.86), vec3(0.95, 0.93, 0.71), smoothstep(0.45, 1.0, p.y));
}

vec3 bgPink(vec2 p) {
  return mix(vec3(0.98, 0.72, 0.92), vec3(0.86, 0.42, 0.76), smoothstep(0.3, 0.95, p.y));
}

vec3 paleColor(vec2 p) {
  float t = smoothstep(0.15, 0.9, p.y);
  return mix(vec3(0.99, 0.98, 0.93), vec3(0.93, 0.90, 0.76), t);
}

vec3 limeColor(vec2 p) {
  float glow = smoothstep(0.15, 0.85, p.x) * smoothstep(0.95, 0.25, p.y);
  return mix(vec3(0.76, 0.84, 0.42), vec3(0.93, 0.97, 0.64), glow);
}

vec3 blueColor(vec2 p) {
  float gx = smoothstep(0.0, 1.0, p.x);
  float gy = smoothstep(0.15, 0.9, 1.0 - p.y);
  vec3 deep = vec3(0.12, 0.10, 0.58);
  vec3 bright = vec3(0.50, 0.40, 0.94);
  return mix(mix(deep, bright, gx), vec3(0.34, 0.28, 0.84), gy * 0.45);
}

vec3 blackColor(vec2 p) {
  float t = clamp(p.y * 0.7 + p.x * 0.35, 0.0, 1.0);
  return mix(vec3(0.10, 0.08, 0.09), vec3(0.22, 0.18, 0.17), smoothstep(0.0, 1.0, t));
}

vec3 blue2Color(vec2 p) {
  return mix(vec3(0.16, 0.14, 0.52), vec3(0.38, 0.32, 0.80), smoothstep(0.0, 1.0, p.x + (1.0 - p.y) * 0.25));
}

vec3 black2Color(vec2 p) {
  float t = smoothstep(0.0, 1.0, p.y * 0.85 + p.x * 0.2);
  return mix(vec3(0.14, 0.11, 0.12), vec3(0.26, 0.21, 0.20), t);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 p = fc / u_resolution;

  // --- Top: two bands with internal gradients ---
  float mPinkBg = shapeAt(coverageMask(u_bgBandY, p.y, u_edgeBg, 1.0), u_edgeBg);
  float mPinkBgD = coverageMask(u_bgBandY, p.y, u_edgeBg, u_dissolveReach);
  vec3 beigeAt = bgBeige(p);
  vec3 pinkAt = bgPink(p);

  vec3 cs = mix(beigeAt, pinkAt, mPinkBg);
  vec3 cd = mix(beigeAt, pinkAt, stippleReveal(fc, 1.0, mPinkBgD, u_edgeBg));

  // --- Bottom stack (back → front): blue → pale → black → lime → blue2 → black2 ---
  vec2 mBlue = layerMasks(p.x, p.y, u_blueBase, u_blueAmp, u_blueFreq, u_bluePhase, u_edgeBlue);
  vec3 blueAt = blueColor(p);
  cs = mix(cs, blueAt, mBlue.x);
  cd = mix(cd, blueAt, stippleReveal(fc, 2.0, mBlue.y, u_edgeBlue));

  vec2 mPale = layerMasks(p.x, p.y, u_paleBase, u_paleAmp, u_paleFreq, u_palePhase, u_edgePale);
  vec3 paleAt = paleColor(p);
  cs = mix(cs, paleAt, mPale.x);
  cd = mix(cd, paleAt, stippleReveal(fc, 3.0, mPale.y, u_edgePale));

  vec2 mBlack = layerMasks(p.x, p.y, u_blackBase, u_blackAmp, u_blackFreq, u_blackPhase, u_edgeBlack);
  vec3 blackAt = blackColor(p);
  cs = mix(cs, blackAt, mBlack.x);
  cd = mix(cd, blackAt, stippleReveal(fc, 4.0, mBlack.y, u_edgeBlack));

  vec2 mLime = layerMasks(p.x, p.y, u_limeBase, u_limeAmp, u_limeFreq, u_limePhase, u_edgeLime);
  vec3 limeAt = limeColor(p);
  cs = mix(cs, limeAt, mLime.x);
  cd = mix(cd, limeAt, stippleReveal(fc, 5.0, mLime.y, u_edgeLime));

  vec2 mBlue2 = layerMasks(p.x, p.y, u_blue2Base, u_blue2Amp, u_blue2Freq, u_blue2Phase, u_edgeBlue2);
  vec3 blue2At = blue2Color(p);
  cs = mix(cs, blue2At, mBlue2.x);
  cd = mix(cd, blue2At, stippleReveal(fc, 6.0, mBlue2.y, u_edgeBlue2));

  vec2 mBlack2 = layerMasks(p.x, p.y, u_black2Base, u_black2Amp, u_black2Freq, u_black2Phase, u_edgeBlack2);
  vec3 black2At = black2Color(p);
  cs = mix(cs, black2At, mBlack2.x);
  cd = mix(cd, black2At, stippleReveal(fc, 7.0, mBlack2.y, u_edgeBlack2));

  vec3 col = mix(cs, cd, u_grainMix);
  col *= 0.96 + 0.08 * h21(fc * 0.731);
  col += (vec3(h21(fc + 1.0), h21(fc + 2.0), h21(fc + 3.0)) - 0.5) * 0.03;

  gl_FragColor = vec4(col, 1.0);
}
