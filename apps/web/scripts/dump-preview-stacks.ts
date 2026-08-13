// Serializes the catalog preview stacks to JSON for the node render step.
//
// getLayerPreviewStack lives in TypeScript shared with the Nuxt app; Bun runs
// it directly, but the native `gl` module cannot load under Bun on Linux, so
// rendering happens in a separate node process (generate-catalog-previews.mjs)
// that consumes this JSON.
//
// Usage: bun scripts/dump-preview-stacks.ts [outPath]
import { writeFileSync } from "node:fs";
import { LAYER_TEMPLATES } from "@shader-lab/core";
import type { LayerType } from "@shader-lab/core";
import {
  getLayerPreviewStack,
  getLayerPreviewTime,
} from "../shared/editor/layer-previews";

const outPath = process.argv[2] ?? "/tmp/preview-stacks.json";

const stacks = Object.keys(LAYER_TEMPLATES).map((type) => ({
  type,
  time: getLayerPreviewTime(type as LayerType),
  layers: getLayerPreviewStack(type as LayerType),
}));

writeFileSync(outPath, JSON.stringify(stacks, null, 2));
console.log(`wrote ${stacks.length} preview stacks to ${outPath}`);
