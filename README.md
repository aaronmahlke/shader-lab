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

### Sync points (events)

```bash
bun run shaderlab events "<project folder>" ["comp name"] [--out events.json]
```

Every moment sound can sync to, in comp time: motion segments (start, speed
peak, end; position as one move per layer), pointer press / release, layer
in / out, component cues and comp markers (`settings.markers`). Nested comps
are included with their times shifted. Components declare cues with
`useStageCues(() => [{ time, name, data }])` (layer time), e.g. one per keystroke.

### Loudness (meter)

```bash
bun run shaderlab meter "<project folder>" ["comp name"] [--out meter.json]
```

Master integrated LUFS (BS.1770 gating), short-term LUFS every 0.5 s, sample
and true peak; each root audio layer / precomp group solo; and a sync report
of every trigger hit (where its anchor lands vs. its picture event, in ms).
Matches ffmpeg's `ebur128`.
