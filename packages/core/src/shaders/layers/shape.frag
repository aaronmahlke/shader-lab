#ifdef GL_ES
precision mediump float;
#endif

// SDF shape generator: rounded rectangle or ellipse, centered in the comp.
// Sizes are fractions of the comp (width of width, height of height); the
// universal layer transform handles placement, scaling, and rotation.

uniform vec2 u_resolution;
uniform int shape;          // 0 = rectangle, 1 = ellipse
uniform float shapeWidth;   // 0..1 of comp width
uniform float shapeHeight;  // 0..1 of comp height
uniform float cornerRadius; // 0..0.5 of comp height (rectangle only)
uniform float softness;     // edge feather, fraction of comp height
uniform vec3 u_color;

float sdRoundRect(vec2 p, vec2 half_, float r) {
  vec2 q = abs(p) - half_ + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdEllipse(vec2 p, vec2 half_) {
  // Scaled-space approximation, good enough for fills.
  float k = length(p / half_);
  return (k - 1.0) * min(half_.x, half_.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;

  // Aspect-corrected space where one unit = comp height.
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  vec2 half_ = vec2(max(shapeWidth, 0.001) * 0.5 * aspect, max(shapeHeight, 0.001) * 0.5);

  float d;
  if (shape == 0) {
    float r = min(cornerRadius, min(half_.x, half_.y));
    d = sdRoundRect(p, half_, r);
  } else {
    d = sdEllipse(p, half_);
  }

  float soft = max(softness, 1.5 / u_resolution.y);
  float alpha = 1.0 - smoothstep(-soft, soft, d);
  gl_FragColor = vec4(u_color, alpha);
}
