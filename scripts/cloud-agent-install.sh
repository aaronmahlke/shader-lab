#!/usr/bin/env bash
# Idempotent repository bootstrap for the Cursor Cloud Agent environment.
# Runs after the repo is checked out. System packages (Bun, PostgreSQL, mesa/GL,
# Xvfb, SeaweedFS) are provided by the base snapshot; this script only refreshes
# repo-derived state.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "[install] bun $(bun --version)"

# Install JS workspace dependencies.
bun install

# Build @shader-lab/core (consumed by the web app and by tests).
bun run --cwd packages/core build

echo "[install] done"
