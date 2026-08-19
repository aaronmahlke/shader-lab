#!/bin/bash
# One-shot local/dev-sandbox bootstrap: Postgres, env files, migrations.
# Idempotent — safe to re-run after a machine reset.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v psql >/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql
fi
sudo service postgresql start || true
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" >/dev/null
sudo -u postgres psql -c "CREATE DATABASE shader_lab;" 2>/dev/null || true

if [ ! -f .env ]; then
  cat > .env <<'ENV'
NUXT_DSN="postgresql://postgres:postgres@localhost:5432/shader_lab"
NUXT_SESSION_PASSWORD="dev-session-password-0123456789abcdef0123456789abcdef"
NUXT_OAUTH_GOOGLE_CLIENT_ID="dummy"
NUXT_OAUTH_GOOGLE_CLIENT_SECRET="dummy"
NUXT_AWS_ACCESS_KEY_ID="dummy"
NUXT_AWS_SECRET_ACCESS_KEY="dummy"
NUXT_AWS_REGION="us-east-1"
NUXT_AWS_S3_ENDPOINT="http://localhost:8333"
NUXT_AWS_S3_BUCKET="shader-lab"
ENV
fi
[ -f apps/web/.env ] || cp .env apps/web/.env

BUN="${BUN:-$HOME/.bun/bin/bun}"
command -v bun >/dev/null && BUN="$(command -v bun)"
[ -x "$BUN" ] || { curl -fsSL https://bun.sh/install | bash >/dev/null; BUN="$HOME/.bun/bin/bun"; }

"$BUN" install
(cd apps/web && "$BUN" run db:migrate)
echo "bootstrap done — start the editor with: cd apps/web && bun run dev"
