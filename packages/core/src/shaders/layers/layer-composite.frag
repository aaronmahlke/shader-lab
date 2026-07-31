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
uniform int layerBlendMode;   // 0 normal, 1 multiply, 2 screen, 3 overlay, 4 add, 5 darken, 6 lighten

vec3 blendOverlay(vec3 b, vec3 s) {
  vec3 lo = 2.0 * b * s;
  vec3 hi = 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
  return mix(lo, hi, step(0.5, b));
}

vec3 applyBlend(vec3 below, vec3 src, int mode) {
  if (mode == 1) return below * src;
  if (mode == 2) return 1.0 - (1.0 - below) * (1.0 - src);
  if (mode == 3) return blendOverlay(below, src);
  if (mode == 4) return min(below + src, 1.0);
  if (mode == 5) return min(below, src);
  if (mode == 6) return max(below, src);
  return src;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 below = texture2D(u_input, uv).rgb;

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
  gl_FragColor = vec4(mix(below, blended, alpha), 1.0);
}
