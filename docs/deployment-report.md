# Deployment report — updated 2026-09-03

## Status: M10 complete. All services live on Railway (Hobby), Registro.br pipeline verified in production

| Item                                                            | Status                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace plan                                                  | Hobby, `customer.state = ACTIVE`                                                                                                                                   |
| Project `dominio-x-core`                                        | `5d7e62d9-b7b6-41b5-bed3-b4de7e7ae012` · env `production` `8080986d-c7d7-4e9e-ba0f-86f100aa2e95` · region `us-east4-eqdc4a`                                        |
| Project `dominio-x-crawlers`                                    | `c43a5643-cf1d-46e7-aee1-00bfcf32e68d` · env `production` `852cadbe-0674-4677-b788-876bdafc4f56`                                                                   |
| Postgres (template `postgres-ssl:18`, private, **5 GB** volume) | healthy                                                                                                                                                            |
| Redis (template `redis:8.2`, private, **2 GB** volume)          | healthy                                                                                                                                                            |
| `api`                                                           | healthy — https://api-production-fec75.up.railway.app (`/health`, `/ready` = db ok + redis ok, `/docs`)                                                            |
| `web`                                                           | healthy — https://web-production-46901.up.railway.app (`/api/health`, runtime proxy to the api over the private network)                                           |
| `worker`                                                        | running (all eight pipeline stages)                                                                                                                                |
| `crawler` (isolated project)                                    | running and verified (job lease → HTTPS fetch → observations)                                                                                                      |
| `scheduler-registro-br`                                         | deployed, cron `0 */6 * * *` UTC, restart policy NEVER; no secrets beyond DB/Redis/bucket references                                                               |
| Bucket `data-dominio-x` (S3 name `data-dominio-x-atjm6zjgau`)   | created in the dashboard, region `iad`; api/worker/scheduler use `${{data-dominio-x.*}}` references; 2 objects stored (CSV smoke + Registro.br list, 3.18 MB)      |
| Migrations / seed                                               | applied; ruleset v1 and score model v1 active; admin `admin@matheus.vip`                                                                                           |
| Providers                                                       | lexical, dns, crawler active · rdap disabled by default · **Semrush standby** (`decision_pending`, no outbound calls)                                              |
| Smoke test                                                      | passed (`scripts/smoke-production.sh`)                                                                                                                             |
| Registro.br verification                                        | **passed** — see below                                                                                                                                             |
| Quality gates                                                   | lint ✓ · typecheck ✓ · 133 tests ✓ (2 Redis tests skip without a local Redis) · build ✓ · Playwright critical flow ✓ (local stack) · GitHub Actions CI ✓ on `main` |

## Registro.br production verification (2026-09-03)

1. First run (14:20 UTC) fetched the list (HTTP 200, 3,182,475 bytes), stored the raw artifact in
   the bucket, created the immutable batch and then **failed with "No space left on device"**: the
   template's 500 MB Postgres volume could not hold 158k domains plus indexes. Fixed by resizing the
   volume to 5 GB (Redis to 2 GB) and by making failed batches resumable (`fix(ingestion)`).
2. Run at 15:15 UTC: `resuming failed batch ingestion` → `source batch ingested` (71 s) →
   `batch analysis enqueued` → `registro.br watch finished`.
   - 158,231 lines, 158,227 domains, 0 invalid, 0 duplicates; release period
     2026-08-12 → 2026-08-19, list generated 2026-08-10.
   - 21,727 new domains, 136,500 already known from the interrupted run; 158,227 analysis runs enqueued.
3. Run at 15:20 UTC: `registro.br: not modified (304)`, no new batch (idempotence).
4. Bucket: 2 objects, artifact key `sources/registro-br-release/2026/09/2026-09-03T14-20-24-305Z-<sha256>.txt`.
5. Queue 40 minutes later: ~40k analyses completed, 0 failed, crawler completing jobs; top scores
   in the batch are 4-letter `.com.br` names at 89.4 (confidence 32.9 because SEO/link/history are
   unavailable).

The cron was temporarily set to `*/5 * * * *` to trigger these runs and is back to `0 */6 * * *`.

## Operator follow-ups

1. **Candidate gate cap.** `maxDeepAnalysesPerBatch` is 200 (Settings → Candidate gate), so only
   the first 200 eligible domains per batch pass the gate. Raise it when Semrush is enabled.
2. **Change the admin password** after the first login (Settings → Users).
3. **Revoke the workspace token** shared in chat (Railway → Account → Tokens); `~/.railway-token`
   on the operator machine can then be deleted.
4. **Delete the three empty bucket records** created by API attempts (ids in `.railway/state.json`).
5. **Semrush integration decision** (official API vs alternative) whenever M8 should leave standby.
6. Optional: connect the GitHub repo in the Railway dashboard for autodeploy from `main`
   (deployments currently upload the committed tree with `scripts/railway-provision.mjs deploy`).

## Notes

- Railway public API: `bucketCreate` never provisions an environment instance (dashboard only);
  `railway.json` Config as Code is rejected for new services; `preDeployCommand` accepts a single
  string; cron executions run on the existing deployment (no new deployment rows); volumes are
  resized by staging `volumes.<id>.sizeMB` in the environment config and committing.
- Deployments upload the committed tree exactly like `railway up` (raw gzip body with a
  `multipart/form-data` content type).
- Railway injects `PORT=8080`; the web service pins `PORT=3000` to match its public domain target.
- The Railway CLI binary is quarantined by Windows Defender on the operator's machine
  (`Trojan:Win32/Wacatac.H!ml` false positive); the API path avoids the CLI entirely.

## Remaining non-blocking improvements

- Semrush data path (`fetchMetrics` + field mapping) after the integration decision
- Reputation / backlink / history providers (adapter slots exist)
- Playwright E2E in CI using `scripts/local-stack.mjs`
- Large-batch ingestion regression test (158k-line fixture) gated behind an env flag
- `EXPLAIN` review of the explorer query now that production has a real dataset
