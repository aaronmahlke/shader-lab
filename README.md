# Shader Lab

Monorepo for the Shader Lab editor and renderer packages.

## Structure

```
apps/web/          @shader-lab/web — Nuxt editor app
packages/core/     @shader-lab/core — raw WebGL composition renderer
packages/vue/      @shader-lab/vue — Vue wrapper component
```

## Environment

Env vars live in the **repo root** `.env` (shared across the monorepo). `apps/web/.env` can override individual values.

Copy `.env.example` to `.env` at the repo root before running dev.

```bash
bun install
bun run dev          # start editor
bun run build        # build core + web
bun run core:build   # build @shader-lab/core only
cd packages/core && bun test  # run core unit tests
```

## Packages

- **@shader-lab/core** — compiler, modulation engine, browser renderer, and Node headless export. See [packages/core/README.md](packages/core/README.md).
- **@shader-lab/vue** — `<ShaderComposition :config="..." />` wrapper for external consumers.

### Drive a staged component with a timeline cursor

On a 2D **Image** layer, set **Pointer role → Timeline cursor (anchor tip)**.
Place the layer anchor at the tip of your cursor artwork. Animate Position as
usual; keyframe **Cursor press** to 1 for down and 0 for up (use hold keys for
sharp edges; the threshold is 0.5). No matching keys or props are needed on
the target component. At each sample the topmost enabled, visible cursor drives
the first hit among the open composition’s 2D component layers in stack order.

The mounted DOM determines the target, including transformed descendants and
pointer-transparent overlays. Ordinary authored CSS selectors such as
`button:hover` and `button:active .icon` work in preview and DOM capture.
For JS-driven visuals, listen on the element with `@stagepointerstate` and
assign `event.detail.hover` / `event.detail.pressed` to view state. These are
absolute states, including on reverse seeks, not replayed click actions.
The editor never sends a click, moves focus, or follows a link on release.

This interaction is between DOM targets and one image cursor in the same
open comp. Shader/media overlays aren't DOM hit targets; nested-comp, 3D,
shadow DOM and cross-origin stylesheet targeting are not supported.
