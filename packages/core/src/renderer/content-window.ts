/**
 * Content windows: keep zoomed-in source layers sharp.
 *
 * Every layer renders into a frame-sized buffer, then its composite pass
 * transforms that buffer onto the stack. Scaled up 5×, the composite would
 * magnify the buffer 5× and everything goes soft — no matter how sharp the
 * source (text, captured UI, a 4K image) is.
 *
 * For source layers (text, component, image, video) we instead compute the
 * part of the layer that is actually visible on screen — a rectangle in
 * layer UV space — and render ONLY that rectangle into the buffer at full
 * resolution. The composite pass remaps its layer UV into the rectangle.
 * Both passes get the same `u_window` = (x0, y0, w, h); (0, 0, 1, 1) is the
 * whole layer (the old behavior, used whenever a window would not help).
 */

export type ContentWindow = [number, number, number, number];

export const FULL_WINDOW: ContentWindow = [0, 0, 1, 1];

/** Layer types whose source pass understands `u_window`. */
export const WINDOWED_SOURCE_TYPES = new Set(["component", "image", "video", "text"]);

type Vec3 = [number, number, number];
/** Column-major 3×3 (same layout as GLSL mat3). */
type Mat3 = [Vec3, Vec3, Vec3];

const num = (u: Record<string, unknown>, k: string, d: number) => {
  const v = u[k];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
};
const rad = (deg: number) => (deg * Math.PI) / 180;

