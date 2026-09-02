# Deployment report — 2026-09-02

## Status: core deployed and healthy on Railway; two services and the bucket blocked by the plan

| Item                                                          | Status                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project `dominio-x-core`                                      | `5d7e62d9-b7b6-41b5-bed3-b4de7e7ae012` · env `production` `8080986d-c7d7-4e9e-ba0f-86f100aa2e95` · region `us-east4-eqdc4a`                                                                                                   |
| Project `dominio-x-crawlers`                                  | `c43a5643-cf1d-46e7-aee1-00bfcf32e68d` · env `production` `852cadbe-0674-4677-b788-876bdafc4f56`                                                                                                                              |
| Postgres (template `postgres-ssl:18`, private, 500 MB volume) | **healthy**                                                                                                                                                                                                                   |
| Redis (template `redis:8.2`, private, 500 MB volume)          | **healthy**                                                                                                                                                                                                                   |
| `api`                                                         | **deployed, healthy** — https://api-production-fec75.up.railway.app (`/health`, `/ready` = db ok, redis ok, `/docs`)                                                                                                          |
| `web`                                                         | **deployed, healthy** — https://web-production-46901.up.railway.app (`/api/health`, runtime proxy to the api over the private network)                                                                                        |
| `worker`                                                      | **deployed, running** (all pipeline stages)                                                                                                                                                                                   |
| Migrations                                                    | applied by the api pre-deploy command (`0000_init`)                                                                                                                                                                           |
| Seed                                                          | reference data, ruleset v1 and score model v1 active; bootstrap admin `admin@matheus.vip` created through a one-time pre-deploy seed, bootstrap variables removed afterwards                                                  |
| `scheduler-registro-br`                                       | **not created** — Railway: "Free plan resource provision limit exceeded"                                                                                                                                                      |
| `crawler` (crawlers project)                                  | **not created** — same limit; `CRAWLER_ENABLED=false` on api/worker meanwhile (crawl stage skipped, everything else runs)                                                                                                     |
| Bucket `dominio-x-data` (`5665b178-…`)                        | created at project level but Railway never instantiated it in the environment (`BucketInstance not found`, also after staging/committing it); **interim `STORAGE_DRIVER=fs`** on api/worker (artifacts on the container disk) |
| Stray bucket `stashed-stashbox-E4JW` (`9a3ae655-…`)           | created by a diagnostic retry (the API ignored the name); delete it in the dashboard                                                                                                                                          |
| Providers                                                     | lexical, dns active · rdap disabled by default · crawler disabled (see above) · **Semrush standby** (`decision_pending`, no outbound calls)                                                                                   |
| Smoke test                                                    | health/ready/web/login/submit/run creation pass; the first analysis waited on the crawl stage (10 min timeout) before the crawler was disabled                                                                                |
| Quality gates                                                 | lint ✓ · typecheck ✓ · 135 tests ✓ · build ✓ · Playwright critical flow ✓ (local stack) · GitHub Actions CI ✓                                                                                                                 |

## What the operator must do

1. **Railway plan.** The workspace ("My Projects") is on a trial without a payment method
   (`customer.state = INACTIVE`). Add a payment method / upgrade to Hobby, then:
   ```bash
   export RAILWAY_API_TOKEN=...
   node scripts/railway-provision.mjs provision   # creates scheduler-registro-br and crawler
   node scripts/railway-provision.mjs configure   # cron 0 */6 * * *, restart policies, region
   node scripts/railway-provision.mjs variables   # set CRAWLER_MACHINE_TOKEN on crawler = api value
   node scripts/railway-provision.mjs deploy scheduler-registro-br crawler
   ```
   then set `CRAWLER_ENABLED=true` on api/worker.
2. **Bucket.** In the dashboard open `dominio-x-data` and make sure it is deployed in `production`
   (delete `stashed-stashbox-E4JW`). Then switch api/worker to `STORAGE_DRIVER=s3` with the
   `${{dominio-x-data.*}}` references documented in `docs/railway.md`
   (`node scripts/railway-provision.mjs variables` sets them) and redeploy.
3. **Semrush integration decision** (official API vs alternative) — M8 stays in standby by design.
4. **Credentials hygiene.** Change the admin password after the first login (Settings → Users or
   `admin-create --yes`), and revoke the workspace token that was shared in chat
   (Railway → Account → Tokens).
5. Run the Registro.br verification (`docs/railway.md`) once the scheduler exists.

## Notes

- Railway deprecated `railway.json` Config as Code for new services (the API rejects
  `railwayConfigFile`); settings are applied through `serviceInstanceUpdate` by
  `scripts/railway-provision.mjs` and described in `.railway/railway.ts`.
- Deployments upload the committed tree exactly like `railway up` (raw gzip body with a
  `multipart/form-data` content type). The GitHub repo is not connected to Railway; autodeploy
  from `main` can be enabled in the dashboard later.
- The Railway CLI binary is quarantined by Windows Defender on the operator's machine
  (`Trojan:Win32/Wacatac.H!ml` false positive); the API path avoids the CLI entirely.
- Railway injects `PORT=8080`; the web service pins `PORT=3000` to match its public domain target.

## Remaining non-blocking improvements

- Semrush data path (`fetchMetrics` + field mapping) after the integration decision
- Reputation / backlink / history providers (adapter slots exist)
- Playwright E2E in CI using `scripts/local-stack.mjs`
- `EXPLAIN` review of the explorer query with a production-sized dataset
