precision highp float;

// 3D layer composite: places a layer's content FBO on a plane in 3D space and
// blends the perspective projection onto the stack below. Same analytic
// ray/plane approach as the camera stage — exact UVs at grazing angles, exact
// view depth, no rasterized geometry needed.
//
// World convention (shared with camera-stage): camera at the origin looking
// down -Z, the 2D stack plane is 2 units tall (2*aspect wide) at the distance
// where it exactly fills the frame. A layer with identity transform samples
// pixel-exact like the 2D composite path.

uniform vec2 u_resolution;
uniform vec2 u_frameSize;
uniform sampler2D u_input;   // accumulated stack below
uniform sampler2D u_color;   // this layer's rendered content (alpha = coverage)

uniform float layerPositionX; // canvas fractions (-1..1), 1 = full width
uniform float layerPositionY;
uniform float layerPositionZ; // canvas fractions, positive = toward camera
uniform float layerScale;     // percent, 100 = identity
uniform float layerRotation;  // Z, degrees, positive = clockwise (matches 2D)
uniform float layerRotationX; // degrees
uniform float layerRotationY; // degrees
uniform float layerAnchorX;   // pivot in layer UV space (0..1)
uniform float layerAnchorY;
uniform float layerOpacity;   // percent, 0..100 (pre-gated by in/out points)
uniform int layerBlendMode;
uniform float u_keepAlpha;   // 1 inside nested comps: accumulate coverage alpha
uniform float layerAcceptsLight; // 3D quads: shade content with group lights

// Scene camera (identity when no camera layer drives the group).
uniform float u_sceneFov;     // vertical FOV in degrees
uniform float u_camTilt;      // plate-rotation convention, like camera-stage
uniform float u_camYaw;
uniform float u_camRoll;
uniform float u_camZoom;

// 3D object members (u_isObject = 1): ray-traced primitive instead of a quad.
uniform float u_isObject;
uniform int u_shape;          // 0 cube, 1 sphere (ellipsoid), 2 plane
uniform vec3 albedo;
uniform float u_sizeX;        // half-extents in scene units (frame height = 2)
uniform float u_sizeY;
uniform float u_sizeZ;
uniform float specular;
uniform float shininess;
uniform float emissive;
// Material (PBR-lite) + environment reflections.
uniform float bevel;          // cube edge rounding radius (scene units, × scale)
uniform float metalness;      // 0 dielectric … 1 metal (chrome = metal + low roughness)
uniform float roughness;      // softens reflections and highlights
uniform float reflections;    // environment reflection strength
uniform int envPreset;        // 0 studio (white strips), 1 neon (pink/blue), 2 spectrum
uniform float envRotation;    // degrees around the vertical axis (animate to slide reflections)
uniform float iridescence;    // thin-film rainbow sheen at grazing angles

// Lights (flattened arrays — ESSL 1.00 friendly). Vec is a unit direction
// TOWARD the light (directional) or a stack-space position (point).
uniform int u_lightCount;
uniform float u_ambient;
uniform int u_light0Type; uniform vec3 u_light0Color; uniform float u_light0Intensity; uniform vec3 u_light0Vec;
uniform int u_light1Type; uniform vec3 u_light1Color; uniform float u_light1Intensity; uniform vec3 u_light1Vec;
uniform int u_light2Type; uniform vec3 u_light2Color; uniform float u_light2Intensity; uniform vec3 u_light2Vec;
uniform int u_light3Type; uniform vec3 u_light3Color; uniform float u_light3Intensity; uniform vec3 u_light3Vec;

vec3 blendOverlay(vec3 b, vec3 s) {
  vec3 lo = 2.0 * b * s;
  vec3 hi = 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
  return mix(lo, hi, step(0.5, b));
}

vec3 blendSoftLight(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
  vec3 lo = b - (1.0 - 2.0 * s) * b * (1.0 - b);
  vec3 hi = b + (2.0 * s - 1.0) * (d - b);
  return mix(lo, hi, step(0.5, s));
}

