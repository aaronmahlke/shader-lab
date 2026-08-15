#!/usr/bin/env node
// Nested composition smoke test (real WebGL2 via gl@9).
//   1. a composition layer renders its referenced comp's content
//   2. nested keyframes run on the local clock (host in-point offset)
//   3. a 3D composition layer gets perspective like any quad
// Requires a display: xvfb-run -a node scripts/nested-smoke.mjs
// Requires a build first: bun run build
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { renderCompositionToBuffer } = await import(pathToFileURL(join(pkgRoot, "dist", "server.js")).href);
const { PNG } = await import("pngjs").catch(() => ({ PNG: null }));

const stbnPath = join(pkgRoot, "..", "..", "apps", "web", "public", "textures", "stbn-scalar-128x64.png");

const solid = (id, color, values = {}, extra = {}) => ({
  id, type: "solid", enabled: true,
  values: { u_color: color, layerOpacity: 100, layerBlendMode: 0, layerScale: 100,
    layerPositionX: 0, layerPositionY: 0, layerAnchorX: 0.5, layerAnchorY: 0.5, layerRotation: 0, ...values },
  ...extra,
});
const comp = (layers, extra = {}) => ({ version: 1, layers, lfos: [], assignments: [], ...extra });

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
// CI's ANGLE backend reads the framebuffer darker than local mesa — assert
// channel dominance instead of absolute values.
const dominant = (a, b) => a > 96 && a > b * 2.5;

// decode PNG buffer via @napi-rs/canvas (available as core dependency)
const { createCanvas, loadImage } = await import("@napi-rs/canvas");
async function centerPixel(buf, w, h, x, y) {
  const img = await loadImage(buf);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const W = 128, H = 128;

// 1. Basic nesting: red nested comp scaled 50% over a blue base.
{
  const nested = comp([solid("inner", "#ff0000")]);
  const parent = comp([
    { id: "host", type: "composition", enabled: true, values: { compRefId: "compB", layerScale: 50, layerOpacity: 100, layerBlendMode: 0, layerPositionX: 0, layerPositionY: 0, layerAnchorX: 0.5, layerAnchorY: 0.5, layerRotation: 0 } },
    solid("bg", "#0000ff"),
  ]);
  const buf = await renderCompositionToBuffer(parent, { width: W, height: H, time: 0, stbnPath, compositions: { compB: nested } });
  if (!buf) fail("nested render returned null");
  const [r, , b] = await centerPixel(buf, W, H, 64, 64);
  if (!dominant(r, b)) fail(`center should be nested red, got rgb(${r},_,${b})`);
  const [er, , eb] = await centerPixel(buf, W, H, 4, 64);
  if (!dominant(eb, er)) fail(`edge should be base blue, got rgb(${er},_,${eb})`);
  console.log("ok: composition layer renders its referenced comp");
}

// 2. Local clock: nested keyframe moves inner solid; host in-point 1s.
{
  const nested = comp([solid("inner", "#ff0000", { layerScale: 25 })], {
    tracks: [{ layerId: "inner", paramName: "layerPositionX", enabled: true, keys: [
      { time: 0, value: -0.3 }, { time: 2, value: 0.3 },
    ]}],
  });
  const parent = comp([
    { id: "host", type: "composition", enabled: true, timing: { in: 1 },
      values: { compRefId: "c", layerScale: 100, layerOpacity: 100, layerBlendMode: 0, layerPositionX: 0, layerPositionY: 0, layerAnchorX: 0.5, layerAnchorY: 0.5, layerRotation: 0 } },
  ]);
  // parent t=2 → local t=1 → keyframe midpoint (x=0, centered)
  const buf = await renderCompositionToBuffer(parent, { width: W, height: H, time: 2, stbnPath, compositions: { c: nested } });
  const [r] = await centerPixel(buf, W, H, 64, 64);
  if (!(r > 96)) fail(`nested keyframe should center the solid at local t=1, got r=${r}`);
  // parent t=1 → local t=0 → x=-0.3 (left), center empty
  const buf2 = await renderCompositionToBuffer(parent, { width: W, height: H, time: 1.017, stbnPath, compositions: { c: nested } });
  const [r2] = await centerPixel(buf2, W, H, 64, 64);
  const [rl] = await centerPixel(buf2, W, H, 26, 64);
  if (!(rl > 96 && rl > r2 * 2.5)) fail(`at local t≈0 the solid should sit left, got center=${r2} left=${rl}`);
  console.log("ok: nested keyframes run on the host-offset local clock");
}

// 3. 3D precomp: rotationY on the composition layer produces perspective.
{
  const nested = comp([solid("inner", "#ff0000")]);
  const parent = comp([
    { id: "host", type: "composition", enabled: true, is3D: true,
      values: { compRefId: "c", layerScale: 60, layerRotationY: 55, layerRotationX: 0, layerPositionZ: 0,
        layerOpacity: 100, layerBlendMode: 0, layerPositionX: 0, layerPositionY: 0, layerAnchorX: 0.5, layerAnchorY: 0.5, layerRotation: 0 } },
  ]);
  const buf = await renderCompositionToBuffer(parent, { width: W, height: H, time: 0, stbnPath, compositions: { c: nested } });
  const [rc] = await centerPixel(buf, W, H, 64, 64);
  // top-left vs top-right rows differ under yaw (perspective foreshortening)
  let left = 0, right = 0;
  for (let y = 20; y < 108; y += 4) {
    const [rl] = await centerPixel(buf, W, H, 50, y); if (rl > 80) left++;
    const [rr] = await centerPixel(buf, W, H, 78, y); if (rr > 80) right++;
  }
  if (!(rc > 80)) fail(`3D precomp center should be red, got ${rc}`);
  if (left === right) fail(`yawed precomp should be asymmetric (left ${left} vs right ${right})`);
  console.log("ok: a 3D composition layer renders with perspective");
}

console.log("nested-smoke passed");
