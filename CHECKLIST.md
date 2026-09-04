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
- [x] API-based provisioning script + `.railway/railway.ts` (build/start, health checks, cron, pre-deploy migration)
- [x] Smoke script, GitHub Actions CI (green)
- [x] Projects provisioned: `dominio-x-core` (Postgres, Redis, bucket, web/api/worker, domains, variables), `dominio-x-crawlers`
- [x] `api`, `web`, `worker` deployed and healthy (migrations applied, seed + admin bootstrap done)
- [x] `crawler` deployed in its isolated project and verified end to end in production (job lease → HTTPS fetch → observations)
- [x] Production smoke test passes (health, ready, web, login, submit, analysis completed, detail, logout)
- [x] Artifact storage on the Railway bucket `data-dominio-x` (created in the dashboard; api/worker/scheduler use `${{data-dominio-x.*}}` references)
- [x] `scheduler-registro-br` deployed (cron `0 */6 * * *` UTC, exits when done); Postgres volume 5 GB, Redis 2 GB
- [x] Registro.br production verification: 158,227 domains ingested (0 invalid), raw artifact in the bucket, immutable batch, analyses enqueued, second run reports 304 with no new batch; failed batches are resumed automatically

## M11 — DataForSEO (tráfego estimado por país)
- [x] Adapter isolado `packages/providers/src/dataforseo/` (client + mapping); nenhuma URL ou campo
      do fornecedor fora do diretório
- [x] Endpoint DataForSEO Labs `historical_bulk_traffic_estimation` (janela de N meses completos,
      `location_code` configurável — 2076 = Brasil por padrão)
- [x] **Gate gratuito de qualificação** (`traffic-gate.ts`): forma do nome (dígitos, hífens, tamanho,
      aleatoriedade, punycode, dicionário, TLD), evidência de rede (DNS/HTTP/gate de candidatos),
      carência por domínio, limites por lote/dia/mês e orçamento mensal em US$ + saldo mínimo
- [x] Estágio `traffic` no pipeline (após `seo`), reuso por TTL, motivo do bloqueio registrado por
      checagem; `PIPELINE_VERSION` 1.1.0
- [x] Custo real informado pelo provedor gravado no ledger (`provider_requests.estimated_cost_usd`)
- [x] Migração `0001_dataforseo_traffic` (colunas de tráfego em `domain_summaries`)
- [x] UI pt-BR: card de visitantes estimados no domínio, formulário do gate em Configurações,
      custos/bloqueios em Uso e custos, filtros e ordenação no explorador
- [x] Modelo de pontuação v2 semeado como **rascunho** (`useTrafficSignals`); v1 segue ativo
- [ ] Verificação em produção com credenciais reais (aguarda o operador definir os limites e ligar
      `DATAFORSEO_ENABLED`)

## Quality gates (local, 2026-09-02)
- [x] `pnpm lint` · `pnpm typecheck` · `pnpm test` (135 tests: unit + integration incl. API, pipeline, SSRF) · `pnpm build`
- [x] Playwright critical flow passes against the local full stack (`E2E=1 node scripts/local-stack.mjs`)