float lum(vec3 c) { return dot(c, vec3(0.30, 0.59, 0.11)); }

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 setSat(vec3 c, float s) {
  float mn = min(min(c.r, c.g), c.b);
  float mx = max(max(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}

vec3 applyBlend(vec3 below, vec3 src, int mode) {
  if (mode == 1) return below * src;
  if (mode == 2) return 1.0 - (1.0 - below) * (1.0 - src);
  if (mode == 3) return blendOverlay(below, src);
  if (mode == 4) return min(below + src, 1.0);
  if (mode == 5) return min(below, src);
  if (mode == 6) return max(below, src);
  if (mode == 7) return min(below / max(1.0 - src, vec3(1e-4)), 1.0);
  if (mode == 8) return 1.0 - min((1.0 - below) / max(src, vec3(1e-4)), 1.0);
  if (mode == 9) return blendOverlay(src, below);
  if (mode == 10) return blendSoftLight(below, src);
  if (mode == 11) return abs(below - src);
  if (mode == 12) return below + src - 2.0 * below * src;
  if (mode == 13) return setLum(setSat(src, sat(below)), lum(below));
  if (mode == 14) return setLum(setSat(below, sat(src)), lum(below));
  if (mode == 15) return setLum(src, lum(below));
  if (mode == 16) return setLum(below, lum(src));
  return src;
}

// Forward rotation of the layer plane. Z is negated so positive matches the
// 2D composite's clockwise convention.
mat3 layerRotationMatrix() {
  float cx = cos(radians(layerRotationX)), sx = sin(radians(layerRotationX));
  float cy = cos(radians(layerRotationY)), sy = sin(radians(layerRotationY));
  float cz = cos(radians(-layerRotation)), sz = sin(radians(-layerRotation));
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, cx, sx,  0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0,  -sz, cz, 0.0,  0.0, 0.0, 1.0);
  return rz * rx * ry;
}

// Scene camera rotation (same convention/order as camera-stage's plateRotation).
mat3 camRotation() {
  float cx = cos(radians(u_camTilt)), sx = sin(radians(u_camTilt));
  float cy = cos(radians(u_camYaw)),  sy = sin(radians(u_camYaw));
  float cz = cos(radians(u_camRoll)), sz = sin(radians(u_camRoll));
  mat3 rx = mat3(1.0, 0.0, 0.0,  0.0, cx, sx,  0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy,  0.0, 1.0, 0.0,  sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0,  -sz, cz, 0.0,  0.0, 0.0, 1.0);
  return rz * rx * ry;
}

// --- Rounded box (SDF) ------------------------------------------------------

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// --- Environment (procedural studio) ----------------------------------------

vec3 envStrip(float az, float el, float center, float width, float elLo, float elHi, vec3 color, float soft) {
  float d = abs(mod(az - center + 3.14159265, 6.2831853) - 3.14159265);
  float w = width + soft;
  float h = 1.0 - smoothstep(width * 0.5, w * 0.5 + 0.02, d);
  float v = smoothstep(elLo - soft, elLo + 0.02, el) * (1.0 - smoothstep(elHi - 0.02, elHi + soft, el));
  return color * h * v;
}

vec3 environment(vec3 d, float rough) {
  float rotA = radians(envRotation);
  float az = atan(d.x, -d.z) + rotA;
  float el = asin(clamp(d.y, -1.0, 1.0));
  float soft = 0.05 + rough * 0.9;
  // Dark studio falloff: slightly lighter overhead, darker below.
  vec3 col = vec3(0.025, 0.022, 0.03) + vec3(0.05, 0.045, 0.06) * smoothstep(-0.2, 1.0, d.y);
  if (envPreset == 1) {
    col += envStrip(az, el, -0.9, 0.35, -0.2, 0.9, vec3(1.0, 0.35, 0.7) * 2.2, soft);
    col += envStrip(az, el, 0.7, 0.25, -0.1, 1.0, vec3(0.35, 0.6, 1.0) * 1.8, soft);
    col += envStrip(az, el, 2.4, 0.18, 0.0, 0.8, vec3(1.0) * 1.6, soft);
    col += envStrip(az, el, 0.0, 6.4, 1.05, 1.6, vec3(0.9, 0.85, 1.0) * 0.6, soft);
  } else if (envPreset == 2) {
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (fi / 6.0 + vec3(0.0, 0.33, 0.67)));
      col += envStrip(az, el, fi * 1.047, 0.22, -0.3, 0.9, hue * 2.0, soft);
    }
  } else {
    col += envStrip(az, el, -0.8, 0.3, -0.15, 0.95, vec3(1.0) * 2.0, soft);
    col += envStrip(az, el, 0.9, 0.2, 0.0, 0.9, vec3(1.0) * 1.4, soft);
    col += envStrip(az, el, 2.5, 0.45, -0.3, 0.6, vec3(1.0) * 0.8, soft);
    col += envStrip(az, el, 0.0, 6.4, 1.05, 1.6, vec3(1.0) * 0.7, soft);
  }
  return col;
}

