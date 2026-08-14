# syntax=docker/dockerfile:1
# node:22 (LTS, glibc): official node-gyp headers from nodejs.org and a working
# prebuild ecosystem. Alpine/musl + odd-numbered Node releases force `gl` to
# compile against unofficial-builds.nodejs.org, which is flaky and broke builds.
FROM node:22-bookworm-slim AS base
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=/usr/local/bun/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip bash \
      build-essential pkg-config python3 python-is-python3 \
      libxi-dev libglu1-mesa-dev libglew-dev \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash

# --- Dependencies (workspace-aware: bun needs every workspace manifest) ---
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/vue/package.json packages/vue/package.json
# gl compiles here against Node 22 headers (official mirror, reliable).
RUN bun install --frozen-lockfile

# --- Build ---
FROM base AS build
WORKDIR /app
# Copy the whole install tree: bun workspaces hoist some packages to the root
# node_modules but keep workspace-local binaries (tsup, nuxt) in
# packages/*/node_modules and apps/*/node_modules.
COPY --from=deps /app /app
COPY . .
RUN bun run --cwd packages/core build
RUN cd apps/web && bunx nuxt build
# The OG renderer needs the compiled gl binding inside the traced output;
# fail the build loudly if nitro stops tracing it.
RUN test -f apps/web/.output/server/node_modules/gl/build/Release/webgl.node \
    || (echo "gl native binding missing from server output" && exit 1)

# --- Runtime ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0 NITRO_PORT=3000 PORT=3000
# xvfb + GL runtime libs: headless WebGL2 (OG images) needs a display and GL.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates xvfb xauth \
      libgl1 libglu1-mesa libglew2.2 libxi6 libxext6 libx11-6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/apps/web/.output ./.output
# Migrations run on boot (server/plugins/migrate-on-boot.ts); ship the SQL.
COPY --from=build /app/apps/web/server/database/migrations ./migrations
ENV NUXT_MIGRATIONS_DIR=/app/migrations
EXPOSE 3000
# Xvfb runs as a background child; `exec` makes node PID 1 so SIGTERM reaches
# it directly (atlasflow's deploy contract requires graceful SIGTERM stops —
# an xvfb-run bash wrapper as PID 1 would swallow the signal).
ENV DISPLAY=:99
CMD ["/bin/sh", "-c", "Xvfb :99 -screen 0 1280x720x24 -nolisten tcp & exec node .output/server/index.mjs"]
