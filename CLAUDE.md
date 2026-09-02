# Dominio-X — engineering rules for Claude Code

Master specification: `docs/DOMINIO-X-CLAUDE-CODE.md` (copy of the operator's spec). Implementation
status: `CHECKLIST.md`. Architecture: `docs/architecture.md`.

## Non-negotiable rules

1. **Providers are adapters.** No vendor field names or endpoint URLs outside `packages/providers/src/<vendor>/`.
   Everything is normalized to generic metric keys (`packages/contracts/src/metrics.ts`).
2. **Evidence-first.** Every score/disposition is traceable to observations, analysis run, ruleset version and
   score-model version. Never mutate historic rows; a reanalysis creates new rows.
3. **Cheap-first funnel.** Paid providers run only after the candidate gate and within budget. No unbounded
   provider loops. Batch imports never trigger paid calls directly.
4. **Unknown ≠ zero.** Observation `state` is `measured | unknown | not_available | error`. Rules and scores
   only use `measured` values. Missing Semrush data is never a "zero-quality" signal.
5. **Version what changes decisions:** rulesets, score models, pipeline version, normalization version.
6. **Crawler isolation.** HTTP fetching only in `apps/crawler` (separate Railway project) through the machine
   API. SSRF policy in `apps/crawler/src/security/` must keep its test matrix green.
7. **Secrets:** never committed, never logged (pino redaction), never returned by the API.
8. **Migrations are immutable** and run once per deploy (api pre-deploy command), never at boot.
   Railway settings live in `scripts/railway-provision.mjs` + `.railway/railway.ts` (`railway.json` is deprecated).
9. **Semrush integration mode is on STANDBY** (`packages/providers/src/semrush/mode.ts`). Do not implement
   scraping. When the operator decides, implement `fetchMetrics()` + `mapping.ts` only.

## Commands

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm db:generate   # after editing packages/database/src/schema
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Tests: `vitest` with an embedded PostgreSQL (no Docker needed); Redis-dependent tests skip when
no Redis is reachable (`REDIS_URL` / `TEST_REDIS_URL`).
