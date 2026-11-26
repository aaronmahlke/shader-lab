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

### Render from the command line (agents, CI)

```bash
bun run shaderlab render "<project folder>" ["comp name"] --out film.mp4 [--scale 0.5] [--fps 30] [--audio-only] [--fresh]
```

Runs the editor's own export in a hidden GPU Chrome (no visible tab, no
background throttling) against the local server (or starts the built one).
Writes `film.mp4` + `film.mp4.json` (comp id, frames, fps, size, visual
fingerprint, still stretches). The render is also kept in
`<project>/.shaderlab/renders/`; when only the audio changed since, the video
is copied as is (seconds instead of minutes). `--audio-only` writes the mix as
WAV.
