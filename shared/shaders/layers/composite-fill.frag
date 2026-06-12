#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_scale;
uniform sampler2D u_input;
uniform sampler2D u_stipple;
uniform bool u_hasInput;
uniform bool u_hasStippleInput;

uniform float passMode;
uniform float shapeType;
uniform float edgeWidth;
uniform float dissolveReach;
uniform float edge;
uniform float stippleSeed;
uniform float dotSize;

uniform float centerY;
uniform float amplitude;
uniform float cycleWidth;
uniform float cycleX;
uniform float bandY;

uniform sampler2D u_gradient;
uniform sampler2D u_gradientBelow;
uniform sampler2D u_gradientAbove;

const float TAU = 6.2831853;
const float HALF_PI = 1.57079632;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float fine(vec2 fc, float k, float dotSize) {
  vec2 o = vec2(k * 31.7, k * 57.3);
  float n1 = h21(floor((fc + o) / dotSize));
  float n2 = h21(floor((fc + o) / (dotSize * 2.0)) + 9.0);
  return clamp(n1 * 0.8 + n2 * 0.2, 0.0, 1.0);
}

float shapeAt(float m, float edgeScale) {
  float e = edgeWidth * edgeScale;
  return smoothstep(0.5 - e, 0.5 + e, m);
}

float seamSoft(float edgeScale) {
  return edgeWidth * edgeScale;
}

float coverageMask(float lineY, float py, float edgeScale, float reach) {
  float soft = seamSoft(edgeScale) * reach;
  return smoothstep(lineY + soft, lineY - soft, py);
}

float oneCycleWithShelves(float x, float cx, float cw) {
  float halfW = max(cw * 0.5, 0.001);
  float x0 = cx - halfW;
  float x1 = cx + halfW;
  if (x < x0 || x > x1) return -1.0;
  float u = (x - x0) / (x1 - x0);
  float waveAngle = -HALF_PI + TAU * u;
  return sin(waveAngle);
}

float bumpLine(float x, float cy, float amp, float cw, float cx) {
  return cy + amp * oneCycleWithShelves(x, cx, cw);
}

vec2 waveMasks(float x, float py) {
  float lineY = bumpLine(x, centerY, amplitude, cycleWidth, cycleX);
  float mSmooth = shapeAt(coverageMask(lineY, py, edge, 1.0), edge);
  float mDissolve = coverageMask(lineY, py, edge, dissolveReach);
  return vec2(mSmooth, mDissolve);
}

float stippleReveal(vec2 fc, float mDissolve, float dotSize) {
  return step(fine(fc, stippleSeed, dotSize), shapeAt(mDissolve, edge));
}

float curveSlope(float px, float lineY) {
  float eps = 1.0 / u_resolution.x;
  float lineY2 = bumpLine(px + eps, centerY, amplitude, cycleWidth, cycleX);
  return (lineY2 - lineY) / eps;
}

// Distance from curved edge into the fill (fill sits below the curve, py < lineY).
float gradientTFromCurve(float lineY, float px, float py) {
  float slope = curveSlope(px, lineY);
  float dist = (lineY - py) / sqrt(1.0 + slope * slope);
  float spread = max(lineY, 0.08);
  return clamp(dist / spread, 0.0, 1.0);
}

float gradientTAboveLine(float lineY, float py) {
  float spread = max(1.0 - lineY, 0.08);
  return clamp((py - lineY) / spread, 0.0, 1.0);
}

float gradientTBelowLine(float lineY, float py) {
  float spread = max(lineY, 0.08);
  return clamp((lineY - py) / spread, 0.0, 1.0);
}

vec3 sampleEdgeGradient(sampler2D grad, float t) {
  return texture2D(grad, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / u_resolution;
  vec2 p = uv;

  vec3 belowSmooth = u_hasInput ? texture2D(u_input, uv).rgb : vec3(0.0);
  vec3 belowStipple = u_hasStippleInput ? texture2D(u_stipple, uv).rgb : vec3(0.0);

  if (shapeType > 0.5) {
    float mPinkBg = shapeAt(coverageMask(bandY, p.y, edge, 1.0), edge);
    float mPinkBgD = coverageMask(bandY, p.y, edge, dissolveReach);
    vec3 belowAt = sampleEdgeGradient(u_gradientBelow, gradientTBelowLine(bandY, p.y));
    vec3 aboveAt = sampleEdgeGradient(u_gradientAbove, gradientTAboveLine(bandY, p.y));

    if (passMode < 0.5) {
      vec3 fill = mix(belowAt, aboveAt, mPinkBg);
      gl_FragColor = vec4(mix(belowSmooth, fill, 1.0), 1.0);
    } else {
      float stip = stippleReveal(fc, mPinkBgD, dotSize);
      vec3 fill = mix(belowAt, aboveAt, stip);
      gl_FragColor = vec4(mix(belowStipple, fill, 1.0), 1.0);
    }
    return;
  }

  float lineY = bumpLine(p.x, centerY, amplitude, cycleWidth, cycleX);
  vec3 fill = sampleEdgeGradient(u_gradient, gradientTFromCurve(lineY, p.x, p.y));
  vec2 masks = waveMasks(p.x, p.y);
  float mask = passMode < 0.5 ? masks.x : stippleReveal(fc, masks.y, dotSize);

  if (passMode < 0.5) {
    gl_FragColor = vec4(mix(belowSmooth, fill, mask), 1.0);
  } else {
    gl_FragColor = vec4(mix(belowStipple, fill, mask), 1.0);
  }
}
