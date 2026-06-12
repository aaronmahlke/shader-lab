import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const qstep = 18;

function analyzePixels(w, h, pixels) {
  const x0 = Math.floor(0.35 * w);
  const x1 = Math.floor(0.65 * w);
  const y0 = Math.floor(0.35 * h);
  const y1 = Math.floor(0.55 * h);

  let three = 0;
  let four = 0;
  let total = 0;

  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    const qr = Math.floor(pixels[i] / qstep) * qstep;
    const qg = Math.floor(pixels[i + 1] / qstep) * qstep;
    const qb = Math.floor(pixels[i + 2] / qstep) * qstep;
    return `${qr},${qg},${qb}`;
  };

  for (let y = y0 + 1; y < y1 - 1; y += 2) {
    for (let x = x0 + 1; x < x1 - 1; x += 2) {
      const pts = [
        sample(x, y),
        sample(x - 1, y),
        sample(x + 1, y),
        sample(x, y - 1),
        sample(x, y + 1),
      ];
      const u = new Set(pts).size;
      if (u >= 3) three++;
      if (u >= 4) four++;
      total++;
    }
  }

  return {
    threePct: (100 * three) / total,
    fourPct: (100 * four) / total,
    total,
  };
}

function maeRgb(w, h, a, b) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

async function loadRgba(path, targetW = 1320, targetH = 742) {
  const img = await loadImage(path);
  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH).data;
}

async function main() {
  const refPath = new URL("../public/lab/grainy-dither-reference.png", import.meta.url);
  const outPath = process.argv[2];

  const w = 1320;
  const h = 742;
  const ref = await loadRgba(refPath.pathname);
  const refMetrics = analyzePixels(w, h, ref);

  console.log("=== Reference ===");
  console.log(`mid seam 3+: ${refMetrics.threePct.toFixed(1)}% · 4+: ${refMetrics.fourPct.toFixed(1)}%`);

  if (!outPath) {
    console.log("\nPass rendered PNG path as argv[2] for v4 comparison.");
    return;
  }

  const out = await loadRgba(outPath, w, h);
  const outMetrics = analyzePixels(w, h, out);
  const mae = maeRgb(w, h, ref, out);

  console.log("\n=== v4 render ===");
  console.log(`mid seam 3+: ${outMetrics.threePct.toFixed(1)}% · 4+: ${outMetrics.fourPct.toFixed(1)}%`);

  const threeGap = refMetrics.threePct - outMetrics.threePct;
  const fourGap = refMetrics.fourPct - outMetrics.fourPct;
  const threePctOfRef = (outMetrics.threePct / refMetrics.threePct) * 100;
  const fourPctOfRef = (outMetrics.fourPct / refMetrics.fourPct) * 100;

  console.log(`\nmean RGB error vs reference: ${mae.toFixed(2)} / 255`);
  console.log(`seam chroma vs reference: 3+ ${outMetrics.threePct.toFixed(1)}% (${threePctOfRef.toFixed(0)}% of ref) · 4+ ${outMetrics.fourPct.toFixed(1)}% (${fourPctOfRef.toFixed(0)}% of ref)`);
  console.log(`gap: 3+ ${threeGap >= 0 ? "−" : "+"}${Math.abs(threeGap).toFixed(1)}pp · 4+ ${fourGap >= 0 ? "−" : "+"}${Math.abs(fourGap).toFixed(1)}pp`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
