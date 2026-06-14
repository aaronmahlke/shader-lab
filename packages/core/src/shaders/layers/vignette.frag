#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform sampler2D u_input;

uniform int shape;
uniform float vignetteIntensity;
uniform float vignetteRadius;
uniform float vignetteSoftness;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 color = texture2D(u_input, uv).rgb;

  float mask;

  if (shape == 0) {
    // Rectangular vignette (matches original shader)
    vec2 feather = smoothstep(0.0, vignetteSoftness, uv) * smoothstep(0.0, vignetteSoftness, 1.0 - uv);
    mask = feather.x * feather.y;
  } else {
    // Radial vignette
    vec2 center = uv - 0.5;
    center.x *= u_resolution.x / u_resolution.y;
    float dist = length(center);
    mask = smoothstep(vignetteRadius, vignetteRadius - vignetteSoftness, dist);
  }

  color = mix(color, color * mask, vignetteIntensity);

  gl_FragColor = vec4(color, 1.0);
}
