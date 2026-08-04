#ifdef GL_ES
precision highp float;
#endif

// Camera composite: bloom add + exposure + optional filmic tonemap, all in
// linear light, then encode back to sRGB and crossfade with the unprocessed
// stack by the layer's universal opacity (so in/out points and opacity
// keyframes behave like any other effect).
// ACES fit by Krzysztof Narkowicz (public domain approximation).

uniform vec2 u_resolution;   // this target's size (full frame)
uniform sampler2D u_input;   // linear DOF result
uniform sampler2D u_color;   // accumulated bloom (half res, bilinear)
uniform sampler2D u_aux;     // the unprocessed flat stack (sRGB)

uniform float bloomIntensity;
uniform float exposure;      // stops
uniform bool aces;
uniform float layerOpacity;  // 0..100

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  vec3 c = texture2D(u_input, uv).rgb;
  c += texture2D(u_color, uv).rgb * bloomIntensity;
  c *= exp2(exposure);
  if (aces) {
    c = acesFilm(c);
  }
  c = linearToSrgb(clamp(c, 0.0, 1.0));

  vec3 base = texture2D(u_aux, uv).rgb;
  gl_FragColor = vec4(mix(base, c, clamp(layerOpacity / 100.0, 0.0, 1.0)), 1.0);
}
