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

// CI's ANGLE backend reads the default framebuffer darker/quantized than a
// local mesa stack, so assert channel DOMINANCE instead of absolute values.
function dominant(a, b) {
  return a > 96 && a > b * 2.5;
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
  if (!dominant(fb, fr)) fail(`2D stack should show blue on top, got rgb(${fr},_,${fb})`);

  const deep = render(gl, make(true), W, H);
  const [dr, , db] = px(deep, W, 64, 64);
  if (!dominant(dr, db)) fail(`3D group should show red (higher z) on top, got rgb(${dr},_,${db})`);
  destroyGlContext(gl);
  console.log("ok: depth order beats stack order in a 3D group");
}

// --- scene3d: objects, lights, camera drive --------------------------------
{
  const gl = createGl(W, H);

  // 2a. A cube renders with shading (headlight fallback: top-right lighter).
  const cube = {
    id: "cube",
    type: "object3d",
    enabled: true,
    values: { ...buildLayerValues("object3d"), albedo: "#ff0000", layerRotationY: 30, layerRotationX: 20 },
  };
  const objFrame = render(gl, [cube], W, H);
  const [cr, cg, cb] = px(objFrame, W, 64, 64);
  if (!(cr > 40 && cr > cg * 1.8 && cr > cb * 1.8)) fail(`cube should render reddish at center, got rgb(${cr},${cg},${cb})`);
  const [er] = px(objFrame, W, 4, 4);
  if (er > 30) fail(`cube should not cover the frame corner, got r=${er}`);

  // 2b. A directional light layer changes the shading.
  const sun = {
    id: "sun",
    type: "light",
    enabled: true,
    values: { ...buildLayerValues("light"), intensity: 2.5, lightColor: "#ffffff" },
  };
  const litFrame = render(gl, [sun, cube], W, H);
  const [lr] = px(litFrame, W, 64, 64);
  if (Math.abs(lr - cr) < 8) fail(`light layer should change cube shading (${cr} -> ${lr})`);

  // 2c. drive3d camera: yaw shifts a 3D layer, and the plate is NOT re-tilted.
  const quad = (id, color, values = {}) => ({
    id,
    type: "solid",
    enabled: true,
    is3D: true,
    values: { ...buildLayerValues("solid"), u_color: color, layerScale: 30, ...values },
  });
  const cam = (drive, yaw) => ({
    id: "cam",
    type: "camera",
    enabled: true,
    values: { ...buildLayerValues("camera"), drive3d: drive, yaw, dofSamples: 8, blurRadius: 0 },
  });

  // Without drive: camera yaw tilts the whole plate. With drive: the 3D layer
  // gets parallax instead. Compare where the small quad lands.
  const centerColumn = (pixels) => {
    let minX = W, maxX = -1;
    for (let x = 0; x < W; x++) {
      const [r] = px(pixels, W, x, 64);
      if (r > 80) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    return (minX + maxX) / 2;
  };

  const noDrive = render(gl, [cam(false, 0), quad("q", "#ff0000")], W, H);
  const drive = render(gl, [cam(true, 25), quad("q", "#ff0000", { layerPositionZ: 0.3 })], W, H);
  const cNo = centerColumn(noDrive);
  const cDrive = centerColumn(drive);
  if (!(cNo > 48 && cNo < 80)) fail(`baseline quad should sit near center, got ${cNo}`);
  if (!(Math.abs(cDrive - cNo) > 4)) fail(`drive3d yaw should shift the 3D layer (center ${cNo} -> ${cDrive})`);

  // 2d. Quads accept lights: with a light in the group, toggling the
  // material option changes the quad's brightness (relative compare).
  const dimSun = {
    id: "dimsun",
    type: "light",
    enabled: true,
    values: { ...buildLayerValues("light"), intensity: 0.5, ambient: 0.05, lightColor: "#ffffff" },
  };
  const litQuad = (accepts) => [
    dimSun,
    { id: "q", type: "solid", enabled: true, is3D: true,
      values: { ...buildLayerValues("solid"), u_color: "#808080", layerScale: 60, layerAcceptsLights: accepts } },
  ];
  const acceptOn = render(gl, litQuad(1), W, H);
  const acceptOff = render(gl, litQuad(0), W, H);
  const [onR] = px(acceptOn, W, 64, 64);
  const [offR] = px(acceptOff, W, 64, 64);
  if (!(Math.abs(onR - offR) > 12)) {
    fail(`accepts-lights should change quad shading (on ${onR} vs off ${offR})`);
  }
  // No lights in the group -> the toggle must be a no-op (emissive).
  const aloneOn = render(gl, [litQuad(1)[1]], W, H);
  const aloneOff = render(gl, [litQuad(0)[1]], W, H);
  const [aOnR] = px(aloneOn, W, 64, 64);
  const [aOffR] = px(aloneOff, W, 64, 64);
  if (Math.abs(aOnR - aOffR) > 4) {
    fail(`accepts-lights must be a no-op without lights (${aOnR} vs ${aOffR})`);
  }

  destroyGlContext(gl);
  console.log("ok: objects shade, lights matter, drive3d camera moves 3D layers, quads accept lights");
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