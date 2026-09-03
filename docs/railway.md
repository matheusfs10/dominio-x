# Railway

Two projects, both in **US East (Virginia)** (`us-east4-eqdc4a`); bucket region `iad`.
Provisioned state (ids, domains) lives in `.railway/state.json`; the project is also described in
`.railway/railway.ts` (Railway Infrastructure as Code, the successor of the deprecated
`railway.json` Config as Code).

## Provisioning without the CLI

Railway's public GraphQL API is enough to provision and deploy everything. Create a **workspace
token** (Account Settings → Tokens) and run:

```bash
export RAILWAY_API_TOKEN=...
node scripts/railway-provision.mjs provision    # projects, Postgres, Redis, bucket, services, public domains
node scripts/railway-provision.mjs configure    # build/start commands, health checks, pre-deploy migration, cron, region
node scripts/railway-provision.mjs variables    # variables and one-time secrets (never printed)
node scripts/railway-provision.mjs deploy       # uploads the committed tree (git archive HEAD) and deploys every service
node scripts/railway-provision.mjs status
```

With the Railway CLI available, `railway config plan/apply` can apply `.railway/railway.ts` and
`railway up --service <name>` can deploy; the API script remains the reference for cron,
pre-deploy and watch-path settings, which the IaC DSL does not expose yet.

## dominio-x-core

| Service                 | Public                                                           | Start                                     | Notes                                               |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `web`                   | https://web-production-46901.up.railway.app (`/api/health`)      | `pnpm --filter @dominio-x/web start`      | proxies `/api/v1/*` to the api over the private net |
| `api`                   | https://api-production-fec75.up.railway.app (`/health`,`/ready`) | `node apps/api/dist/server.js`            | pre-deploy `node packages/database/dist/migrate.js` |
| `worker`                | no                                                               | `node apps/worker/dist/worker.js`         |                                                     |
| `scheduler-registro-br` | no, cron `0 */6 * * *` (UTC)                                     | `node apps/scheduler/dist/registro-br.js` | restart policy NEVER (exits when done)              |
| `Postgres`, `Redis`     | **private only** (templates, no TCP proxy)                       |                                           |                                                     |
| `dominio-x-data`        | private bucket                                                   |                                           | credentials via `${{dominio-x-data.*}}` references  |

### Variables (core)

`api`, `worker`, `scheduler-registro-br` share:

```
NODE_ENV=production                       LOG_LEVEL=info
DATABASE_URL=${{Postgres.DATABASE_URL}}   REDIS_URL=${{Redis.REDIS_URL}}        # private hostnames
STORAGE_DRIVER=s3  S3_ENDPOINT=${{dominio-x-data.ENDPOINT}}  S3_ACCESS_KEY_ID=${{dominio-x-data.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{dominio-x-data.SECRET_ACCESS_KEY}}  S3_BUCKET=${{dominio-x-data.BUCKET}}  S3_REGION=${{dominio-x-data.REGION}}
S3_URL_STYLE=virtual
APP_URL=<web domain>  API_URL=<api domain>
SESSION_SECRET / CRAWLER_MACHINE_TOKEN     # generated once (openssl rand -hex 32), stored only in Railway
CRAWLER_ENABLED=true  SEMRUSH_ENABLED=false (standby)  SEMRUSH_DATA_TTL_DAYS=30  PROVIDER_RESTRICTED_RETENTION_DAYS=30
```

`api` adds `PORT=4000 HOST=:: TRUST_PROXY=true`. `web`: `NODE_ENV=production`,
`API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000`, `API_URL`, `APP_URL`.

Bootstrap admin: set `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` on `api` once and execute
`node packages/database/dist/seed.js --no-dev` (Railway → api → one-off command, or `railway run`),
then remove both variables. Alternative: `node packages/database/dist/admin-create.js --email you@example.com`
with `ADMIN_PASSWORD` in the environment of that one-off command.

## dominio-x-crawlers

| Service   | Public |
| --------- | ------ |
| `crawler` | no     |

Variables: `NODE_ENV=production`, `CRAWLER_CORE_API_URL=<api domain>`, `CRAWLER_MACHINE_TOKEN`
(same value as the api; cross-project references are not possible), `CRAWLER_*` limits, `LOG_LEVEL`.
**Never** `DATABASE_URL`, `REDIS_URL`, `SEMRUSH_*`, `SESSION_SECRET` or bucket credentials.

## Current interim settings

- `CRAWLER_ENABLED=false` on api/worker until the `crawler` service exists (plan limit).
- `STORAGE_DRIVER=fs` on api/worker until the bucket instance exists; switch back to the `S3_*` references then.

## Plan requirements

Railway's Trial/Free tier limits the number of provisioned resources and did not build code
deployments for this workspace. The full topology (6 core services + bucket + crawler) needs the
Hobby plan with an active payment method. See `docs/deployment-report.md`.

## Registro.br verification after deploy

1. Trigger the cron once (dashboard → scheduler-registro-br → Deploy/Run now).
2. Logs: `registro.br watch finished` with `changed=true`, batch id and stats.
3. Bucket: object under `sources/registro-br-release/YYYY/MM/`.
4. UI → Release Batches: batch with SHA-256, domain count, funnel; queue depth rising.
5. Trigger again: `changed=false reason=not_modified|same_sha`, no new batch.