// --- Object intersection (local space, half-extents h) ---------------------

// Returns t > 0 and writes the local normal, or returns -1.
float intersectObject(vec3 ro, vec3 rd, vec3 h, out vec3 nLocal) {
  nLocal = vec3(0.0);
  if (u_shape == 1) {
    // Ellipsoid: scale to unit sphere.
    vec3 ro2 = ro / h;
    vec3 rd2 = rd / h;
    float a = dot(rd2, rd2);
    float b = 2.0 * dot(ro2, rd2);
    float c = dot(ro2, ro2) - 1.0;
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) return -1.0;
    float t = (-b - sqrt(disc)) / (2.0 * a);
    if (t <= 1e-4) return -1.0;
    vec3 p = ro + t * rd;
    nLocal = normalize(p / (h * h));
    return t;
  }
  if (u_shape == 2) {
    // Plane: local z = 0 quad with extents h.xy.
    if (abs(rd.z) < 1e-6) return -1.0;
    float t = -ro.z / rd.z;
    if (t <= 1e-4) return -1.0;
    vec2 p = ro.xy + t * rd.xy;
    if (abs(p.x) > h.x || abs(p.y) > h.y) return -1.0;
    nLocal = vec3(0.0, 0.0, rd.z > 0.0 ? -1.0 : 1.0);
    return t;
  }
  // Cube: slab method (also the bounds for the beveled march).
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-h - ro) * inv;
  vec3 t1 = (h - ro) * inv;
  vec3 tsm = min(t0, t1);
  vec3 tbg = max(t0, t1);
  float tN = max(max(tsm.x, tsm.y), tsm.z);
  float tF = min(min(tbg.x, tbg.y), tbg.z);
  if (tN > tF || tF <= 1e-4 || tN <= 1e-4) return -1.0;
  float r = min(bevel * max(layerScale / 100.0, 1e-4), min(h.x, min(h.y, h.z)));
  if (r <= 1e-5) {
    nLocal = -sign(rd) * step(vec3(tN), tsm);
    return tN;
  }
  // Rounded box: sphere-trace inside the slab interval.
  vec3 b = h - r;
  float t = tN;
  for (int i = 0; i < 48; i++) {
    vec3 p = ro + t * rd;
    float d = sdRoundBox(p, b, r);
    if (d < 1e-4) {
      vec2 e = vec2(1e-4, 0.0);
      nLocal = normalize(vec3(
        sdRoundBox(p + e.xyy, b, r) - sdRoundBox(p - e.xyy, b, r),
        sdRoundBox(p + e.yxy, b, r) - sdRoundBox(p - e.yxy, b, r),
        sdRoundBox(p + e.yyx, b, r) - sdRoundBox(p - e.yyx, b, r)
      ));
      return t;
    }
    t += d;
    if (t > tF) break;
  }
  return -1.0;
}

