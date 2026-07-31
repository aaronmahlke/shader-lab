#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform sampler2D u_input;
uniform float layerOpacity; // universal layer opacity, 0-100

uniform int mode;
uniform float amount;
uniform float angle;
uniform float centerX;
uniform float centerY;
uniform float radialScale;
uniform int steps;
uniform float blend;

#define MAX_STEPS 12

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;

  vec2 shiftDir;
  float shiftMag;

  if (mode == 0) {
    vec2 delta = uv - vec2(centerX, centerY);
    vec2 deltaAspect = vec2(delta.x * aspect, delta.y);
    float dist = length(deltaAspect);
    shiftDir = dist > 1e-5 ? deltaAspect / dist : vec2(0.0, 1.0);
    shiftDir = vec2(shiftDir.x / aspect, shiftDir.y);
    float radial = mix(0.35, 1.0, pow(dist, radialScale));
    shiftMag = amount * radial;
  } else {
    float rad = radians(angle);
    shiftDir = vec2(cos(rad), sin(rad));
    shiftMag = amount;
  }

  vec3 original = texture2D(u_input, uv).rgb;
  vec3 aberration;

  if (steps <= 1) {
    vec2 offset = shiftDir * shiftMag;
    aberration = vec3(
      texture2D(u_input, clamp(uv + offset, 0.0, 1.0)).r,
      texture2D(u_input, uv).g,
      texture2D(u_input, clamp(uv - offset, 0.0, 1.0)).b
    );
  } else {
    vec3 accum = vec3(0.0);
    vec3 weightSum = vec3(0.0);
    float denom = float(steps - 1);

    for (int i = 0; i < MAX_STEPS; i++) {
      float fi = float(i);
      float stepMask = 1.0 - step(float(steps), fi);

      float t = fi / denom;
      float offset = shiftMag * (t - 0.5) * 2.0;
      vec3 texel = texture2D(u_input, clamp(uv + shiftDir * offset, 0.0, 1.0)).rgb;

      float wr = t;
      float wb = 1.0 - t;
      float wg = 1.0 - abs(t - 0.5) * 2.0;
      vec3 weights = vec3(wr, wg, wb) * stepMask;

      accum += texel * weights;
      weightSum += weights;
    }

    aberration = vec3(
      weightSum.r < 1e-4 ? original.r : accum.r / weightSum.r,
      weightSum.g < 1e-4 ? original.g : accum.g / weightSum.g,
      weightSum.b < 1e-4 ? original.b : accum.b / weightSum.b
    );
  }

  gl_FragColor = vec4(mix(original, aberration, blend * clamp(layerOpacity / 100.0, 0.0, 1.0)), 1.0);
}
