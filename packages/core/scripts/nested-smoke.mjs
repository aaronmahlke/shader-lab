#!/usr/bin/env node
// Nested composition smoke test (real WebGL2 via gl@9).
//
// All assertions are RELATIVE (enabled vs disabled / time A vs time B):
// CI's ANGLE backend blends and quantizes the default framebuffer readback
// differently from a local mesa stack, so absolute color checks are flaky.
//
//   1. a composition layer changes the frame exactly where it composites
//   2. nested keyframes run on the local clock (host in-point offset)
//   3. a 3D composition layer renders with perspective (asymmetry under yaw)
//
// Requires a display: xvfb-run -a node scripts/nested-smoke.mjs
// Requires a build first: bun run build
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { renderCompositionToBuffer } = await import(pathToFileURL(join(pkgRoot, "dist", "server.js")).href);
const { createNestedResolvers } = await import(pathToFileURL(join(pkgRoot, "dist", "index.js")).href);
const stbnPath = join(pkgRoot, "..", "..", "apps", "web", "public", "textures", "stbn-scalar-128x64.png");

const solid = (id, color, values = {}, extra = {}) => ({
  id, type: "solid", enabled: true,
  values: { u_color: color, layerOpacity: 100, layerBlendMode: 0, layerScale: 100,
    layerPositionX: 0, layerPositionY: 0, layerAnchorX: 0.5, layerAnchorY: 0.5, layerRotation: 0, ...values },
  ...extra,
});
const comp = (layers, extra = {}) => ({ version: 1, layers, lfos: [], assignments: [], ...extra });
const hostLayer = (values = {}, extra = {}) => ({
  id: "host", type: "composition", enabled: true,
  values: { compRefId: "c", layerScale: 50, layerOpacity: 100, layerBlendMode: 0,
    layerPositionX: 0, layerPositionY: 0, layerAnchorX: 0.5, layerAnchorY: 0.5, layerRotation: 0, ...values },
  ...extra,
});

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

const { createCanvas, loadImage } = await import("@napi-rs/canvas");
async function pixels(buf, w, h) {
  const img = await loadImage(buf);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}
const at = (d, w, x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];

const W = 128, H = 128;

// --- 1. the composition layer composites its referenced comp ---------------
{
  const nested = comp([solid("inner", "#ff0000")]);
  const make = (enabled) => comp([
    { ...hostLayer(), enabled },
    solid("bg", "#0000ff"),
  ]);
  const on = await pixels(await renderCompositionToBuffer(make(true), { width: W, height: H, time: 0, stbnPath, compositions: { c: nested } }), W, H);
  const off = await pixels(await renderCompositionToBuffer(make(false), { width: W, height: H, time: 0, stbnPath, compositions: { c: nested } }), W, H);

  const [ro] = at(on, W, 64, 64);
  const [rf] = at(off, W, 64, 64);
  if (!(ro - rf > 40)) fail(`nested red should appear at center (enabled r=${ro} vs disabled r=${rf})`);
  const [, , bo] = at(on, W, 4, 64);
  const [, , bf] = at(off, W, 4, 64);
  if (Math.abs(bo - bf) > 30) fail(`the scaled comp must not cover the edge (b ${bo} vs ${bf})`);
  console.log("ok: composition layer renders its referenced comp");
}

// --- 2. nested keyframes run on the host-offset local clock ----------------
{
  const nested = comp([solid("inner", "#ff0000", { layerScale: 25 })], {
    tracks: [{ layerId: "inner", paramName: "layerPositionX", enabled: true, keys: [
      { time: 0, value: -0.3 }, { time: 2, value: 0.3 },
    ]}],
  });
  const parent = comp([hostLayer({ layerScale: 100 }, { timing: { in: 1 } })]);
  const render = (time) => renderCompositionToBuffer(parent, { width: W, height: H, time, stbnPath, compositions: { c: nested } });

  // parent t=2 → local t=1 → keyframe midpoint (x=0, centered)
  const mid = await pixels(await render(2), W, H);
  // parent t≈1 → local t≈0 → x=-0.3 (left of center)
  const early = await pixels(await render(1.017), W, H);

  // Locate the red blob's horizontal centroid in each frame, thresholded
  // against that frame's own max red (CI drivers render integer-aligned
  // quads dimmer than local mesa; relative thresholds are stable).
  const centroid = (d) => {
    let max = 0;
    for (let y = 40; y < 88; y += 2) for (let x = 0; x < W; x += 2) max = Math.max(max, at(d, W, x, y)[0]);
    if (max < 25) return null;
    let sum = 0, n = 0;
    for (let y = 40; y < 88; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (at(d, W, x, y)[0] > max * 0.5) { sum += x; n++; }
      }
    }
    return n ? sum / n : null;
  };

  const cMid = centroid(mid);
  const cEarly = centroid(early);
  if (cMid == null || cEarly == null) fail(`nested solid missing (centroids ${cMid} / ${cEarly})`);
  // local t≈0 → x=-0.3 (left third); local t=1 → x=0 (center-ish).
  if (!(cEarly < 48)) fail(`solid should sit left at local t≈0, centroid ${cEarly.toFixed(1)}`);
  if (!(cMid - cEarly > 20)) {
    fail(`solid should move right between local t≈0 and t=1 (${cEarly.toFixed(1)} → ${cMid.toFixed(1)})`);
  }
  console.log("ok: nested keyframes run on the host-offset local clock");
}

// --- 3. a 3D composition layer renders with perspective --------------------
{
  const nested = comp([solid("inner", "#ff0000")]);
  const parent = comp([
    hostLayer({ layerScale: 60, layerRotationY: 55, layerRotationX: 0, layerPositionZ: 0 }, { is3D: true }),
  ]);
  const buf = await pixels(await renderCompositionToBuffer(parent, { width: W, height: H, time: 0, stbnPath, compositions: { c: nested } }), W, H);
  const [rc] = at(buf, W, 64, 64);
  if (!(rc > 40)) fail(`3D precomp center should show the nested comp, got r=${rc}`);
  // Perspective foreshortening: red column heights differ left vs right.
  const threshold = Math.max(40, rc * 0.5);
  let left = 0, right = 0;
  for (let y = 20; y < 108; y += 4) {
    if (at(buf, W, 50, y)[0] > threshold) left++;
    if (at(buf, W, 78, y)[0] > threshold) right++;
  }
  if (left === right) fail(`yawed precomp should be asymmetric (left ${left} vs right ${right})`);
  console.log("ok: a 3D composition layer renders with perspective");
}

console.log("nested-smoke passed");
