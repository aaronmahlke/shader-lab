#!/usr/bin/env bun
/**
 * shaderlab — render comps without a visible editor tab.
 *
 *   bun tools/shaderlab.ts render <project folder> [comp name|id]
 *       [--out file.mp4] [--scale 1] [--fps 30] [--format auto|mp4|webm]
 *       [--audio-only] [--fresh] [--url http://localhost:3000]
 *
 * --fresh renders the picture even when the stored render can be reused.
 *
 * Uses the running local Shader Lab server (or starts the built one), opens
 * the comp in a hidden Chrome on the GPU with background throttling off, and
 * runs the editor's own export pipeline (so output matches the editor). The
 * render is stored in `<project>/.shaderlab/renders/` and copied to --out
 * with a sidecar `<out>.json` (comp id, frames, fps, size, fingerprint,
 * still-frame report). Exit codes: 0 ok, 1 failed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");

type Args = { _: string[]; [k: string]: string | boolean | string[] };
function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const log = (...m: unknown[]) => console.error("[shaderlab]", ...m);

async function isLocalServer(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/local/info`);
    return r.ok && (await r.json()).local === true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

/** The running local server, or the built one started for this render. */
async function ensureServer(preferred: string): Promise<{ url: string; child?: ChildProcess }> {
  if (await isLocalServer(preferred)) return { url: preferred };
  const entry = join(REPO, "apps/web/.output/server/index.mjs");
  if (!existsSync(entry)) throw new Error(`No local server at ${preferred} and no build at ${entry} (run: bun run build)`);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  log(`starting local server on ${url}`);
  const child = spawn(process.execPath.includes("bun") ? "node" : process.execPath, [entry], {
    env: { ...process.env, NUXT_LOCAL_MODE: "1", PORT: String(port), HOST: "127.0.0.1", NUXT_SESSION_PASSWORD: randomBytes(32).toString("hex") },
    stdio: "ignore",
  });
  for (let i = 0; i < 200; i++) {
    if (await isLocalServer(url)) return { url, child };
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error("Local server did not start");
}

async function api<T>(url: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${url}${path}`, init);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300));
  return (await r.json()) as T;
}

async function render(args: Args) {
  const folder = resolve(String(args._[1] ?? "."));
  const compArg = args._[2] ? String(args._[2]) : null;
  const audioOnly = args["audio-only"] === true;
  const { url, child } = await ensureServer(String(args.url ?? process.env.SHADERLAB_URL ?? "http://localhost:3000"));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    const project = await api<{ id: string; name: string }>(url, "/api/local/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: folder }),
    });
    const full = await api<{ compositions: { id: string; name: string }[] }>(url, `/api/projects/${project.id}`);
    const comp =
      (compArg && full.compositions.find((c) => c.id === compArg || c.name === compArg || c.name.toLowerCase().includes(compArg.toLowerCase()))) ||
      (!compArg ? full.compositions[0] : null);
    if (!comp) throw new Error(`No comp "${compArg}" in ${project.name}: ${full.compositions.map((c) => c.name).join(", ")}`);
    log(`${project.name} → ${comp.name}${audioOnly ? " (audio only)" : ""}`);

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      // Renders take as long as they take (long comps run for minutes).
      protocolTimeout: 0,
      defaultViewport: { width: 1280, height: 800 },
      args: [
        // GPU (Metal through ANGLE on macOS), never software rendering.
        "--use-angle=metal",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-webgpu",
        // A render tab must never be throttled (the frozen-from-8.8s export).
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("page error:", String(e).slice(0, 300)));
    await page.goto(`${url}/shader/${comp.id}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => (window as any).__shaderlab?.ready?.(), { timeout: 120_000 });
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    log(`GPU: ${gpu}`);
    if (/swiftshader|software|llvmpipe/i.test(gpu)) log("warning: software rendering — this will be slow");
    // Let nested comps, components, fonts and media settle.
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 3000));

    const started = Date.now();
    const progress = setInterval(async () => {
      const p = await page.evaluate(() => {
        const s = (window as any).__shaderlabProgress;
        return s ? { f: s.currentFrame, n: s.totalFrames } : null;
      }).catch(() => null);
      if (p?.n) {
        const secs = (Date.now() - started) / 1000;
        process.stderr.write(`\r[shaderlab] frame ${p.f}/${p.n}  ${(p.f / Math.max(secs, 0.001)).toFixed(1)} fps   `);
      }
    }, 1000);
    const opts = {
      audioOnly,
      scale: args.scale ? Number(args.scale) : undefined,
      fps: args.fps ? Number(args.fps) : undefined,
      format: args.format ? String(args.format) : undefined,
      fresh: args.fresh === true,
    };
    const result = await page.evaluate((o) => (window as any).__shaderlab.render(o), opts as never);
    clearInterval(progress);
    process.stderr.write("\n");
    const r = result as { ok: boolean; error?: string; meta?: Record<string, unknown>; stored?: { path: string }; frozen?: [number, number][]; reusedVideo?: boolean };
    if (!r.ok || !r.stored) throw new Error(r.error ?? "Render failed (not stored)");

    const ext = r.stored.path.split(".").pop();
    const out = resolve(String(args.out ?? `${comp.name.replace(/[^\w.-]+/g, "-")}.${ext}`));
    copyFileSync(r.stored.path, out);
    writeFileSync(`${out}.json`, JSON.stringify({ ...r.meta, project: project.name, comp: comp.name }, null, 2));
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log(`${r.reusedVideo ? "reused video (audio changed only), " : ""}done in ${secs}s → ${out}`);
    if (r.frozen?.length) {
      log(`still stretches (≥ 1 s, check they're intended): ${r.frozen.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}s`).join(", ")}`);
    }
    return 0;
  } finally {
    await browser?.close().catch(() => {});
    child?.kill();
  }
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === "render") {
  render(args)
    .then((code) => process.exit(code))
    .catch((err) => {
      log("error:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
} else {
  console.error("usage: bun tools/shaderlab.ts render <project folder> [comp] [--out f.mp4] [--scale 1] [--fps 30] [--format auto|mp4|webm] [--audio-only] [--fresh]");
  process.exit(cmd ? 1 : 0);
}
