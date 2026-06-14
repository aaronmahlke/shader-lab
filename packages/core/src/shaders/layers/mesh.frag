#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;

uniform float u_pointCount;
uniform float softness;
uniform float gain;

uniform vec2 u_pos0;
uniform vec3 u_color0;
uniform float u_radius0;
uniform vec2 u_pos1;
uniform vec3 u_color1;
uniform float u_radius1;
uniform vec2 u_pos2;
uniform vec3 u_color2;
uniform float u_radius2;
uniform vec2 u_pos3;
uniform vec3 u_color3;
uniform float u_radius3;
uniform vec2 u_pos4;
uniform vec3 u_color4;
uniform float u_radius4;
uniform vec2 u_pos5;
uniform vec3 u_color5;
uniform float u_radius5;

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

float blobWeight(vec2 uv, vec2 pos01, float radius) {
  vec2 p = pointUv(pos01);
  float d = length(uv - p);
  float r = max(radius, 0.02);
  return exp(-pow(d / r, 2.0) * softness);
}

void main() {
  vec2 uv = aspectUv(gl_FragCoord.xy / u_resolution);

  vec3 color = vec3(0.0);
  float wSum = 0.0;
  int count = int(u_pointCount + 0.5);

  if (count > 0) {
    float w0 = blobWeight(uv, u_pos0, u_radius0);
    color += u_color0 * w0;
    wSum += w0;
  }
  if (count > 1) {
    float w1 = blobWeight(uv, u_pos1, u_radius1);
    color += u_color1 * w1;
    wSum += w1;
  }
  if (count > 2) {
    float w2 = blobWeight(uv, u_pos2, u_radius2);
    color += u_color2 * w2;
    wSum += w2;
  }
  if (count > 3) {
    float w3 = blobWeight(uv, u_pos3, u_radius3);
    color += u_color3 * w3;
    wSum += w3;
  }
  if (count > 4) {
    float w4 = blobWeight(uv, u_pos4, u_radius4);
    color += u_color4 * w4;
    wSum += w4;
  }
  if (count > 5) {
    float w5 = blobWeight(uv, u_pos5, u_radius5);
    color += u_color5 * w5;
    wSum += w5;
  }

  color /= max(wSum, 1e-5);
  color *= gain;

  gl_FragColor = vec4(color, 1.0);
}
