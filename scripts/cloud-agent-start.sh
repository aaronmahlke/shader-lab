#!/usr/bin/env bash
# Per-boot service reconciliation for the Cursor Cloud Agent environment.
# Brings up the local infrastructure the Shader Lab web app depends on:
#   - PostgreSQL      (localhost:5432, database "shader_lab")
#   - SeaweedFS S3    (localhost:8333, bucket "shader-lab")
#   - Xvfb            (:99, virtual display for headless-gl rendering)
# The script is idempotent and returns once services are ready. The web dev
# server itself is launched separately as a persistent terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# --- Environment file (shared across the monorepo) ---
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  SP="$(openssl rand -hex 24)"
  sed -i "s|^NUXT_SESSION_PASSWORD=.*|NUXT_SESSION_PASSWORD=\"$SP\"|" "$ROOT/.env"
  echo "[start] created .env from .env.example"
fi

# --- Xvfb (virtual display for headless-gl) ---
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1280x1024x24 -ac >/tmp/xvfb.log 2>&1 &
  echo "[start] launched Xvfb on :99"
fi
export DISPLAY=:99

# --- PostgreSQL ---
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do
  pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break
  sleep 1
done
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "[start] ERROR: PostgreSQL did not become ready" >&2
  exit 1
fi
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null 2>&1 || true
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='shader_lab'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE shader_lab;" >/dev/null 2>&1 || true
fi

# Sync the schema. The committed drizzle migrations begin by renaming a legacy
# "compositions" table, so they cannot run on a fresh database; push the schema
# directly instead (idempotent).
bun run --cwd apps/web db:push

# --- SeaweedFS (S3-compatible object storage) ---
SEAWEED_DIR="${SEAWEED_DIR:-$HOME/.local/share/seaweedfs}"
mkdir -p "$SEAWEED_DIR"
if ! pgrep -f "weed server" >/dev/null 2>&1; then
  nohup weed server \
    -dir="$SEAWEED_DIR" -ip=127.0.0.1 \
    -s3 -s3.port=8333 -s3.config="$ROOT/docker/seaweedfs-s3.json" \
    >/tmp/seaweedfs.log 2>&1 &
  echo "[start] launched SeaweedFS S3 on :8333"
fi
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:8333/" && break
  sleep 1
done
# Ensure the app bucket exists (idempotent).
curl -s -X PUT "http://127.0.0.1:8333/shader-lab" >/dev/null 2>&1 || true

echo "[start] ready: postgres :5432 (db shader_lab), seaweedfs :8333 (bucket shader-lab), xvfb :99"
