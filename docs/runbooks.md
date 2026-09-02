# Runbooks

## Restore PostgreSQL from a Railway backup

1. Railway dashboard → `postgres` → Backups → pick a snapshot → _Restore to a new database_
   (never restore over production in place).
2. Validate the restored database first: create a temporary service (or use `railway run` from a
   throwaway service) with `DATABASE_URL` pointing at the restore; run
   `node packages/database/dist/migrate.js` (must be a no-op) and spot-check
   `select count(*) from domains; select max(detected_at) from source_batches;`.
3. Pause the worker and scheduler (see below), point `api`/`worker`/`scheduler` `DATABASE_URL` at the
   restored instance, redeploy, run the smoke test, then unpause.

## Rotate `SESSION_SECRET`

The secret only signs cookies (session identity is stored server-side). Set the new value on `api`,
redeploy; all users must log in again (existing sessions remain in the table but the cookie
signature no longer matches). Optionally `delete from sessions;`.

## Rotate the crawler machine token

1. Generate: `openssl rand -hex 32`.
2. Set `CRAWLER_MACHINE_TOKEN` on `api` (core) **and** `crawler` (crawlers project).
3. Redeploy `api` first, then `crawler`. In-flight crawler jobs whose leases expire are reclaimed
   automatically (`attempt < max_attempts`).

## Rotate / disable the Semrush key

- Rotate: update `SEMRUSH_API_KEY` on `api` and `worker`, redeploy `worker`.
- Disable immediately: Providers page → toggle `semrush` off (admin) — takes effect on the next SEO
  stage — or set `SEMRUSH_ENABLED=false` and redeploy `worker`. Budget ceiling: Providers page
  (monthly units) or `SEMRUSH_MONTHLY_UNIT_BUDGET`.
- Note: while the integration mode is in standby no request is made regardless of these settings.

## Pause workers

Railway dashboard → `worker` → Settings → _Remove/scale to 0_ (or `railway down --service worker`).
Jobs stay in Redis and resume when the worker returns (BullMQ locks expire after 2 minutes; active
jobs are re-processed idempotently). To pause only paid analysis, disable the `semrush` provider.

## Retry dead jobs

Analysis Queue page → filter `failed` → _Retry_ (creates a new run with `forceRefresh`, history is
kept). Bulk: `POST /v1/analysis-runs/:id/retry` per run, or `POST /v1/batches/:id/analyze` with
`onlyNew=false` for a whole batch. BullMQ failed jobs older than 7 days are pruned automatically.

## Re-run a source batch safely

Batch page → _Re-analyze all_ (or _Analyze new_). Ingestion is idempotent: identical content
(same SHA-256) never creates a second batch. To re-ingest the same artifact for debugging, download
it via _Raw artifact_ and import it as CSV (a new batch with a different name/sha will be created).

## Export shortlists

Shortlist page → _Export CSV_ (`GET /v1/shortlists/:id/export.csv`, UTF-8 BOM, formula-safe cells).

## Crawler SSRF / security incident

1. Scale the `crawler` service to 0 immediately.
2. Rotate `CRAWLER_MACHINE_TOKEN` (see above).
3. Inspect `crawler_jobs` rows with `result_json->>'securityBlocked' = 'true'` and
   `domain_observations` where `metric_key = 'http.security_blocked'`; quarantined domains show
   disposition `quarantined` (rule `security.crawler_blocked`).
4. Review the crawler logs for `blocked:` reasons; add offending patterns to the blacklist.
5. Fix the policy in `apps/crawler/src/security`, add a regression case to `ssrf.test.ts`, redeploy.

## Scheduler did not run / ran with errors

`railway logs --service scheduler-registro-br`. Errors are also stored in `operational_events`
(Overview → Recent operational errors). Re-run manually with _Run now_. The watcher is idempotent.

## Retention

Runs at the end of every scheduler execution (`runRetention`) or manually with
`node apps/scheduler/dist/retention.js`. It purges provider-restricted observation values older
than `PROVIDER_RESTRICTED_RETENTION_DAYS`, expired sessions, operational events > 30 days and
finished crawler jobs > 30 days.