vec3 lightContribution(
  vec3 base, int type, vec3 color, float intensity, vec3 lvec,
  vec3 hitPos, vec3 N, vec3 V, mat3 rcam
) {
  if (intensity <= 0.0) return vec3(0.0);
  vec3 L;
  float att = 1.0;
  if (type == 1) {
    // Point light: stack-space position rotated into world.
    vec3 lp = rcam * lvec + vec3(0.0, 0.0, -(1.0 / tan(radians(u_sceneFov) * 0.5)) / max(u_camZoom, 1e-3));
    vec3 toL = lp - hitPos;
    float d = length(toL);
    L = toL / max(d, 1e-5);
    att = 1.0 / (1.0 + 0.5 * d * d);
  } else {
    L = normalize(rcam * lvec);
  }
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), max(shininess, 2.0)) * specular;
  return color * intensity * att * (base * diff + vec3(spec));
}

vec3 shadeObject(vec3 hitPos, vec3 N, vec3 dir, mat3 rcam) {
  vec3 V = -dir;
  // Metals have no diffuse; their color tints the reflection instead.
  vec3 diffuseBase = albedo * (1.0 - clamp(metalness, 0.0, 1.0));
  vec3 col = diffuseBase * u_ambient + albedo * emissive;
  if (u_lightCount == 0) {
    // Headlight fallback so objects are never pitch black without lights.
    vec3 L = normalize(vec3(0.3, 0.45, 0.85));
    float diff = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), max(shininess, 2.0)) * specular * (1.0 - roughness * 0.8);
    col = diffuseBase * (0.18 + diff) + vec3(spec) + albedo * emissive;
  } else {
    if (u_lightCount > 0) col += lightContribution(diffuseBase, u_light0Type, u_light0Color, u_light0Intensity, u_light0Vec, hitPos, N, V, rcam);
    if (u_lightCount > 1) col += lightContribution(diffuseBase, u_light1Type, u_light1Color, u_light1Intensity, u_light1Vec, hitPos, N, V, rcam);
    if (u_lightCount > 2) col += lightContribution(diffuseBase, u_light2Type, u_light2Color, u_light2Intensity, u_light2Vec, hitPos, N, V, rcam);
    if (u_lightCount > 3) col += lightContribution(diffuseBase, u_light3Type, u_light3Color, u_light3Intensity, u_light3Vec, hitPos, N, V, rcam);
  }

  // Environment reflection (Schlick Fresnel; metals reflect tinted by albedo).
  if (reflections > 0.0) {
    float NdV = clamp(dot(N, V), 0.0, 1.0);
    vec3 F0 = mix(vec3(0.04), albedo, clamp(metalness, 0.0, 1.0));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
    if (iridescence > 0.0) {
      // Thin-film sheen: hue shifts with viewing angle.
      vec3 film = 0.5 + 0.5 * cos(6.2831853 * (NdV * 1.6 + vec3(0.0, 0.33, 0.67)));
      F = mix(F, F * 0.4 + film * (0.35 + 0.65 * (1.0 - NdV)), clamp(iridescence, 0.0, 1.0));
    }
    // Reflection vector in world, undo the camera so the studio stays put when the camera moves.
    vec3 R = reflect(dir, N);
    vec3 Rw = vec3(dot(R, rcam[0]), dot(R, rcam[1]), dot(R, rcam[2]));
    col += environment(Rw, clamp(roughness, 0.0, 1.0)) * F * reflections;
  }
  return col;
}

