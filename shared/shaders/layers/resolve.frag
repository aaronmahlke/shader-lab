#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform sampler2D u_color;        // generator output (the color to sample)
uniform sampler2D u_displacement; // accumulated displacement map (RG encoded)

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  vec4 dispSample = texture2D(u_displacement, uv);
  // Neutral map is (0.5, 0.5); alpha marks a valid displacement pass output
  vec2 displacement = dispSample.a > 0.5
    ? dispSample.rg * 2.0 - 1.0
    : vec2(0.0);

  vec2 sampleUV = clamp(uv + displacement, 0.0, 1.0);

  gl_FragColor = texture2D(u_color, sampleUV);
}
