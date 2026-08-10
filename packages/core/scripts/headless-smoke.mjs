#!/usr/bin/env node
// Headless render smoke test.
//
// Renders a small composition through the real WebGL2 pipeline (gl@9) and
// asserts a valid PNG comes back. This covers the server render path that
// `bun test` cannot exercise on Linux (Bun's V8 compat layer cannot load the
// NAN-based `gl` module there).
//
// Requires a display: xvfb-run -a node scripts/headless-smoke.mjs
// Requires a build first: bun run build
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = pathToFileURL(join(pkgRoot, "dist", "server.js")).href;

let renderCompositionToBuffer;
try {
  ({ renderCompositionToBuffer } = await import(serverEntry));
} catch (e) {
  console.error("Could not import dist/server.js - run `bun run build` first.", e.message);
  process.exit(1);
}

const stbnPath = join(
  pkgRoot,
  "..",
  "..",
  "apps",
  "web",
  "public",
  "textures",
  "stbn-scalar-128x64.png",
);

const config = {
  version: 1,
  settings: { width: 320, height: 180, fps: 30, duration: 2 },
  lfos: [],
  assignments: [],
  tracks: [],
  layers: [
    { id: "mesh", type: "mesh", enabled: true, values: {} },
    { id: "grain", type: "grain", enabled: true, values: {} },
    { id: "vignette", type: "vignette", enabled: true, values: {} },
  ],
};

const buf = await renderCompositionToBuffer(config, { time: 1, stbnPath });

if (!buf) {
  console.error("Headless render returned null (no WebGL2 context or empty pass graph).");
  process.exit(1);
}

const isPng =
  buf.length > 1000 &&
  buf[0] === 0x89 &&
  buf[1] === 0x50 &&
  buf[2] === 0x4e &&
  buf[3] === 0x47;

if (!isPng) {
  console.error(`Unexpected output: ${buf.length} bytes, not a PNG.`);
  process.exit(1);
}

console.log(`ok: rendered a ${buf.length} byte PNG through the headless WebGL2 pipeline`);
