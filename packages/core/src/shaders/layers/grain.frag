#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_input;
uniform float u_scale;

uniform float grainIntensity;
uniform float speed;
uniform float ditherScale;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 uv = fragCoord / u_resolution;

  vec3 color = texture2D(u_input, uv).rgb;

  // Grain tied to block grid for chunky appearance
  float scale = ditherScale * u_scale;
  vec2 blockCoord = floor(fragCoord / scale) * scale;

  float grainSeed = fract(u_time * speed);
  float grain = hash12(blockCoord + grainSeed);
  grain = grain * 2.0 - 1.0;
  grain *= grainIntensity;

  color += grain;

  gl_FragColor = vec4(color, 1.0);
}
