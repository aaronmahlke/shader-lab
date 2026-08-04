#ifdef GL_ES
precision highp float;
#endif

// Bloom prefilter at half resolution: quadratic soft-knee threshold on the
// linear DOF result, so highlights ease into the bloom instead of popping.
// Standard soft-knee curve (Jimenez, "Next Generation Post Processing", 2014).

uniform vec2 u_resolution;   // this target's size (half frame)
uniform sampler2D u_input;   // linear full-res lens result

uniform float bloomThreshold;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 c = texture2D(u_input, uv).rgb;

  float knee = bloomThreshold * 0.5 + 1e-5;
  float brightness = max(c.r, max(c.g, c.b));
  float soft = clamp(brightness - bloomThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, brightness - bloomThreshold) / max(brightness, 1e-4);

  gl_FragColor = vec4(c * contribution, 1.0);
}
