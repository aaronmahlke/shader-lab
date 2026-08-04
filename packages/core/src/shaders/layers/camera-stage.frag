#ifdef GL_ES
precision highp float;
#endif

// Camera stage: films the accumulated stack below as a "plate" on a plane in
// 3D. Per-fragment analytic ray/plane intersection instead of a rasterized
// quad: exact UVs at grazing angles and exact view depth for free.
// Pipeline structure adapted from evlog's Render labs (MIT, (c) 2026 HugoRCD).
// Output is LINEAR light in a (half-)float target; the lens chain downstream
// stays linear until the final camera composite encodes back to sRGB.

uniform vec2 u_resolution;   // this target's size (full frame)
uniform vec2 u_frameSize;    // full frame size in px
uniform sampler2D u_input;   // the flat stack below the camera (sRGB)

uniform float tilt;          // degrees
uniform float yaw;
uniform float roll;
uniform float zoom;          // 1 = plate height exactly fills the frame
uniform float fov;           // vertical, degrees
uniform float emission;      // >1 pushes plate highlights above 1.0 for bloom
uniform vec3 background;     // sRGB, fills everything that is not plate

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

mat3 plateRotation() {
  float cx = cos(radians(tilt)), sx = sin(radians(tilt));
  float cy = cos(radians(yaw)),  sy = sin(radians(yaw));
  float cz = cos(radians(roll)), sz = sin(radians(roll));
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, cx, sx,  0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0,  -sz, cz, 0.0,  0.0, 0.0, 1.0);
  return rz * rx * ry;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 ndc = uv * 2.0 - 1.0;
  float aspect = u_frameSize.x / u_frameSize.y;
  float tanHalf = tan(radians(fov) * 0.5);

  // Camera at the origin looking down -Z; plate is 2 world units tall,
  // centered at the distance that exactly fits the frame height at zoom 1.
  float dist = (1.0 / tanHalf) / max(zoom, 1e-3);
  vec3 planeCenter = vec3(0.0, 0.0, -dist);
  mat3 rot = plateRotation();
  vec3 ax = rot * vec3(1.0, 0.0, 0.0);
  vec3 ay = rot * vec3(0.0, 1.0, 0.0);
  vec3 n  = rot * vec3(0.0, 0.0, 1.0);

  vec3 dir = normalize(vec3(ndc.x * tanHalf * aspect, ndc.y * tanHalf, -1.0));
  float denom = dot(n, dir);
  float t = dot(n, planeCenter) / denom;

  vec3 bg = srgbToLinear(background);
  if (t <= 0.0) {
    gl_FragColor = vec4(bg, 1.0);
    return;
  }

  vec3 hit = t * dir;
  vec3 rel = hit - planeCenter;
  float lu = dot(rel, ax);
  float lv = dot(rel, ay);
  float halfW = aspect;
  vec2 plateUv = vec2(lu / halfW, lv) * 0.5 + 0.5;

  // Anti-alias the plate edge over ~1 screen px, converted to plate UV units
  // at the hit depth (no derivatives needed in ESSL 1.00).
  float depth = -hit.z;
  float worldPerPx = 2.0 * tanHalf * depth / u_frameSize.y;
  vec2 aa = vec2(worldPerPx / (2.0 * halfW), worldPerPx / 2.0);
  vec2 inside = smoothstep(vec2(0.0), aa, plateUv) * smoothstep(vec2(0.0), aa, 1.0 - plateUv);
  float coverage = inside.x * inside.y;

  vec3 plate = srgbToLinear(texture2D(u_input, clamp(plateUv, 0.0, 1.0)).rgb) * emission;
  gl_FragColor = vec4(mix(bg, plate, coverage), 1.0);
}
