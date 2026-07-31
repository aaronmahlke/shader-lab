#ifdef GL_ES
precision highp float;
#endif

// Stochastic scatter: soft = average of displaced picks, hard = single pick.
// No mix with original — only scattered samples blended.

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_input;
uniform float layerOpacity; // universal layer opacity, 0-100

uniform float amount;
uniform float grainHard;
uniform float direction;
uniform bool animate;

const float OFFSET_BIAS = 1.0;
const int SOFT_TAPS = 6;

float hash(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 hash2(vec2 co) {
  return vec2(hash(co), hash(co + vec2(17.3, 41.7)));
}

vec3 sampleInput(vec2 uv) {
  return texture2D(u_input, clamp(uv, 0.0, 1.0)).rgb;
}

vec2 scatterOffset(vec2 rnd, float spread) {
  float rad = pow(rnd.y, OFFSET_BIAS) * spread;
  float sign = rnd.x < 0.5 ? -1.0 : 1.0;
  vec2 vert = vec2(0.0, sign * rad);
  vec2 horiz = vec2(sign * rad, 0.0);
  float ang = rnd.x * 6.2831853;
  vec2 omni = vec2(cos(ang), sin(ang)) * rad;

  float t = clamp(direction / 100.0, 0.0, 1.0);
  if (t <= 0.5) return mix(vert, omni, t * 2.0);
  return mix(omni, horiz, (t - 0.5) * 2.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 px = vec2(1.0) / u_resolution;
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 timeCell = animate ? vec2(u_time * 17.0, u_time * 23.0) : vec2(0.0);

  float reach = max(amount, 0.0);
  if (reach < 0.0001) {
    gl_FragColor = vec4(sampleInput(uv), 1.0);
    return;
  }

  float hard = clamp(grainHard, 0.0, 1.0);

  vec2 s1 = hash2(cell + vec2(9.1, 3.7) + timeCell);
  vec3 hardCol = sampleInput(uv + scatterOffset(s1, reach) * px);

  vec3 acc = hardCol;
  for (int i = 1; i < SOFT_TAPS; i++) {
    vec2 s = hash2(cell + vec2(float(i) * 3.3 + 1.7, float(i) * 5.1 + 2.9) + timeCell);
    acc += sampleInput(uv + scatterOffset(s, reach) * px);
  }
  vec3 softCol = acc / float(SOFT_TAPS);

  vec3 result = clamp(mix(softCol, hardCol, hard), 0.0, 1.0);
  vec3 base = sampleInput(uv);
  gl_FragColor = vec4(mix(base, result, clamp(layerOpacity / 100.0, 0.0, 1.0)), 1.0);
}
