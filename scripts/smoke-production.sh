#!/usr/bin/env bash
# Production smoke test for Dominio-X.
#
# Required env:
#   API_URL        public API base URL (https://...)
#   WEB_URL        public web base URL (https://...)
# Optional env (authenticated part of the test):
#   SMOKE_EMAIL / SMOKE_PASSWORD   an analyst or admin account
#   SMOKE_DOMAIN   domain to submit (default: example.com — harmless, no paid provider is triggered)
#   SMOKE_TIMEOUT  seconds to wait for the local analysis (default 180)
#   DB_PUBLIC_HOST / DB_PUBLIC_PORT  when set, verifies the database is NOT reachable publicly
#
# Never prints secrets.
set -euo pipefail

: "${API_URL:?API_URL is required}"
: "${WEB_URL:?WEB_URL is required}"
SMOKE_DOMAIN="${SMOKE_DOMAIN:-example.com}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-180}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; exit 1; }

echo "1) API /health"
curl -fsS --max-time 15 "$API_URL/health" | grep -q '"status":"ok"' && pass "api health" || fail "api health"

echo "2) API /ready"
curl -fsS --max-time 15 "$API_URL/ready" | grep -q '"status":"ready"' && pass "api ready (db+redis)" || fail "api ready"

echo "3) Web /api/health"
curl -fsS --max-time 15 "$WEB_URL/api/health" | grep -q '"status":"ok"' && pass "web health" || fail "web health"

echo "4) Web login page"
curl -fsS --max-time 20 "$WEB_URL/login" | grep -qi "dominio-x" && pass "web renders" || fail "web renders"

if [[ -n "${DB_PUBLIC_HOST:-}" ]]; then
  echo "5) Database must not be publicly reachable"
  if timeout 5 bash -c "cat < /dev/null > /dev/tcp/${DB_PUBLIC_HOST}/${DB_PUBLIC_PORT:-5432}" 2>/dev/null; then
    fail "database port is reachable from the internet"
  else
    pass "database port closed"
  fi
fi

if [[ -z "${SMOKE_EMAIL:-}" || -z "${SMOKE_PASSWORD:-}" ]]; then
  echo "SMOKE_EMAIL/SMOKE_PASSWORD not set: skipping authenticated checks."
  exit 0
fi

echo "6) Login"
LOGIN_BODY="$(printf '{"email":"%s","password":"%s"}' "$SMOKE_EMAIL" "$SMOKE_PASSWORD")"
curl -fsS --max-time 20 -c "$COOKIE_JAR" -H "content-type: application/json" -H "origin: $WEB_URL" \
  -d "$LOGIN_BODY" "$API_URL/v1/auth/login" >/dev/null && pass "login" || fail "login"
unset LOGIN_BODY

echo "7) Submit $SMOKE_DOMAIN"
SUBMIT="$(curl -fsS --max-time 20 -b "$COOKIE_JAR" -H "content-type: application/json" -H "origin: $WEB_URL" \
  -d "{\"domain\":\"$SMOKE_DOMAIN\",\"analyze\":true}" "$API_URL/v1/domains")"
DOMAIN_ID="$(printf '%s' "$SUBMIT" | sed -n 's/.*"domain":{"id":"\([^"]*\)".*/\1/p')"
RUN_ID="$(printf '%s' "$SUBMIT" | sed -n 's/.*"run":{"id":"\([^"]*\)".*/\1/p')"
[[ -n "$DOMAIN_ID" ]] && pass "domain id $DOMAIN_ID" || fail "domain submission"
[[ -n "$RUN_ID" ]] && pass "analysis run $RUN_ID" || echo "  [INFO] no new run created (one already active)"

echo "8) Wait for local analysis (max ${SMOKE_TIMEOUT}s)"
deadline=$(( $(date +%s) + SMOKE_TIMEOUT ))
status="unknown"
while [[ $(date +%s) -lt $deadline ]]; do
  status="$(curl -fsS --max-time 20 -b "$COOKIE_JAR" "$API_URL/v1/domains/$DOMAIN_ID" | sed -n 's/.*"latestRunStatus":"\([a-z_]*\)".*/\1/p')"
  case "$status" in
    completed|partial) break ;;
    failed) fail "analysis failed" ;;
  esac
  sleep 5
done
[[ "$status" == "completed" || "$status" == "partial" ]] && pass "analysis $status" || fail "analysis did not finish in time (status: $status)"

echo "9) Domain detail"
curl -fsS --max-time 20 -b "$COOKIE_JAR" "$API_URL/v1/domains/$DOMAIN_ID" | grep -q '"latestScore":{' && pass "score present" || fail "score missing"

echo "10) Logout"
curl -fsS --max-time 20 -b "$COOKIE_JAR" -H "origin: $WEB_URL" -X POST "$API_URL/v1/auth/logout" >/dev/null && pass "logout" || fail "logout"

echo "Smoke test passed."
