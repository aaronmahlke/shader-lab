#ifdef GL_ES
precision highp float;
#endif

// Depth of field: golden-angle spiral gather over the linear stage result.
// The circle of confusion is recomputed analytically per tap from the same
// ray/plane math as the stage pass (one plane means no depth buffer needed),
// with an asymmetric reach test so blurred regions do not halo over sharp
// edges. Approach adapted from evlog's Render labs (MIT, (c) 2026 HugoRCD).

uniform vec2 u_resolution;   // this target's size (full frame)
uniform vec2 u_frameSize;    // full frame size in px
uniform sampler2D u_input;   // linear stage result

uniform float tilt;
uniform float yaw;
uniform float roll;
uniform float zoom;
uniform float fov;
uniform float focus;        // 0..1 across the plate's depth span
uniform float focusRange;   // half-width of the sharp band, in span units
uniform float aperture;     // CoC gain
uniform float blurRadius;   // max bokeh radius in px at 1080p
uniform int dofSamples;

const float GOLDEN_ANGLE = 2.39996323;
const int MAX_TAPS = 64;

mat3 plateRotation() {
  float cx = cos(radians(tilt)), sx = sin(radians(tilt));
  float cy = cos(radians(yaw)),  sy = sin(radians(yaw));
  float cz = cos(radians(roll)), sz = sin(radians(roll));
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, cx, sx,  0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0,  -sz, cz, 0.0,  0.0, 0.0, 1.0);
  return rz * rx * ry;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_frameSize.x / u_frameSize.y;
  float tanHalf = tan(radians(fov) * 0.5);
  float dist = (1.0 / tanHalf) / max(zoom, 1e-3);
  vec3 planeCenter = vec3(0.0, 0.0, -dist);
  mat3 rot = plateRotation();
  vec3 ax = rot * vec3(1.0, 0.0, 0.0);
  vec3 ay = rot * vec3(0.0, 1.0, 0.0);
  vec3 n  = rot * vec3(0.0, 0.0, 1.0);
  float halfW = aspect;

  // Depth span from the four plate corners; focus is a position across it,
  // so a look survives changes of zoom, fov and aspect.
  float nearD = 1e9;
  float farD = -1e9;
  for (int sy = -1; sy <= 1; sy += 2) {
    for (int sx = -1; sx <= 1; sx += 2) {
      vec3 corner = planeCenter + float(sx) * halfW * ax + float(sy) * ay;
      float d = -corner.z;
      nearD = min(nearD, d);
      farD = max(farD, d);
    }
  }
  float span = max(farD - nearD, 1e-4);
  float focusDepth = mix(nearD, farD, focus);
  float maxPx = blurRadius * (u_frameSize.y / 1080.0);

  // CoC in px for the plane depth along a given NDC ray. Rays that miss the
  // plane (parallel or behind) count as fully defocused.
  // Inlined here because ESSL 1.00 has no closures: see cocAt below.
  vec3 dirC = normalize(vec3((uv * 2.0 - 1.0).x * tanHalf * aspect, (uv * 2.0 - 1.0).y * tanHalf, -1.0));
  float tC = dot(n, planeCenter) / dot(n, dirC);
  float depthC = tC > 0.0 ? -(tC * dirC.z) : farD;
  float defocusC = max(0.0, abs(depthC - focusDepth) / span - focusRange);
  float r0 = min(aperture * defocusC * maxPx, maxPx);

  vec3 center = texture2D(u_input, uv).rgb;
  if (r0 < 0.5 || dofSamples < 2) {
    gl_FragColor = vec4(center, 1.0);
    return;
  }

  vec3 acc = center;
  float wsum = 1.0;
  for (int i = 1; i < MAX_TAPS; i++) {
    if (i >= dofSamples) break;
    float fi = float(i);
    // sqrt keeps the spiral area-uniform instead of center-heavy.
    float radius = sqrt((fi + 0.5) / float(dofSamples));
    float ang = fi * GOLDEN_ANGLE;
    vec2 offsetPx = vec2(cos(ang), sin(ang)) * radius * r0;
    vec2 tapUv = uv + offsetPx / u_frameSize;
    if (tapUv.x < 0.0 || tapUv.x > 1.0 || tapUv.y < 0.0 || tapUv.y > 1.0) continue;

    vec2 tapNdc = tapUv * 2.0 - 1.0;
    vec3 dirT = normalize(vec3(tapNdc.x * tanHalf * aspect, tapNdc.y * tanHalf, -1.0));
    float tT = dot(n, planeCenter) / dot(n, dirT);
    float depthT = tT > 0.0 ? -(tT * dirT.z) : farD;
    float defocusT = max(0.0, abs(depthT - focusDepth) / span - focusRange);
    float tapCoc = min(aperture * defocusT * maxPx, maxPx);

    // Asymmetric reach: a tap only contributes if ITS blur disc (or ours)
    // actually reaches this pixel — sharp content never bleeds outward.
    float reach = max(tapCoc, r0);
    float distPx = radius * r0;
    float w = clamp(reach - distPx + 1.0, 0.0, 1.0);
    acc += texture2D(u_input, tapUv).rgb * w;
    wsum += w;
  }

  gl_FragColor = vec4(acc / wsum, 1.0);
}
