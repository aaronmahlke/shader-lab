#!/usr/bin/env node
// Bakes the layer-catalog preview thumbnails into public/previews/<type>.webp.
//
// Two runtimes because no single one can do both jobs on Linux:
//   1. Bun runs the shared TypeScript preview-stack module and dumps JSON
//      (scripts/dump-preview-stacks.ts) - but Bun cannot load the NAN-based
//      native `gl` module.
//   2. Node renders each stack through the real headless WebGL2 pipeline
//      (packages/core/dist/server.js) - but Node cannot import the .ts module.
//
// Requires a display for `gl`: run under xvfb, e.g.
//   xvfb-run -a node scripts/generate-catalog-previews.mjs
// or via `bun run previews:generate` (see package.json).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webRoot, "..", "..");
const outDir = join(webRoot, "public", "previews");
const stbnPath = join(webRoot, "public", "textures", "stbn-scalar-128x64.png");
const serverEntry = pathToFileURL(join(repoRoot, "packages", "core", "dist", "server.js")).href;

// Render at 2x the ~280x210 card. Settings mirror the live hover preview's
// 960x540 offscreen canvas so text sizes match (contentScale = 420/540).
const WIDTH = 560;
const HEIGHT = 420;
const SETTINGS = { width: 960, height: 540, fps: 60, duration: 5 };

// Step 1: serialize the TS preview stacks with bun.
const stacksPath = join(tmpdir(), "preview-stacks.json");
const bunBin = process.env.BUN_BIN ?? join(homedir(), ".bun", "bin", "bun");
const dump = spawnSync(bunBin, ["scripts/dump-preview-stacks.ts", stacksPath], {
  cwd: webRoot,
  stdio: "inherit",
});
if (dump.status !== 0) {
  console.error("dump-preview-stacks.ts failed");
  process.exit(1);
}

const stacks = JSON.parse(readFileSync(stacksPath, "utf8"));

// Step 2: render each stack headlessly and encode to webp.
const { renderCompositionToBuffer } = await import(serverEntry);
mkdirSync(outDir, { recursive: true });

let failures = 0;
for (const { type, time, layers } of stacks) {
  if (!Array.isArray(layers) || layers.length === 0) {
    console.error(`skip ${type}: empty preview stack`);
    failures++;
    continue;
  }

  const config = {
    version: 1,
    settings: SETTINGS,
    lfos: [],
    assignments: [],
    tracks: [],
    layers,
  };

  const png = await renderCompositionToBuffer(config, {
    width: WIDTH,
    height: HEIGHT,
    time,
    stbnPath,
  });
  if (!png) {
    console.error(`render failed for ${type}`);
    failures++;
    continue;
  }

  const pngPath = join(tmpdir(), `catalog-preview-${type}.png`);
  const webpPath = join(outDir, `${type}.webp`);
  writeFileSync(pngPath, png);
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", pngPath, "-quality", "80", webpPath],
      { stdio: "inherit" },
    );
  } finally {
    unlinkSync(pngPath);
  }

  const kb = (statSync(webpPath).size / 1024).toFixed(1);
  console.log(`ok ${type}.webp (${kb} KB, t=${time})`);
}

if (failures > 0) {
  console.error(`${failures} preview(s) failed`);
  process.exit(1);
}
console.log(`done: ${stacks.length} previews in ${outDir}`);
