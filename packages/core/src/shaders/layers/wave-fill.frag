#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;

uniform float edge;
uniform float centerY;
uniform float amplitude;
uniform float cycleWidth;
uniform float cycleX;

uniform sampler2D u_gradient;

const float EDGE_WIDTH = 0.37;
const float TAU = 6.2831853;
const float HALF_PI = 1.57079632;

float shapeAt(float m, float edgeScale) {
  float e = EDGE_WIDTH * edgeScale;
  return smoothstep(0.5 - e, 0.5 + e, m);
}

float seamSoft(float edgeScale) {
  return EDGE_WIDTH * edgeScale;
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

// Gradient contours stack below the wave boundary; each step lowers and flattens
// the sine shelf until t=1 is a horizontal line at centerY - spread.
float gradientTFromCurve(float px, float py) {
  float s = oneCycleWithShelves(px, cycleX, cycleWidth);
  float spread = max(centerY, 0.08);
  float denom = spread + amplitude * s;
  denom = max(denom, 0.001);
  return clamp((centerY + amplitude * s - py) / denom, 0.0, 1.0);
}

vec3 sampleEdgeGradient(sampler2D grad, float t) {
  return texture2D(grad, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  float lineY = bumpLine(uv.x, centerY, amplitude, cycleWidth, cycleX);
  float distBelow = lineY - uv.y;
  float soft = seamSoft(edge);
  // Above the curve (distBelow <= 0): mask = 0 → transparent, the layer
  // composite pass shows the stack below. Below the curve: mask → 1 with a
  // soft feather at the boundary. Coverage is carried in the alpha channel.
  float coverage = smoothstep(0.0, soft, distBelow);
  float mask = shapeAt(coverage, edge);
  vec3 fill = sampleEdgeGradient(u_gradient, gradientTFromCurve(uv.x, uv.y));
  gl_FragColor = vec4(fill, mask);
}
