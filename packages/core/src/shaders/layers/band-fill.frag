#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;

uniform float edge;
uniform float bandY;

uniform sampler2D u_gradientBelow;
uniform sampler2D u_gradientAbove;

const float EDGE_WIDTH = 0.37;

float shapeAt(float m, float edgeScale) {
  float e = EDGE_WIDTH * edgeScale;
  return smoothstep(0.5 - e, 0.5 + e, m);
}

float seamSoft(float edgeScale) {
  return EDGE_WIDTH * edgeScale;
}

float coverageMask(float lineY, float py, float edgeScale, float reach) {
  float soft = seamSoft(edgeScale) * reach;
  return 1.0 - smoothstep(lineY - soft, lineY + soft, py);
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
  vec2 uv = gl_FragCoord.xy / u_resolution;

  float mBand = shapeAt(coverageMask(bandY, uv.y, edge, 1.0), edge);
  vec3 belowAt = sampleEdgeGradient(u_gradientBelow, gradientTBelowLine(bandY, uv.y));
  vec3 aboveAt = sampleEdgeGradient(u_gradientAbove, gradientTAboveLine(bandY, uv.y));
  vec3 fill = mix(belowAt, aboveAt, mBand);
  gl_FragColor = vec4(fill, 1.0);
}
