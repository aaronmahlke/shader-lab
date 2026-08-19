precision highp float;

// 3D layer composite: places a layer's content FBO on a plane in 3D space and
// blends the perspective projection onto the stack below. Same analytic
// ray/plane approach as the camera stage — exact UVs at grazing angles, exact
// view depth, no rasterized geometry needed.
//
// World convention (shared with camera-stage): camera at the origin looking
// down -Z, the 2D stack plane is 2 units tall (2*aspect wide) at the distance
// where it exactly fills the frame. A layer with identity transform samples
// pixel-exact like the 2D composite path.

uniform vec2 u_resolution;
uniform vec2 u_frameSize;
uniform sampler2D u_input;   // accumulated stack below
uniform sampler2D u_color;   // this layer's rendered content (alpha = coverage)

uniform float layerPositionX; // canvas fractions (-1..1), 1 = full width
uniform float layerPositionY;
uniform float layerPositionZ; // canvas fractions, positive = toward camera
uniform float layerScale;     // percent, 100 = identity
uniform float layerRotation;  // Z, degrees, positive = clockwise (matches 2D)
uniform float layerRotationX; // degrees
uniform float layerRotationY; // degrees
uniform float layerAnchorX;   // pivot in layer UV space (0..1)
uniform float layerAnchorY;
uniform float layerOpacity;   // percent, 0..100 (pre-gated by in/out points)
uniform int layerBlendMode;
uniform float u_sceneFov;     // vertical FOV in degrees (implicit scene camera)

vec3 blendOverlay(vec3 b, vec3 s) {
  vec3 lo = 2.0 * b * s;
  vec3 hi = 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
  return mix(lo, hi, step(0.5, b));
}

vec3 blendSoftLight(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
  vec3 lo = b - (1.0 - 2.0 * s) * b * (1.0 - b);
  vec3 hi = b + (2.0 * s - 1.0) * (d - b);
  return mix(lo, hi, step(0.5, s));
}

float lum(vec3 c) { return dot(c, vec3(0.30, 0.59, 0.11)); }

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 setSat(vec3 c, float s) {
  float mn = min(min(c.r, c.g), c.b);
  float mx = max(max(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}

vec3 applyBlend(vec3 below, vec3 src, int mode) {
  if (mode == 1) return below * src;
  if (mode == 2) return 1.0 - (1.0 - below) * (1.0 - src);
  if (mode == 3) return blendOverlay(below, src);
  if (mode == 4) return min(below + src, 1.0);
  if (mode == 5) return min(below, src);
  if (mode == 6) return max(below, src);
  if (mode == 7) return min(below / max(1.0 - src, vec3(1e-4)), 1.0);
  if (mode == 8) return 1.0 - min((1.0 - below) / max(src, vec3(1e-4)), 1.0);
  if (mode == 9) return blendOverlay(src, below);
  if (mode == 10) return blendSoftLight(below, src);
  if (mode == 11) return abs(below - src);
  if (mode == 12) return below + src - 2.0 * below * src;
  if (mode == 13) return setLum(setSat(src, sat(below)), lum(below));
  if (mode == 14) return setLum(setSat(below, sat(src)), lum(below));
  if (mode == 15) return setLum(src, lum(below));
  if (mode == 16) return setLum(below, lum(src));
  return src;
}

// Forward rotation of the layer plane. Z is negated so positive matches the
// 2D composite's clockwise convention.
mat3 layerRotationMatrix() {
  float cx = cos(radians(layerRotationX)), sx = sin(radians(layerRotationX));
  float cy = cos(radians(layerRotationY)), sy = sin(radians(layerRotationY));
  float cz = cos(radians(-layerRotation)), sz = sin(radians(-layerRotation));
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, cx, sx,  0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0,  -sz, cz, 0.0,  0.0, 0.0, 1.0);
  return rz * rx * ry;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 below = texture2D(u_input, uv).rgb;

  float aspect = u_frameSize.x / u_frameSize.y;
  float tanHalf = tan(radians(u_sceneFov) * 0.5);
  float dist = 1.0 / tanHalf;

  // Anchor pivot in world space: the 2D-stack plane point of (anchor + posXY),
  // pushed toward the camera by posZ (canvas fractions, frame height = 2 units).
  vec2 anchor = vec2(layerAnchorX, layerAnchorY);
  vec2 centerUv = anchor + vec2(layerPositionX, layerPositionY);
  vec3 A = vec3((centerUv.x * 2.0 - 1.0) * aspect, centerUv.y * 2.0 - 1.0, -dist + layerPositionZ * 2.0);

  mat3 rot = layerRotationMatrix();
  vec3 ax = rot * vec3(1.0, 0.0, 0.0);
  vec3 ay = rot * vec3(0.0, 1.0, 0.0);
  vec3 n  = rot * vec3(0.0, 0.0, 1.0);

  vec2 ndc = uv * 2.0 - 1.0;
  vec3 dir = normalize(vec3(ndc.x * tanHalf * aspect, ndc.y * tanHalf, -1.0));
  float denom = dot(n, dir);

  float alpha = 0.0;
  vec3 src = vec3(0.0);

  if (abs(denom) > 1e-5) {
    float t = dot(n, A) / denom;
    if (t > 1e-4) {
      vec3 hit = t * dir;
      vec3 rel = hit - A;
      float s = max(layerScale / 100.0, 1e-4);
      vec2 luv = vec2(
        dot(rel, ax) / (2.0 * aspect * s) + anchor.x,
        dot(rel, ay) / (2.0 * s) + anchor.y
      );

      // Anti-alias the plane edge over ~1 screen px at the hit depth, kept
      // OUTSIDE [0,1] so an identity layer has full coverage on its edge texel
      // (matches the 2D composite behavior).
      float depth = -hit.z;
      float worldPerPx = 2.0 * tanHalf * max(depth, 1e-4) / u_frameSize.y;
      vec2 aa = vec2(worldPerPx / (2.0 * aspect * s), worldPerPx / (2.0 * s));
      vec2 inside = smoothstep(-aa, vec2(0.0), luv) * smoothstep(-aa, vec2(0.0), 1.0 - luv);
      float coverage = inside.x * inside.y;

      vec4 content = texture2D(u_color, clamp(luv, 0.0, 1.0));
      alpha = clamp(layerOpacity / 100.0, 0.0, 1.0) * coverage * content.a;
      src = content.rgb;
    }
  }

  vec3 blended = applyBlend(below, src, layerBlendMode);
  gl_FragColor = vec4(mix(below, blended, alpha), 1.0);
}