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

  // Coverage: 1 inside layer bounds, anti-aliased over ~1 texel at the edges.
  vec2 aa = 1.0 / (u_resolution * scale);
  vec2 inside = smoothstep(vec2(0.0), aa, luv) * smoothstep(vec2(0.0), aa, 1.0 - luv);
  float coverage = inside.x * inside.y;

  vec4 content = texture2D(u_color, clamp(luv, 0.0, 1.0));
  float alpha = clamp(layerOpacity / 100.0, 0.0, 1.0) * coverage * content.a;

  gl_FragColor = vec4(mix(below, content.rgb, alpha), 1.0);
}
