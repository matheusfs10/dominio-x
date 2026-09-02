#!/usr/bin/env bash
# Provisions the Railway infrastructure for Dominio-X (idempotent where the CLI allows).
#
# Prerequisites: `railway login` (or RAILWAY_API_TOKEN), run from the repository root.
# Region: US East (Virginia). Bucket region: iad.
#
# Usage:
#   scripts/railway-bootstrap.sh core       # dominio-x-core: postgres, redis, web, api, worker, scheduler, bucket
#   scripts/railway-bootstrap.sh crawlers   # dominio-x-crawlers: crawler
#   scripts/railway-bootstrap.sh secrets    # generates SESSION_SECRET / CRAWLER_MACHINE_TOKEN and sets variables
set -euo pipefail

REGION="${RAILWAY_REGION:-us-east4-eqdc4a}"
BUCKET_REGION="${RAILWAY_BUCKET_REGION:-iad}"
CORE_PROJECT="dominio-x-core"
CRAWLER_PROJECT="dominio-x-crawlers"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need railway
railway whoami >/dev/null 2>&1 || { echo "Not logged in. Run: railway login" >&2; exit 1; }

project_exists() { railway list 2>/dev/null | grep -qx "$1" || railway list 2>/dev/null | grep -q "$1"; }

link_or_init() {
  local name="$1"
  if project_exists "$name"; then
    echo "Project $name exists; linking."
    railway link --project "$name" >/dev/null
  else
    echo "Creating project $name."
    railway init --name "$name" >/dev/null
  fi
}

add_service() {
  local name="$1"
  if railway status 2>/dev/null | grep -q "$name"; then
    echo "  service $name exists"
  else
    railway add --service "$name" >/dev/null && echo "  service $name created"
  fi
}

case "${1:-}" in
  core)
    link_or_init "$CORE_PROJECT"
    railway status 2>/dev/null | grep -qi postgres || railway add --database postgres >/dev/null
    railway status 2>/dev/null | grep -qi redis || railway add --database redis >/dev/null
    for s in web api worker scheduler-registro-br; do add_service "$s"; done
    if railway bucket list 2>/dev/null | grep -q dominio-x-data; then
      echo "  bucket dominio-x-data exists"
    else
      railway bucket create dominio-x-data --region "$BUCKET_REGION" >/dev/null && echo "  bucket created"
    fi
    echo
    echo "Next: in the Railway dashboard, for each service set:"
    echo "  - Source: this GitHub repo, root directory / (shared monorepo)"
    echo "  - Config file path: apps/<service>/railway.json (scheduler → apps/scheduler/railway.json)"
    echo "  - Region: $REGION"
    echo "  - Variables: see docs/railway.md (DATABASE_URL/REDIS_URL via reference variables, bucket via 'railway bucket credentials')"
    echo "Then run: scripts/railway-bootstrap.sh secrets"
    ;;
  crawlers)
    link_or_init "$CRAWLER_PROJECT"
    add_service crawler
    echo "Set crawler variables (NODE_ENV, CRAWLER_CORE_API_URL, CRAWLER_MACHINE_TOKEN, CRAWLER_* limits, LOG_LEVEL)."
    echo "Config file path: apps/crawler/railway.json. Never add DATABASE_URL/REDIS_URL/SEMRUSH_* here."
    ;;
  secrets)
    railway link --project "$CORE_PROJECT" >/dev/null
    SESSION_SECRET="$(openssl rand -hex 32)"
    CRAWLER_MACHINE_TOKEN="$(openssl rand -hex 32)"
    for s in api worker scheduler-registro-br; do
      railway variables --service "$s" --set "SESSION_SECRET=$SESSION_SECRET" --set "CRAWLER_MACHINE_TOKEN=$CRAWLER_MACHINE_TOKEN" --skip-deploys >/dev/null
    done
    railway link --project "$CRAWLER_PROJECT" >/dev/null
    railway variables --service crawler --set "CRAWLER_MACHINE_TOKEN=$CRAWLER_MACHINE_TOKEN" --skip-deploys >/dev/null
    unset SESSION_SECRET CRAWLER_MACHINE_TOKEN
    echo "Secrets generated and set (not printed)."
    ;;
  *)
    echo "usage: $0 core|crawlers|secrets" >&2
    exit 2
    ;;
esac
