#!/usr/bin/env bash
# Deploys every service from the local checkout with `railway up`.
# With GitHub autodeploy enabled, prefer pushing to main and verifying with `railway status` instead.
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need railway
railway whoami >/dev/null 2>&1 || { echo "Not logged in. Run: railway login" >&2; exit 1; }

deploy() {
  local project="$1"; shift
  railway link --project "$project" >/dev/null
  for s in "$@"; do
    echo "== $project / $s"
    railway up --service "$s" --detach
  done
}

deploy dominio-x-core api worker scheduler-registro-br web
deploy dominio-x-crawlers crawler

echo
echo "Check status with: railway status / railway logs --service <name>"
echo "Then run the smoke test: API_URL=... WEB_URL=... scripts/smoke-production.sh"
