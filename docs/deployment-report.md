# Deployment report — 2026-09-02

## Status: application complete and verified locally; Railway provisioning blocked on authentication

| Item | Status |
| --- | --- |
| Railway projects (`dominio-x-core`, `dominio-x-crawlers`) | **not created** — `railway login` required (see "Blockers") |
| Services / IDs / public URLs | n/a until provisioning |
| Database migrations | `0000_init` applied and verified on the embedded test/stack Postgres; production pending |
| Providers configured | lexical, dns, crawler (isolated), rdap (disabled by default) |
| Providers disabled | **Semrush — standby**: integration mode (official API vs alternative) not yet decided by the operator; adapter reports `decision_pending`, never calls out |
| Tests | lint ✓ · typecheck ✓ · unit+integration 135/135 ✓ · build (6/6) ✓ · Playwright critical flow ✓ (local stack) |

## Blockers (need the operator)

1. **Railway authentication.** Nothing on Railway can be created without it. Additionally, on this
   Windows machine Microsoft Defender quarantined the Railway CLI binary
   (`railway.exe` from the official `@railway/cli` npm postinstall, detection
   `Trojan:Win32/Wacatac.H!ml`, a known false positive on the Rust GNU build). Options:
   - restore/allow the file in Windows Security and run `railway login`, or
   - install the CLI through another channel (e.g. Scoop `scoop install railway`), or
   - provide a `RAILWAY_API_TOKEN` (account token) so provisioning can be done through the Railway
     GraphQL API instead of the CLI.
2. **Semrush integration decision** — until decided, M8 stays in standby by design.

## What is ready for deployment

- `apps/*/railway.json` (build/start commands, watch paths, health checks, cron, pre-deploy migration)
- `scripts/railway-bootstrap.sh` (`core`, `crawlers`, `secrets`), `scripts/railway-deploy.sh`,
  `scripts/smoke-production.sh`
- `docs/railway.md` with the exact variables per service (private DB/Redis references, bucket credentials,
  crawler-only variables) and the post-deploy Registro.br verification procedure
- GitHub Actions CI (`.github/workflows/ci.yml`) with Postgres/Redis service containers

## Deployment steps once unblocked

```bash
railway login
scripts/railway-bootstrap.sh core        # creates project, postgres, redis, services, bucket
scripts/railway-bootstrap.sh crawlers
scripts/railway-bootstrap.sh secrets     # SESSION_SECRET / CRAWLER_MACHINE_TOKEN (never printed)
# dashboard: config file paths, DATABASE_URL/REDIS_URL references, bucket → S3_* vars, APP_URL/API_URL,
#            API_INTERNAL_URL on web, BOOTSTRAP_ADMIN_* (temporary) on api, region US East
scripts/railway-deploy.sh                # or push to main with autodeploy
railway run --service api node packages/database/dist/seed.js --no-dev    # reference data + admin
API_URL=… WEB_URL=… SMOKE_EMAIL=… SMOKE_PASSWORD=… scripts/smoke-production.sh
# then trigger scheduler-registro-br once and verify per docs/railway.md
```

## Remaining non-blocking improvements

- Semrush data path (`fetchMetrics` + field mapping) after the integration decision
- Reputation / backlink / history providers (adapter slots exist; scoring reports them as missing)
- Move `domain_summaries` rebuild into a maintenance command for disaster recovery
- Playwright E2E in CI (needs a running stack; `scripts/local-stack.mjs` can serve as the CI harness)
- `EXPLAIN` review of the explorer query with a production-sized dataset (indexes exist for every filter)
