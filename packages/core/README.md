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

## API

- `createComposition(canvas, config, options?)` — browser orchestrator
- `renderCompositionToBuffer(config, options?)` — headless PNG export (`@shader-lab/core/server`)
- `CompositionRenderer` — low-level multi-pass renderer
- `ModulationEngine` — LFO sampling and modulation
- `compilePasses(layers, modFn?)` — layer stack → render pass graph
