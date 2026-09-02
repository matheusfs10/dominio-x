# Deployment report — 2026-09-02

## Status: infrastructure provisioned, builds blocked by the Railway plan

| Item                                                   | Status                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Railway project `dominio-x-core`                       | created — `5d7e62d9-b7b6-41b5-bed3-b4de7e7ae012`, env `production` `8080986d-c7d7-4e9e-ba0f-86f100aa2e95`                                                     |
| Railway project `dominio-x-crawlers`                   | created — `c43a5643-cf1d-46e7-aee1-00bfcf32e68d`, env `production` `852cadbe-0674-4677-b788-876bdafc4f56`                                                     |
| Postgres (private, template `postgres-ssl:18`, volume) | **deployed, healthy**                                                                                                                                         |
| Redis (private, template `redis:8.2`, volume)          | **deployed, healthy**                                                                                                                                         |
| Bucket `dominio-x-data`                                | created (`5665b178-138b-4392-8891-077e69ec5fe7`)                                                                                                              |
| Services `web`, `api`, `worker`                        | created and configured (region us-east4-eqdc4a, build/start, health checks, pre-deploy migration, watch paths, variables incl. secrets and bucket references) |
| Public domains                                         | web https://web-production-46901.up.railway.app · api https://api-production-fec75.up.railway.app                                                             |
| Code uploaded                                          | yes (deployments `2aa5fd58…` api, `e9a8089e…` web, `89ca5fd4…` worker)                                                                                        |
| **Builds**                                             | **not started**: deployments stay `INITIALIZING` without a build (workspace customer state `INACTIVE`, trial, no payment method)                              |
| Services `scheduler-registro-br`, `crawler`            | **not created**: "Free plan resource provision limit exceeded"                                                                                                |
| Database migrations                                    | pending (run automatically by the api pre-deploy command on the first successful deploy)                                                                      |
| Providers configured                                   | lexical, dns, crawler (isolated), rdap (disabled by default)                                                                                                  |
| Providers disabled                                     | Semrush — standby by operator decision (`decision_pending`, no outbound calls)                                                                                |
| Tests                                                  | lint ✓ · typecheck ✓ · unit+integration 135/135 ✓ · build 6/6 ✓ · Playwright critical flow ✓ (local stack) · GitHub Actions CI ✓                              |

## Blockers (operator)

1. **Railway billing.** The workspace ("My Projects") is on a trial without a payment method, so
   Railway does not schedule builds and caps provisioned resources. Add a payment method / upgrade
   to Hobby in Railway → Account → Billing. Then run:
   ```bash
   export RAILWAY_API_TOKEN=...
   node scripts/railway-provision.mjs provision   # creates scheduler-registro-br and crawler
   node scripts/railway-provision.mjs configure
   node scripts/railway-provision.mjs variables   # set CRAWLER_MACHINE_TOKEN on crawler = api value
   node scripts/railway-provision.mjs deploy
   ```
   Then bootstrap the admin (docs/railway.md), run `scripts/smoke-production.sh` and the
   Registro.br verification.
2. **Semrush integration decision** (official API vs alternative) — M8 stays in standby by design.
3. **Token hygiene.** The workspace token used for provisioning was shared in chat; revoke it in
   Railway → Account → Tokens after the deploy and create a new one when needed.

## Notes

- Railway deprecated `railway.json` Config as Code for new services; the API rejects
  `railwayConfigFile`. Settings are applied through `serviceInstanceUpdate` by the provisioning
  script, and the project is described in `.railway/railway.ts` for `railway config apply`.
- The GitHub repository is not connected to Railway (the workspace token cannot query GitHub
  access); deployments upload the committed tree (`git archive HEAD`) exactly like `railway up`.
  Connecting the repo for autodeploy from `main` can be done in the dashboard later.
- The Railway CLI binary is quarantined by Windows Defender on the operator's machine
  (`Trojan:Win32/Wacatac.H!ml` false positive); the API path avoids the CLI entirely.

## Remaining non-blocking improvements

- Semrush data path (`fetchMetrics` + field mapping) after the integration decision
- Reputation / backlink / history providers (adapter slots exist)
- Playwright E2E in CI using `scripts/local-stack.mjs`
- `EXPLAIN` review of the explorer query with a production-sized dataset
