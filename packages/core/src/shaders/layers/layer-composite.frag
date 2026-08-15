precision highp float;

// Universal layer composite: blends a layer's content FBO onto the stack below,
// applying the layer's transform (position/scale/rotation around anchor) and opacity.

uniform vec2 u_resolution;
uniform sampler2D u_input;   // accumulated stack below (black when this is the bottom layer)
uniform sampler2D u_color;   // this layer's rendered content (alpha = coverage mask)

uniform float layerPositionX; // offset in canvas fractions (-1..1)
uniform float layerPositionY;
uniform float layerScale;     // percent, 100 = identity
uniform float layerRotation;  // degrees, positive = clockwise
uniform float layerAnchorX;   // rotation/scale origin in layer UV space (0..1)
uniform float layerAnchorY;
uniform float layerOpacity;   // percent, 0..100 (pre-gated by in/out points)
// 0 normal, 1 multiply, 2 screen, 3 overlay, 4 add, 5 darken, 6 lighten,
// 7 color dodge, 8 color burn, 9 hard light, 10 soft light, 11 difference,
// 12 exclusion, 13 hue, 14 saturation, 15 color, 16 luminosity
uniform int layerBlendMode;
uniform float u_keepAlpha;   // 1 inside nested comps: accumulate coverage alpha

vec3 blendOverlay(vec3 b, vec3 s) {
  vec3 lo = 2.0 * b * s;
  vec3 hi = 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
  return mix(lo, hi, step(0.5, b));
}

// W3C compositing spec soft-light.
vec3 blendSoftLight(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
  vec3 lo = b - (1.0 - 2.0 * s) * b * (1.0 - b);
  vec3 hi = b + (2.0 * s - 1.0) * (d - b);
  return mix(lo, hi, step(0.5, s));
}

// --- Non-separable modes (hue/saturation/color/luminosity), per the W3C spec ---

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

// Rescales so min -> 0 and max -> s, keeping the mid channel proportional.
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
  if (mode == 9) return blendOverlay(src, below); // hard light = overlay with layers swapped
  if (mode == 10) return blendSoftLight(below, src);
  if (mode == 11) return abs(below - src);
  if (mode == 12) return below + src - 2.0 * below * src;
  if (mode == 13) return setLum(setSat(src, sat(below)), lum(below));
  if (mode == 14) return setLum(setSat(below, sat(src)), lum(below));
  if (mode == 15) return setLum(src, lum(below));
  if (mode == 16) return setLum(below, lum(src));
  return src;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 belowSample = texture2D(u_input, uv);
  vec3 below = belowSample.rgb;

  vec2 anchor = vec2(layerAnchorX, layerAnchorY);
  vec2 center = anchor + vec2(layerPositionX, layerPositionY);
  float aspect = u_resolution.x / u_resolution.y;
  float scale = max(layerScale / 100.0, 1e-4);
  float ang = radians(layerRotation);
  float c = cos(ang);
  float s = sin(ang);

  // Inverse-map the screen point into layer UV space (aspect-corrected rotation about center).
  vec2 p = uv - center;
  p.x *= aspect;
  p = mat2(c, s, -s, c) * p;
  p /= scale;
  p.x /= aspect;
  vec2 luv = p + anchor;

  // Coverage: 1 inside layer bounds, anti-aliased over ~1 texel just OUTSIDE
  // the edges. Keeping the AA band outside [0,1] means an untransformed layer
  // has full coverage on its outermost texel; the old inside-band darkened that
  // ring, and distortion layers (which clamp displaced UVs onto it) smeared it
  // into dark blocky artifacts across the frame.
  vec2 aa = 1.0 / (u_resolution * scale);
  vec2 inside = smoothstep(-aa, vec2(0.0), luv) * smoothstep(-aa, vec2(0.0), 1.0 - luv);
  float coverage = inside.x * inside.y;

  vec4 content = texture2D(u_color, clamp(luv, 0.0, 1.0));
  float alpha = clamp(layerOpacity / 100.0, 0.0, 1.0) * coverage * content.a;

  vec3 blended = applyBlend(below, content.rgb, layerBlendMode);
  // Root comps flatten to opaque; nested comps keep union coverage so the
  // host composite sees transparency where nothing rendered.
  float outAlpha = mix(1.0, belowSample.a + alpha * (1.0 - belowSample.a), u_keepAlpha);
  gl_FragColor = vec4(mix(below, blended, alpha), outAlpha);
}
