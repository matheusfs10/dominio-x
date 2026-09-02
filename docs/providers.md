# Providers

Every enrichment source implements `EnrichmentProvider` (`packages/providers/src/types.ts`):
`isConfigured()`, `describeStatus()`, `estimate()`, `enrich()`. Results are lists of generic
observations (`metricKey`, `value`, `state`, `licenseClass`, `ttlHours`) plus a request ledger.
Provider failures never crash an analysis: the step is marked failed/skipped and the run ends
`partial`.

| Key       | Cost | Capabilities                      | Default state                   | Notes                                                        |
| --------- | ---- | --------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `lexical` | free | lexical                           | ready                           | local computation; no expiry                                 |
| `dns`     | free | dns                               | ready                           | A/AAAA/MX/NS/TXT/CNAME, resolves flag, SPF presence; TTL 24h |
| `crawler` | free | http                              | ready when `CRAWLER_ENABLED`    | runs only in the isolated project; TTL 72h                   |
| `rdap`    | free | rdap                              | disabled (`RDAP_ENABLED=false`) | IANA bootstrap redirector, 2 rps, no contact/PII stored      |
| `semrush` | paid | seo, backlinks, traffic, keywords | **decision_pending (standby)**  | see below                                                    |

## Semrush — STANDBY

The operator has not yet decided the integration mode (official Semrush API vs. an alternative).
Until then:

- `SEMRUSH_INTEGRATION_MODE` is hard-coded to `"standby"` in `packages/providers/src/semrush/mode.ts`.
- The provider reports `decision_pending`, never makes outbound requests (even with a key set),
  and the SEO stage records the skip reason. Scores show SEO/link as **missing** with the reason
  "integration mode not decided", and confidence is reduced accordingly.
- Everything else is already in place: Redis-backed global rate limiter (token bucket + concurrency
  semaphore, defaults 8 rps / 8 concurrent, capped at the documented 10/10), circuit breaker,
  request/units/cost ledger, TTL (`SEMRUSH_DATA_TTL_DAYS`, default 30), monthly unit budget
  (`SEMRUSH_MONTHLY_UNIT_BUDGET` or the provider registry field, editable in the Providers page),
  candidate gate, and usage dashboard.
- Website scraping is not a supported mode of this adapter.

When the decision is made, implement `SemrushProvider.fetchMetrics()` and fill
`SEMRUSH_FIELD_MAP` in `mapping.ts` with only the fields the chosen endpoint actually returns, then
switch `SEMRUSH_INTEGRATION_MODE`. Nothing outside that directory changes.

## Metric keys

`packages/contracts/src/metrics.ts` — `lexical.*`, `dns.*`, `http.*`, `rdap.*`, `seo.*`, `links.*`,
plus internal `internal.blacklisted` and `internal.candidate_gate_passed`.

## Retention / licensing

Observations carry `license_class` (`internal`, `public_source`, `provider_restricted`,
`provider_contractual`). The retention routine (`runRetention`, executed by the scheduler) removes the
_values_ of provider-restricted observations older than `PROVIDER_RESTRICTED_RETENTION_DAYS` while
keeping provider/metric/timestamp/state for audit. Provider values are never copied into permanent
domain columns (the summary table is a rebuildable cache of the latest run).

## Adding a provider

1. Create `packages/providers/src/<vendor>/index.ts` implementing `EnrichmentProvider`.
2. Map vendor fields to existing metric keys (add keys to `contracts/metrics.ts` if needed).
3. Register it in `registry.ts` and in `SEED_PROVIDERS` (`packages/database/src/seed-data.ts`).
4. Call it from the appropriate pipeline stage (`packages/domain-core/src/pipeline.ts`) through
   `stageProvider()` or `persistProviderResult()`.