function mulMV(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}
function mulMM(a: Mat3, b: Mat3): Mat3 {
  return [mulMV(a, b[0]), mulMV(a, b[1]), mulMV(a, b[2])];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** rz * rx * ry with the shader's conventions (layer-composite-3d.frag). */
function eulerMatrix(xDeg: number, yDeg: number, zDeg: number): Mat3 {
  const cx = Math.cos(rad(xDeg)), sx = Math.sin(rad(xDeg));
  const cy = Math.cos(rad(yDeg)), sy = Math.sin(rad(yDeg));
  const cz = Math.cos(rad(zDeg)), sz = Math.sin(rad(zDeg));
  const rx: Mat3 = [[1, 0, 0], [0, cx, sx], [0, -sx, cx]];
  const ry: Mat3 = [[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]];
  const rz: Mat3 = [[cz, sz, 0], [-sz, cz, 0], [0, 0, 1]];
  return mulMM(mulMM(rz, rx), ry);
}

/** Screen uv (0..1, y up) → layer uv, 2D composite (layer-composite.frag). */
function layerUv2d(u: Record<string, unknown>, aspect: number): (sx: number, sy: number) => [number, number] {
  const ax = num(u, "layerAnchorX", 0.5), ay = num(u, "layerAnchorY", 0.5);
  const cx = ax + num(u, "layerPositionX", 0), cy = ay + num(u, "layerPositionY", 0);
  const scale = Math.max(num(u, "layerScale", 100) / 100, 1e-4);
  const ang = rad(num(u, "layerRotation", 0));
  const c = Math.cos(ang), s = Math.sin(ang);
  return (sx, sy) => {
    let px = (sx - cx) * aspect;
    let py = sy - cy;
    // GLSL mat2(c, s, -s, c) * p
    const rx = c * px - s * py;
    const ry = s * px + c * py;
    px = rx / scale / aspect;
    py = ry / scale;
    return [px + ax, py + ay];
  };
}

/** Screen uv → layer uv, 3D plane composite (layer-composite-3d.frag); null when the ray misses. */
function layerUv3d(u: Record<string, unknown>, aspect: number): (sx: number, sy: number) => [number, number] | null {
  const tanHalf = Math.tan(rad(num(u, "u_sceneFov", 50)) * 0.5);
  const dist = 1 / tanHalf / Math.max(num(u, "u_camZoom", 1), 1e-3);
  const rcam = eulerMatrix(num(u, "u_camTilt", 0), num(u, "u_camYaw", 0), num(u, "u_camRoll", 0));
  const ax0 = num(u, "layerAnchorX", 0.5), ay0 = num(u, "layerAnchorY", 0.5);
  const cu = ax0 + num(u, "layerPositionX", 0), cv = ay0 + num(u, "layerPositionY", 0);
  const S: Vec3 = [(cu * 2 - 1) * aspect, cv * 2 - 1, num(u, "layerPositionZ", 0) * 2];
  const rs = mulMV(rcam, S);
  const A: Vec3 = [rs[0], rs[1], rs[2] - dist];
  const rot = mulMM(rcam, eulerMatrix(num(u, "layerRotationX", 0), num(u, "layerRotationY", 0), -num(u, "layerRotation", 0)));
  const [ax, ay, n] = rot;
  const s = Math.max(num(u, "layerScale", 100) / 100, 1e-4);
  return (sx, sy) => {
    const nx = sx * 2 - 1, ny = sy * 2 - 1;
    const d0: Vec3 = [nx * tanHalf * aspect, ny * tanHalf, -1];
    const len = Math.hypot(d0[0], d0[1], d0[2]);
    const dir: Vec3 = [d0[0] / len, d0[1] / len, d0[2] / len];
    const denom = dot(n, dir);
    if (Math.abs(denom) < 1e-5) return null;
    const t = dot(n, A) / denom;
    if (t <= 1e-4) return null;
    const rel: Vec3 = [t * dir[0] - A[0], t * dir[1] - A[1], t * dir[2] - A[2]];
    return [dot(rel, ax) / (2 * aspect * s) + ax0, dot(rel, ay) / (2 * s) + ay0];
  };
}

/**
 * Visible layer-UV rectangle for a composite pass's resolved uniforms.
 * `width/height` = frame size in buffer px (padding is expressed in texels).
 */
export function computeContentWindow(
  uniforms: Record<string, unknown>,
  is3d: boolean,
  width: number,
  height: number,
  blurScale = 1,
): ContentWindow {
  // Blurred layers don't need the extra detail (and the windowed mip blur rings) — keep the full layer.
  if (num(uniforms, "layerBlur", 0) > 0.5) return FULL_WINDOW;
  const scale = num(uniforms, "layerScale", 100) / 100;
  // Only zoomed-in layers gain anything; 3D layers can also magnify through depth.
  if (!is3d && scale <= 1.05) return FULL_WINDOW;
  const aspect = width / Math.max(height, 1);
  const map = is3d ? layerUv3d(uniforms, aspect) : layerUv2d(uniforms, aspect);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  // Corners suffice (projective maps keep straight edges); a few extra points add safety.
  const pts: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]];
  for (const [sx, sy] of pts) {
    const p = map(sx, sy);
    if (!p) return FULL_WINDOW;
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }

  // Pad by the blur reach plus a few texels (in layer uv) so edge taps stay inside.
  const blurPx = num(uniforms, "layerBlur", 0) * blurScale;
  const spanX = Math.max(x1 - x0, 1e-6), spanY = Math.max(y1 - y0, 1e-6);
  const padX = spanX * ((blurPx * 1.2 + 4) / width);
  const padY = spanY * ((blurPx * 1.2 + 4) / height);
  x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY);
  x1 = Math.min(1, x1 + padX); y1 = Math.min(1, y1 + padY);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return FULL_WINDOW;
  // No real gain (most of the layer is visible): keep the plain path.
  if (w > 0.85 && h > 0.85) return FULL_WINDOW;
  // Never zoom past 16× (texture detail runs out long before that).
  const minSpan = 1 / 16;
  if (w < minSpan || h < minSpan) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ww = Math.max(w, minSpan), hh = Math.max(h, minSpan);
    return [cx - ww / 2, cy - hh / 2, ww, hh];
  }
  return [x0, y0, w, h];
}