/** AE-style "Accepts Lights" for layer quads: diffuse + ambient, no specular. */
vec3 shadeQuad(vec3 base, vec3 hitPos, vec3 N, vec3 dir, mat3 rcam) {
  vec3 V = -dir;
  vec3 col = base * u_ambient;
  if (u_lightCount > 0) col += lightContribution(base, u_light0Type, u_light0Color, u_light0Intensity, u_light0Vec, hitPos, N, V, rcam);
  if (u_lightCount > 1) col += lightContribution(base, u_light1Type, u_light1Color, u_light1Intensity, u_light1Vec, hitPos, N, V, rcam);
  if (u_lightCount > 2) col += lightContribution(base, u_light2Type, u_light2Color, u_light2Intensity, u_light2Vec, hitPos, N, V, rcam);
  if (u_lightCount > 3) col += lightContribution(base, u_light3Type, u_light3Color, u_light3Intensity, u_light3Vec, hitPos, N, V, rcam);
  return col;
}


// --- Layer blur (universal "Blur", comp px) ---
uniform float layerBlur;    // radius in comp px (0 = off)
uniform float u_blurScale;  // buffer px per comp px

float blurHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Premultiplied golden-spiral gaussian over the content texture's mip chain
// (the renderer generates mips when blur > 0): each tap reads a level already
// shrunk to ~radius/4, so 24 taps come out smooth at any radius. Transparent
// edges don't darken (premultiplied), samples outside the layer are empty.
// Content window: u_color holds layer-UV rect (x0, y0, w, h) only (zoomed-in
// source layers render just their visible part); (0,0,1,1) = whole layer.
uniform vec4 u_window;

