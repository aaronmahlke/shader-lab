#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_input;
uniform float u_scale;

uniform float ditherScale;
uniform float edgeMin;
uniform float edgeMax;
uniform float sampleSpread;
uniform float speed;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  float cell = max(ditherScale * u_scale, 1.0);
  vec2 blockCoord = floor(fragCoord / cell);
  vec2 blockCenter = blockCoord * cell + cell * 0.5;
  vec2 blockUV = blockCenter / u_resolution;

  vec2 px = vec2(1.0 / u_resolution.x, 1.0 / u_resolution.y);
  float spread = max(sampleSpread, 1.0);

  vec3 cC = texture2D(u_input, blockUV).rgb;
  vec3 cL = texture2D(u_input, blockUV - vec2(px.x * spread, 0.0)).rgb;
  vec3 cR = texture2D(u_input, blockUV + vec2(px.x * spread, 0.0)).rgb;
  vec3 cD = texture2D(u_input, blockUV - vec2(0.0, px.y * spread)).rgb;
  vec3 cU = texture2D(u_input, blockUV + vec2(0.0, px.y * spread)).rgb;

  float gx = length(cR - cL);
  float gy = length(cU - cD);
  float edge = max(gx, gy);

  vec3 cNeg;
  vec3 cPos;
  if (gx >= gy) {
    cNeg = cL;
    cPos = cR;
  } else {
    cNeg = cD;
    cPos = cU;
  }

  float t = length(cC - cNeg) / (length(cC - cNeg) + length(cC - cPos) + 1e-5);
  float boundary = smoothstep(edgeMin, edgeMax, edge);

  vec2 hashSeed = blockCoord;
  if (speed > 0.001) {
    hashSeed += floor(u_time * speed);
  }
  float xi = hash12(hashSeed);

  vec3 seamPick = xi < t ? cNeg : cPos;
  vec3 interiorPick = length(cC - cNeg) < length(cC - cPos) ? cNeg : cPos;

  vec3 color = mix(interiorPick, seamPick, boundary);

  gl_FragColor = vec4(color, 1.0);
}
