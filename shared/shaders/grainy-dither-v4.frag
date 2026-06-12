#ifdef GL_ES
precision highp float;
#endif

// Top: dissolved two-band bg. Bottom: six stacked sine cycles.

uniform vec2 u_resolution;
uniform float u_grainMix;
uniform float u_edge;
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

float waveBelow(float lineY, float py, float edgeScale) {
  float soft = seamSoft(edgeScale);
  return shapeAt(smoothstep(lineY + soft, lineY - soft, py), edgeScale);
}

float layerBelow(float x, float py, float centerY, float amp, float cycleWidth, float cycleX, float edgeScale) {
  return waveBelow(bumpLine(x, centerY, amp, cycleWidth, cycleX), py, edgeScale);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 p = fc / u_resolution;

  vec3 beigeC = vec3(0.952941, 0.933333, 0.713725); // #F3EEB6 top cap
  vec3 pinkC = vec3(0.937255, 0.541176, 0.768627);  // #EF8AC4

  // --- Top (unchanged): two flat bands ---
  float bgSoft = seamSoft(u_edgeBg);
  float mPinkBg = shapeAt(smoothstep(u_bgBandY + bgSoft, u_bgBandY - bgSoft, p.y), u_edgeBg);

  vec3 cs = mix(beigeC, pinkC, mPinkBg);
  vec3 cd = mix(beigeC, pinkC, step(fine(fc, 1.0), mPinkBg));

  // --- Bottom stack (back → front): blue → pale → black → lime → blue2 → black2 ---
  vec3 paleC = vec3(0.97, 0.95, 0.86);
  vec3 limeC = vec3(0.82, 0.88, 0.48);
  vec3 blueC = mix(vec3(0.14, 0.12, 0.62), vec3(0.42, 0.34, 0.88), p.x);
  vec3 blackC = vec3(0.184314, 0.145098, 0.141176); // #2F2524

  float mBlue = layerBelow(p.x, p.y, u_blueBase, u_blueAmp, u_blueFreq, u_bluePhase, u_edgeBlue);
  cs = mix(cs, blueC, mBlue);
  cd = mix(cd, blueC, step(fine(fc, 2.0), mBlue));

  float mPale = layerBelow(p.x, p.y, u_paleBase, u_paleAmp, u_paleFreq, u_palePhase, u_edgePale);
  cs = mix(cs, paleC, mPale);
  cd = mix(cd, paleC, step(fine(fc, 3.0), mPale));

  float mBlack = layerBelow(p.x, p.y, u_blackBase, u_blackAmp, u_blackFreq, u_blackPhase, u_edgeBlack);
  cs = mix(cs, blackC, mBlack);
  cd = mix(cd, blackC, step(fine(fc, 4.0), mBlack));

  float mLime = layerBelow(p.x, p.y, u_limeBase, u_limeAmp, u_limeFreq, u_limePhase, u_edgeLime);
  cs = mix(cs, limeC, mLime);
  cd = mix(cd, limeC, step(fine(fc, 5.0), mLime));

  float mBlue2 = layerBelow(p.x, p.y, u_blue2Base, u_blue2Amp, u_blue2Freq, u_blue2Phase, u_edgeBlue2);
  cs = mix(cs, blueC, mBlue2);
  cd = mix(cd, blueC, step(fine(fc, 6.0), mBlue2));

  float mBlack2 = layerBelow(p.x, p.y, u_black2Base, u_black2Amp, u_black2Freq, u_black2Phase, u_edgeBlack2);
  cs = mix(cs, blackC, mBlack2);
  cd = mix(cd, blackC, step(fine(fc, 7.0), mBlack2));

  vec3 col = mix(cs, cd, u_grainMix);
  col *= 0.96 + 0.08 * h21(fc * 0.731);
  col += (vec3(h21(fc + 1.0), h21(fc + 2.0), h21(fc + 3.0)) - 0.5) * 0.03;

  gl_FragColor = vec4(col, 1.0);
}
