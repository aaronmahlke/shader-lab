#ifdef GL_ES
precision highp float;
#endif

// Bloom upsample: 9-tap tent over the lower (smaller, accumulated) level,
// added to this level's downsample. The additive walk back up the chain is
// what gives bloom its long, soft falloff.

uniform vec2 u_resolution;   // this target's size
uniform vec2 u_inputSize;    // lower level's size
uniform sampler2D u_input;   // accumulated lower level
uniform sampler2D u_color;   // this level's downsample (prefilter at the top)

vec3 T(vec2 uv) {
  return texture2D(u_input, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 t = 1.0 / u_inputSize;

  vec3 tent =
      T(uv + t * vec2(-1.0,  1.0)) + T(uv + t * vec2(0.0,  1.0)) * 2.0 + T(uv + t * vec2(1.0,  1.0))
    + T(uv + t * vec2(-1.0,  0.0)) * 2.0 + T(uv) * 4.0 + T(uv + t * vec2(1.0,  0.0)) * 2.0
    + T(uv + t * vec2(-1.0, -1.0)) + T(uv + t * vec2(0.0, -1.0)) * 2.0 + T(uv + t * vec2(1.0, -1.0));
  tent /= 16.0;

  gl_FragColor = vec4(texture2D(u_color, uv).rgb + tent, 1.0);
}
