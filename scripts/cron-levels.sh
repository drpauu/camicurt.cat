#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

if [[ "$MODE" != "daily" ]]; then
  echo "Usage: scripts/cron-levels.sh daily" >&2
  exit 1
fi

if [[ -f "$ROOT/.env.cron" ]]; then
  set -a
  . "$ROOT/.env.cron"
  set +a
fi

cd "$ROOT"
node scripts/generate-level.mjs "$MODE"
