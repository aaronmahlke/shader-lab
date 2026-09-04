# @shader-lab/core

WebGL2 multi-pass composition renderer for Shader Lab.

## Install

```bash
npm install @shader-lab/core
```

## Browser

```ts
import { createComposition } from "@shader-lab/core";

const canvas = document.querySelector("canvas")!;
const composition = createComposition(canvas, config, { autoplay: true });
composition.play();
```

## Server (OG images, thumbnails)

```ts
import { renderCompositionToBuffer } from "@shader-lab/core/server";
```

## Component layers (live DOM capture)

A `component` layer renders a texture the host captures from a live DOM
element (adapted from evlog's Render labs capture pipeline, MIT © Hugo
Richard). Core stays synchronous and environment-agnostic: the host owns the
async capture and pushes frames per layer; the renderer re-uploads only when
a new frame arrives.

```ts
renderer.setComponentSource(layer.id, {
  frame: capturedImage,   // TexImageSource, or { width, height, data } in node
  cssWidth: 640,          // layout size in composition px
  cssHeight: 360,         // (the frame itself is usually supersampled)
});
renderer.setComponentSource(layer.id, null); // free source + GPU texture
```

Without a pushed source the layer renders fully transparent, so headless
exports degrade to an invisible layer instead of a wrong one.

## API

- `createComposition(canvas, config, options?)` — browser orchestrator
- `renderCompositionToBuffer(config, options?)` — headless PNG export (`@shader-lab/core/server`)
- `CompositionRenderer` — low-level multi-pass renderer
- `CompositionRenderer.setComponentSource(layerId, source)` — push captured component frames
- `ModulationEngine` — LFO sampling and modulation
- `bakeLfoAssignments(config, options?)` — freeze LFO assignments into keyframe tracks
- `compilePasses(layers, modFn?)` — layer stack → render pass graph

## Baking LFOs to keyframes

`bakeLfoAssignments` samples each `ModulationAssignment` through the same
`ModulationEngine` playback uses, then thins the samples to the fewest linear
keyframes that stay within `tolerance` (default 1% of that parameter's
peak-to-peak swing) of the sampled curve. It returns a new config with the
baked assignments removed and `enabled` tracks written, plus a per-assignment
report of what was baked or skipped.

```ts
const { config: baked, baked: written, skipped } = bakeLfoAssignments(config);
```

Parameters that already have keyframes are skipped unless `overwrite` is set,
since a keyframed track wins over an LFO at render time. LFO sources stay in
the config — other assignments may still reference them.

## Camera layer (tilted plate, DOF, bloom)

A `camera` layer films everything below it in the stack as a plate on a 3D
plane: tilt/yaw/roll, zoom, fov, focus (position across the plate's depth
span), aperture and max blur, plus a bloom chain, exposure and an ACES
toggle. Every float parameter is keyframeable, so camera moves and focus
racks are ordinary timeline animation. The lens chain renders in linear
half-float targets (RGBA8 fallback) and compiles into a 10-pass sub-graph.
Pipeline structure adapted from evlog's Render labs (MIT, (c) 2026 HugoRCD).
