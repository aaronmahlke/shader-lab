#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform sampler2D u_input;
uniform float layerOpacity; // universal layer opacity, 0-100
uniform float u_scale;

uniform float levels;
uniform float ditherScale;

float bayer4x4(vec2 coord) {
  int x = int(mod(coord.x, 4.0));
  int y = int(mod(coord.y, 4.0));
  // WebGL1 requires constant indices — unroll the 4×4 Bayer lookup.
  if (y == 0) {
    if (x == 0) return 0.0 / 16.0;
    if (x == 1) return 8.0 / 16.0;
    if (x == 2) return 2.0 / 16.0;
    return 10.0 / 16.0;
  }
  if (y == 1) {
    if (x == 0) return 12.0 / 16.0;
    if (x == 1) return 4.0 / 16.0;
    if (x == 2) return 14.0 / 16.0;
    return 6.0 / 16.0;
  }
  if (y == 2) {
    if (x == 0) return 3.0 / 16.0;
    if (x == 1) return 11.0 / 16.0;
    if (x == 2) return 1.0 / 16.0;
    return 9.0 / 16.0;
  }
  if (x == 0) return 15.0 / 16.0;
  if (x == 1) return 7.0 / 16.0;
  if (x == 2) return 13.0 / 16.0;
  return 5.0 / 16.0;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  float scale = ditherScale * u_scale;

  // Sample at dither block center for blocky look
  vec2 ditherBlockCoord = floor(fragCoord / scale) * scale + scale * 0.5;
  vec2 blockUV = ditherBlockCoord / u_resolution;

  vec3 color = texture2D(u_input, blockUV).rgb;

  // Bayer dithering per block
  vec2 ditherCoord = floor(fragCoord / scale);
  float threshold = bayer4x4(ditherCoord);
  color = floor(color * levels + threshold) / levels;

  vec3 base = texture2D(u_input, fragCoord / u_resolution).rgb;
  gl_FragColor = vec4(mix(base, color, clamp(layerOpacity / 100.0, 0.0, 1.0)), 1.0);
}
