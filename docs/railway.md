# Railway

Two projects, both in **US East (Virginia)** (`us-east4-eqdc4a`); bucket region `iad`.

## dominio-x-core

| Service                 | Config file                   | Public                          | Start                                                   |
| ----------------------- | ----------------------------- | ------------------------------- | ------------------------------------------------------- |
| `web`                   | `apps/web/railway.json`       | yes (`/api/health`)             | `pnpm --filter @dominio-x/web start`                    |
| `api`                   | `apps/api/railway.json`       | yes (`/health`, `/ready`)       | `node apps/api/dist/server.js` (pre-deploy: migrations) |
| `worker`                | `apps/worker/railway.json`    | no                              | `node apps/worker/dist/worker.js`                       |
| `scheduler-registro-br` | `apps/scheduler/railway.json` | no, cron `0 */6 * * *` (UTC)    | `node apps/scheduler/dist/registro-br.js`               |
| `postgres`, `redis`     | Railway databases             | **private only** (no TCP proxy) |                                                         |
| `dominio-x-data`        | Railway Storage Bucket        | private                         |                                                         |

All code services use the repository root as root directory (shared monorepo) and a per-service
**config file path** (`apps/<name>/railway.json`) which sets build/start commands, watch paths,
health checks, restart policy, cron and the pre-deploy migration.

### Variables (core)

Shared by `api`, `worker`, `scheduler-registro-br` (use reference variables):

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}          # private hostname (postgres.railway.internal)
REDIS_URL=${{Redis.REDIS_URL}}                   # private hostname
STORAGE_DRIVER=s3
S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET / S3_REGION=auto / S3_URL_STYLE=virtual
    → from `railway bucket credentials dominio-x-data` (or bucket reference variables)
SESSION_SECRET=<openssl rand -hex 32>            # api
CRAWLER_MACHINE_TOKEN=<openssl rand -hex 32>     # api (same value in the crawler project)
APP_URL=https://<web public domain>
API_URL=https://<api public domain>
CRAWLER_ENABLED=true
SEMRUSH_ENABLED=false                            # standby
LOG_LEVEL=info
```

`web`: `API_INTERNAL_URL=http://api.railway.internal:${{api.PORT}}` (private network),
`API_URL=https://<api public domain>`, `NODE_ENV=production`.

Bootstrap admin (temporary, remove after the first seed): `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_PASSWORD`, then run once `railway run --service api node packages/database/dist/seed.js --no-dev`.
Alternative without env vars: `railway run --service api node packages/database/dist/admin-create.js --email you@example.com`
(password prompted, hidden; or `ADMIN_PASSWORD` env for non-TTY).

## dominio-x-crawlers

| Service   | Config file                 | Public |
| --------- | --------------------------- | ------ |
| `crawler` | `apps/crawler/railway.json` | no     |

Variables: `NODE_ENV=production`, `CRAWLER_CORE_API_URL=https://<api public domain>`,
`CRAWLER_MACHINE_TOKEN`, `CRAWLER_CONNECT_TIMEOUT_MS=5000`, `CRAWLER_TOTAL_TIMEOUT_MS=12000`,
`CRAWLER_MAX_REDIRECTS=5`, `CRAWLER_MAX_BODY_BYTES=2097152`, `CRAWLER_MAX_DECOMPRESSED_BYTES=4194304`,
`CRAWLER_CONCURRENCY=4`, `LOG_LEVEL=info`. **Never** `DATABASE_URL`, `REDIS_URL`, `SEMRUSH_*`,
`SESSION_SECRET` or bucket credentials.

## Provisioning

```bash
railway login
scripts/railway-bootstrap.sh core
scripts/railway-bootstrap.sh crawlers
scripts/railway-bootstrap.sh secrets
# set config file paths + remaining variables in the dashboard (or via the API), then:
scripts/railway-deploy.sh            # or push to main with GitHub autodeploy
API_URL=... WEB_URL=... SMOKE_EMAIL=... SMOKE_PASSWORD=... scripts/smoke-production.sh
```

Migrations run through `preDeployCommand` on the `api` service (`node packages/database/dist/migrate.js`),
i.e. once per deploy before the new API replica starts — never at boot of every replica.

## Registro.br verification after deploy

1. Trigger the cron once (dashboard → scheduler → "Run now", or `railway run --service scheduler-registro-br node apps/scheduler/dist/registro-br.js`).
2. Check logs: `registro.br watch finished` with `changed=true`, batch id and stats.
3. Bucket: object under `sources/registro-br-release/YYYY/MM/`.
4. UI → Release Batches: batch with SHA-256, domain count, funnel; queue depth rising.
5. Trigger again: `changed=false reason=not_modified|same_sha`, no new batch.
