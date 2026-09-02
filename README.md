# Dominio-X

Internal domain-intelligence platform: ingests domain lists (Registro.br release list, CSV, manual),
enriches them through pluggable providers, applies versioned rules and transparent scoring, and lets
analysts build shortlists with full evidence and audit trails.

- Spec: [`docs/DOMINIO-X-CLAUDE-CODE.md`](docs/DOMINIO-X-CLAUDE-CODE.md)
- Status / checklist: [`CHECKLIST.md`](CHECKLIST.md)
- Docs: [architecture](docs/architecture.md) · [providers](docs/providers.md) · [scoring](docs/scoring.md) ·
  [railway](docs/railway.md) · [security](docs/security.md) · [runbooks](docs/runbooks.md)

## Stack

Node 24 · TypeScript · pnpm workspaces + Turborepo · Next.js 16 (web) · Fastify 5 (api) · BullMQ (queue) ·
Drizzle + PostgreSQL · Redis · S3-compatible object storage (Railway Bucket / MinIO) · Vitest · Playwright.

## Local development

```bash
pnpm install
docker compose up -d            # postgres, redis, minio
cp .env.example .env            # fill SESSION_SECRET / CRAWLER_MACHINE_TOKEN (openssl rand -hex 32)
pnpm db:migrate
pnpm db:seed                    # reference data + dev sample batch + dev users (non-production only)
pnpm dev                        # web :3000, api :4000, worker, (crawler needs CRAWLER_CORE_API_URL)
```

Without Docker: set `STORAGE_DRIVER=fs`, point `DATABASE_URL`/`REDIS_URL` at any Postgres 15+/Redis 6.2+.
The test suite boots its own embedded PostgreSQL and needs no Docker.

Dev users after `pnpm db:seed` (never seeded in production): `analyst@dominio-x.local` and
`viewer@dominio-x.local` with password `dev-password-123`. The admin comes from
`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` or `pnpm admin:create --email you@example.com`.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test          # unit + integration (embedded Postgres; Redis tests skip when unavailable)
pnpm build
pnpm test:e2e      # Playwright critical flow against a running stack (E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD)
```

## Monorepo

```
apps/        web · api · worker · scheduler (Railway cron) · crawler (isolated Railway project)
packages/    contracts · config · observability · normalization · storage · database · queue
             providers · source-adapters · rule-engine · scoring · domain-core · test-utils
scripts/     railway-provision.mjs (API) · local-stack.mjs · smoke-production.sh · seed-admin.ts
```