vec4 sampleLayerContent(sampler2D tex, vec2 layerUv, vec2 res) {
  vec2 luv = (layerUv - u_window.xy) / u_window.zw;
  vec2 cuv = clamp(luv, 0.0, 1.0);
  if (layerBlur <= 0.01) return texture2D(tex, cuv);
  // Blur radius is in layer space; the windowed buffer is magnified by 1/w.
  float radiusPx = layerBlur * u_blurScale / min(u_window.z, u_window.w);
  vec2 radius = vec2(radiusPx) / res;
  // Each tap reads a level ~radius/4 wide so neighbouring taps overlap (smooth, no grain).
  float lod = max(log2(radiusPx / 4.0), 0.0);
  float rot = 0.0;
  vec3 rgb = vec3(0.0);
  float a = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 24.0);
    float th = fi * 2.39996323 + rot;
    vec2 q = luv + vec2(cos(th), sin(th)) * r * radius;
    float w = exp(-2.0 * r * r);
    vec4 s = texture2D(tex, clamp(q, 0.0, 1.0), lod);
    s.a *= step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    rgb += s.rgb * s.a * w;
    a += s.a * w;
    wsum += w;
  }
  return vec4(a > 1e-5 ? rgb / a : vec3(0.0), a / wsum);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 belowSample = texture2D(u_input, uv);
  vec3 below = belowSample.rgb;

  float aspect = u_frameSize.x / u_frameSize.y;
  float tanHalf = tan(radians(u_sceneFov) * 0.5);
  float dist = (1.0 / tanHalf) / max(u_camZoom, 1e-3);

  mat3 rcam = camRotation();

  // Anchor pivot: stack-space point of (anchor + posXY) at posZ, transformed
  // by the scene camera around the stack center at -dist.
  vec2 anchor = vec2(layerAnchorX, layerAnchorY);
  vec2 centerUv = anchor + vec2(layerPositionX, layerPositionY);
  vec3 S = vec3((centerUv.x * 2.0 - 1.0) * aspect, centerUv.y * 2.0 - 1.0, layerPositionZ * 2.0);
  vec3 A = vec3(0.0, 0.0, -dist) + rcam * S;

  mat3 rot = rcam * layerRotationMatrix();
  vec3 ax = rot * vec3(1.0, 0.0, 0.0);
  vec3 ay = rot * vec3(0.0, 1.0, 0.0);
  vec3 n  = rot * vec3(0.0, 0.0, 1.0);

  vec2 ndc = uv * 2.0 - 1.0;
  vec3 dir = normalize(vec3(ndc.x * tanHalf * aspect, ndc.y * tanHalf, -1.0));

  float alpha = 0.0;
  vec3 src = vec3(0.0);
  float s = max(layerScale / 100.0, 1e-4);

  if (u_isObject > 0.5) {
    // Ray-traced primitive. 4-ray coverage supersample for edge AA.
    vec3 h = vec3(u_sizeX, u_sizeY, u_sizeZ) * s;
    vec3 ro = vec3(dot(-A, ax), dot(-A, ay), dot(-A, n));

    vec3 nLocal;
    vec3 rdC = vec3(dot(dir, ax), dot(dir, ay), dot(dir, n));
    float tC = intersectObject(ro, rdC, h, nLocal);

    float coverage = 0.0;
    vec2 px = 1.0 / u_resolution;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 0 || i == 2 ? -0.25 : 0.25, i < 2 ? -0.25 : 0.25);
      vec2 ndcO = (uv + o * px) * 2.0 - 1.0;
      vec3 dO = normalize(vec3(ndcO.x * tanHalf * aspect, ndcO.y * tanHalf, -1.0));
      vec3 rdO = vec3(dot(dO, ax), dot(dO, ay), dot(dO, n));
      vec3 nTmp;
      if (intersectObject(ro, rdO, h, nTmp) > 0.0) coverage += 0.25;
    }

    if (tC > 0.0 && coverage > 0.0) {
      vec3 hitPos = tC * dir;
      vec3 N = normalize(ax * nLocal.x + ay * nLocal.y + n * nLocal.z);
      src = shadeObject(hitPos, N, dir, rcam);
      alpha = clamp(layerOpacity / 100.0, 0.0, 1.0) * coverage;
    } else if (coverage > 0.0) {
      // Edge fragments where the center ray misses: flat ambient fill.
      src = albedo * max(u_ambient, 0.25);
      alpha = clamp(layerOpacity / 100.0, 0.0, 1.0) * coverage;
    }
  } else {
    float denom = dot(n, dir);
    if (abs(denom) > 1e-5) {
      float t = dot(n, A) / denom;
      if (t > 1e-4) {
        vec3 hit = t * dir;
        vec3 rel = hit - A;
        vec2 luv = vec2(
          dot(rel, ax) / (2.0 * aspect * s) + anchor.x,
          dot(rel, ay) / (2.0 * s) + anchor.y
        );

        // Anti-alias the plane edge over ~1 screen px at the hit depth, kept
        // OUTSIDE [0,1] so an identity layer has full coverage on its edge
        // texel (matches the 2D composite behavior).
        float depth = -hit.z;
        float worldPerPx = 2.0 * tanHalf * max(depth, 1e-4) / u_frameSize.y;
        vec2 aa = vec2(worldPerPx / (2.0 * aspect * s), worldPerPx / (2.0 * s));
        vec2 inside = smoothstep(-aa, vec2(0.0), luv) * smoothstep(-aa, vec2(0.0), 1.0 - luv);
        float coverage = inside.x * inside.y;

        vec4 content = sampleLayerContent(u_color, luv, u_frameSize);
        if (layerBlur > 0.01) coverage = 1.0;
        alpha = clamp(layerOpacity / 100.0, 0.0, 1.0) * coverage * content.a;
        src = content.rgb;

        // Shade the quad with the group's lights when the layer accepts them
        // (flip the normal toward the viewer — both faces are lit).
        if (layerAcceptsLight > 0.5 && u_lightCount > 0) {
          vec3 N = denom > 0.0 ? -n : n;
          src = shadeQuad(content.rgb, hit, N, dir, rcam);
        }
      }
    }
  }

  vec3 blended = applyBlend(below, src, layerBlendMode);
  // Root comps flatten to opaque; nested comps keep union coverage so the
  // host composite sees transparency where nothing rendered.
  float outAlpha = mix(1.0, belowSample.a + alpha * (1.0 - belowSample.a), u_keepAlpha);
  gl_FragColor = vec4(mix(below, blended, alpha), outAlpha);
}