#!/usr/bin/env node
// 3D group rendering smoke test (real WebGL2 via gl@9).
//
// Covers what threed-render.test.ts cannot on Linux under bun:
//   1. depth order beats stack order inside a 3D group
//   2. a 3D layer at rest (z=0, no X/Y rotation) matches the 2D composite path
//
// Requires a display: xvfb-run -a node scripts/threed-smoke.mjs
// Requires a build first: bun run build
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = pathToFileURL(join(pkgRoot, "dist", "index.js")).href;

let core;
try {
  core = await import(entry);
} catch (e) {
  console.error("Could not import dist/index.js - run `bun run build` first.", e.message);
  process.exit(1);
}

const { compilePasses, buildLayerValues, renderPasses, destroyGlContext } = core;

const glModule = (await import("gl")).default;

function createGl(width, height) {
  const gl = glModule(width, height, { preserveDrawingBuffer: true, createWebGL2Context: true });
  if (!gl || !gl.RGBA16F) throw new Error("WebGL2 context unavailable");
  return gl;
}

function solid(id, color, { is3D = false, values = {} } = {}) {
  return {
    id,
    type: "solid",
    enabled: true,
    is3D,
    values: { ...buildLayerValues("solid"), u_color: color, ...values },
  };
}

// Minimal gradient factory (solids never sample gradients).
const createGradientData = () => new Uint8Array(256 * 4);

function render(gl, layers, width, height) {
  const passes = compilePasses(layers, null);
  const { pixels } = renderPasses(
    passes,
    {
      gl,
      width,
      height,
      time: 0,
      scaleUniform: 1,
      gradientTextures: new Map(),
      stbnTexture: null,
      createGradientData,
      findLayer: (pass) => layers.find((l) => l.id === (pass.sourceLayerId ?? pass.layerId)),
      getModulatedValue: null,
    },
    { readPixels: true, disposeResources: true },
  );
  return pixels;
}

function px(pixels, width, x, y) {
  const i = (y * width + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const W = 128;
const H = 128;

// --- 1. depth order beats stack order -------------------------------------
{
  const gl = createGl(W, H);
  const make = (is3D) => [
    solid("blue", "#0000ff", { is3D, values: { layerScale: 60 } }),
    solid("red", "#ff0000", { is3D, values: { layerScale: 60, layerPositionZ: is3D ? 0.4 : 0 } }),
  ];

  const flat = render(gl, make(false), W, H);
  const [fr, , fb] = px(flat, W, 64, 64);
  if (!(fb > 200 && fr < 60)) fail(`2D stack should show blue on top, got rgb(${fr},_,${fb})`);

  const deep = render(gl, make(true), W, H);
  const [dr, , db] = px(deep, W, 64, 64);
  if (!(dr > 200 && db < 60)) fail(`3D group should show red (higher z) on top, got rgb(${dr},_,${db})`);
  destroyGlContext(gl);
  console.log("ok: depth order beats stack order in a 3D group");
}

// --- 2. identity parity with the 2D path ----------------------------------
{
  const gl = createGl(160, 120);
  const values = {
    layerScale: 55,
    layerPositionX: 0.1,
    layerPositionY: -0.05,
    layerRotation: 30,
    layerOpacity: 80,
  };
  const flat = render(gl, [solid("a", "#22cc88", { values: { ...values } })], 160, 120);
  const deep = render(gl, [solid("a", "#22cc88", { is3D: true, values: { ...values } })], 160, 120);

  let differing = 0;
  for (let y = 4; y < 120; y += 8) {
    for (let x = 4; x < 160; x += 8) {
      const a = px(flat, 160, x, y);
      const b = px(deep, 160, x, y);
      const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      if (delta > 8) differing++;
    }
  }
  if (differing > 2) fail(`3D identity should match 2D composite; ${differing} grid samples differ`);
  destroyGlContext(gl);
  console.log("ok: 3D layer at rest matches the 2D composite path");
}

console.log("threed-smoke passed");