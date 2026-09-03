# Deployment report — updated 2026-09-03

## Status: full pipeline live on Railway (Hobby); only durable artifact storage is missing

| Item                                                          | Status                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace plan                                                | **Hobby, `customer.state = ACTIVE`** (payment method set)                                                                                                                |
| Project `dominio-x-core`                                      | `5d7e62d9-b7b6-41b5-bed3-b4de7e7ae012` · env `production` `8080986d-c7d7-4e9e-ba0f-86f100aa2e95` · region `us-east4-eqdc4a`                                              |
| Project `dominio-x-crawlers`                                  | `c43a5643-cf1d-46e7-aee1-00bfcf32e68d` · env `production` `852cadbe-0674-4677-b788-876bdafc4f56`                                                                         |
| Postgres (template `postgres-ssl:18`, private, 500 MB volume) | **healthy**                                                                                                                                                              |
| Redis (template `redis:8.2`, private, 500 MB volume)          | **healthy**                                                                                                                                                              |
| `api`                                                         | **healthy** — https://api-production-fec75.up.railway.app (`/health`, `/ready` = db ok + redis ok, `/docs`)                                                              |
| `web`                                                         | **healthy** — https://web-production-46901.up.railway.app (`/api/health`, runtime proxy to the api over the private network)                                             |
| `worker`                                                      | **running** (all eight pipeline stages)                                                                                                                                  |
| `crawler` (isolated project)                                  | **running and verified**: claimed a job, fetched `registro.br` over HTTPS, returned status/title/meta/content-type; run completed with score 74.4                        |
| `scheduler-registro-br`                                       | created and configured (cron `0 */6 * * *` UTC, region us-east4, restart NEVER) but **intentionally not deployed** — see "Why the scheduler is on hold"                  |
| Migrations                                                    | applied by the api pre-deploy command (`0000_init`)                                                                                                                      |
| Seed                                                          | reference data, ruleset v1 and score model v1 active; bootstrap admin `admin@matheus.vip` created via a one-time pre-deploy seed, bootstrap variables removed afterwards |
| Artifact storage                                              | **interim `STORAGE_DRIVER=fs`** on api/worker. `bucketCreate` through the public API only creates a project-level record; no `BucketInstance` is provisioned (see Notes) |
| Providers                                                     | lexical, dns, crawler active · rdap disabled by default · **Semrush standby** (`decision_pending`, no outbound calls)                                                    |
| Smoke test                                                    | **passed** (`scripts/smoke-production.sh`: health, ready, web, login, submit, analysis completed, detail, logout)                                                        |
| Quality gates                                                 | lint ✓ · typecheck ✓ · 135 tests ✓ · build ✓ · Playwright critical flow ✓ (local stack) · GitHub Actions CI ✓ on `main`                                                  |

## Why the scheduler is on hold

The Registro.br watcher stores the raw downloaded list through `ObjectStorage` before creating the
immutable batch. With `STORAGE_DRIVER=fs` the cron container writes it to an ephemeral disk that
disappears when the process exits, and because ingestion deduplicates by content SHA-256 a later
run would report `same_sha` and never re-store that artifact. The current release list would end up
with a batch row whose raw artifact is permanently missing, which breaks the evidence-first rule.

Deploying the scheduler is therefore the last step, right after the bucket works.

## What the operator must do

1. **Create the bucket in the dashboard** (one action). Railway canvas → Create → **Bucket**,
   region `iad`, name `dominio-x-data`. While there, delete the three empty project-level bucket
   records left by the API attempts (`dominio-x-data`, `stashed-stashbox-E4JW`, `dominio-x-artifacts`,
   ids in `.railway/state.json`).
2. Tell me, and I finish: switch api/worker to `STORAGE_DRIVER=s3` with the `${{...}}` bucket
   references, deploy `scheduler-registro-br`, and run the Registro.br production verification
   (fetch → artifact in the bucket → immutable batch → parse stats → enqueued analyses → second run
   reports no change).
3. **Change the admin password** after the first login (Settings → Users).
4. **Revoke the workspace token** shared in chat (Railway → Account → Tokens) once the setup is done.
5. **Semrush integration decision** (official API vs alternative) whenever you want M8 to leave standby.

## Notes

- `bucketCreate(projectId, environmentId, name)` returns a bucket id, but
  `bucketS3Credentials`, `bucketInstanceDetails` and `bucketCredentialsReset` all answer
  `BucketInstance not found`, before and after the Hobby upgrade. Staging `buckets` into the
  environment config commits successfully yet the key is dropped, so the environment instance
  appears to be created only by the dashboard flow.
- Railway deprecated `railway.json` Config as Code for new services (the API rejects
  `railwayConfigFile`); settings are applied through `serviceInstanceUpdate` by
  `scripts/railway-provision.mjs` and described in `.railway/railway.ts`.
- `preDeployCommand` accepts a single string; chain steps with `&&`.
- Deployments upload the committed tree exactly like `railway up` (raw gzip body with a
  `multipart/form-data` content type). The GitHub repo is not connected to Railway; autodeploy from
  `main` can be enabled in the dashboard later.
- Railway injects `PORT=8080`; the web service pins `PORT=3000` to match its public domain target.

## Remaining non-blocking improvements

- Semrush data path (`fetchMetrics` + field mapping) after the integration decision
- Reputation / backlink / history providers (adapter slots exist)
- Playwright E2E in CI using `scripts/local-stack.mjs`
- `EXPLAIN` review of the explorer query with a production-sized dataset
