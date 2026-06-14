#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_gradient;
uniform float angle;
uniform float offsetX;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv = uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  uv.x += offsetX;

  // Project onto gradient direction
  float a = radians(angle);
  float gradientT = dot(uv, vec2(cos(a), sin(a)));

  // Map to [0, 1]
  gradientT = clamp(gradientT * -0.33 + 0.5, 0.0, 1.0);

  vec3 color = texture2D(u_gradient, vec2(gradientT, 0.5)).rgb;
  gl_FragColor = vec4(color, 1.0);
}
