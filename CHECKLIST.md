# Dominio-X — implementation checklist

Legend: [x] done · [~] partial / blocked · [ ] not started

## M0 — Repository foundation
- [x] pnpm + Turborepo monorepo, strict TypeScript, ESLint (type-checked), Prettier
- [x] Zod-validated configuration per process (fail fast; optional providers never block boot)
- [x] Docker Compose (postgres, redis, minio) + embedded-Postgres test setup (no Docker needed)
- [x] Docs: architecture, providers, scoring, railway, security, runbooks; CLAUDE.md; README

## M1 — Core identity and auth
- [x] PostgreSQL schema (Drizzle) + immutable migration `0000_init` (pg_trgm, all core tables)
- [x] Server-side sessions, HttpOnly/SameSite=Lax/Secure cookies, Argon2id, login rate limit
- [x] RBAC admin/analyst/viewer, CSRF origin check, audit log
- [x] Bootstrap admin via env (first seed only) + `pnpm admin:create` secure CLI

## M2 — Domain ingestion
- [x] Deterministic normalization (IDN/punycode, PSL, IP/localhost rejection, length limits) + tests
- [x] Single domain (API + UI), CSV import (row-level errors, size/row caps), dedupe by `ascii_fqdn`
- [x] Domain explorer: server-side filters, sort, keyset pagination

## M3 — Registro.br source
- [x] Watcher (conditional GET, SHA-256 dedupe, raw artifact in bucket `sources/registro-br/YYYY/MM/…`)
- [x] Immutable batches (unique source+sha), parse statistics, release period/publish metadata
- [x] Batch UI with funnel; bulk analysis enqueue
- [x] Scheduler service (Railway cron `0 */6 * * *`, exits when done) + retention

## M4 — Analysis core
- [x] BullMQ queues per stage, deterministic job ids, exponential backoff + jitter, unrecoverable errors
- [x] Lexical provider, DNS provider, run/step tracking, TTL reuse, partial/failed semantics
- [x] Queue UI (stage counters, failed runs, retry, step details)

## M5 — Isolated crawler
- [x] Separate app/project, machine-token API with job leases (claim/heartbeat/complete/fail/reclaim)
- [x] SSRF defenses (scheme/port/credentials, DNS classification, pinning, redirect re-validation, size/time caps)
- [x] HTTP observations (status, redirects, final host, title, meta description, https, server)
- [x] Security test matrix (loopback, 0.0.0.0, RFC1918, metadata, IPv6, mapped, redirects, caps)

## M6 — Rule engine
- [x] JSON DSL (all operators, RE2 regex, depth/size limits), draft/clone/activate/archive, test dry-run
- [x] Rule executions with evidence per run; conservative seed ruleset v1

## M7 — Scoring
- [x] Model v1: 8 dimensions + confidence, renormalized weights, explanation (positive/negative/missing)
- [x] Score history per run; explorer filters on scores

## M8 — Semrush
- [~] **STANDBY by operator decision** — adapter boundary, rate limiter (Redis token bucket + semaphore),
      circuit breaker, TTL/licensing, unit budget, ledger, candidate gate and usage dashboard are done;
      the outbound data path (`fetchMetrics`) is intentionally not implemented until the integration
      mode (official API vs alternative) is decided. Provider shows `decision_pending`.

## M9 — Shortlists & analyst workflow
- [x] Shortlists (create/edit/status), add/remove domains, CSV export (formula-safe)
- [x] Tags, notes, manual dispositions (additive history), blacklist, force reanalysis / deep analysis

## M10 — Railway production deployment
- [x] `railway.json` per service (build/start, watch paths, health checks, cron, pre-deploy migration)
- [x] Bootstrap/deploy/smoke scripts, GitHub Actions CI
- [ ] Projects provisioned (`dominio-x-core`, `dominio-x-crawlers`) — **blocked: Railway login required**
- [ ] Variables, bucket credentials, public domains, deploy, migrations, smoke test, deployment report

## Quality gates (local, 2026-09-02)
- [x] `pnpm lint` · `pnpm typecheck` · `pnpm test` (135 tests: unit + integration incl. API, pipeline, SSRF) · `pnpm build`
- [x] Playwright critical flow passes against the local full stack (`E2E=1 node scripts/local-stack.mjs`)
