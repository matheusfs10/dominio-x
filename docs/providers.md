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
| `dataforseo` | paid | traffic                        | disabled (`DATAFORSEO_ENABLED=false`) | estimated search traffic per location; see below       |

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

## DataForSEO — estimated search traffic

Answers one question: **how many visitors a domain gets from Google search in a given country over
the last N whole months** (Brazil / 6 months by default). Endpoint:
DataForSEO Labs `historical_bulk_traffic_estimation` (live), one target per call, Basic auth with
the API login/password pair from the DataForSEO dashboard.

### What the numbers are, and are not

`etv` is an **estimate**: for every keyword the domain ranks for in the chosen location, the
provider multiplies the search volume by the click-through rate of the position it holds. It is not
an analytics measurement of real visitors, it only covers Google organic/paid search, and it only
describes the location recorded in `traffic.location_code`. Treat it as a comparative signal
between domains, not as a visitor count.

The window is the last `DATAFORSEO_WINDOW_MONTHS` **complete** calendar months; the running month is
excluded so a partial month never reads as a traffic collapse in `traffic.trend_ratio`.

### Cost control — the free funnel in front of the paid call

The provider is billed per request, so the whole design is about *not* calling it. In order, all of
these are free and any one of them stops the spend (`packages/domain-core/src/traffic-gate.ts`):

1. **Fresh observations** — inside `DATAFORSEO_DATA_TTL_DAYS`, the stage reuses what is on file.
2. **Cooldown** — `reuseWithinDays` refuses to re-measure a domain we asked about recently, even
   when the observation has already expired.
3. **Name shape** — max digits (default 0: any number disqualifies), max hyphens, SLD length range,
   randomness, punycode, optional dictionary word, TLD allowlist. All from the free lexical provider.
4. **Network evidence** — DNS resolution, HTTP reachability, allowed HTTP statuses, and the existing
   candidate gate. All from the free DNS provider and the isolated crawler.
5. **Volume caps** — per batch, per UTC day, per UTC month, counted from our own request ledger.
6. **Money caps** — projected spend against the monthly USD budget (the strictest of the DB setting
   and `DATAFORSEO_MONTHLY_COST_BUDGET_USD` wins), and an optional minimum account balance checked
   through the provider's free `user_data` endpoint.

Every skip records the exact check that blocked it in `analysis_steps.metadata_json.blockedBy`, and
the Usage page groups them so you can see where the funnel is losing candidates.

Analyst overrides (**Forçar análise profunda**) skip the *qualification* checks (3 and 4) but never
the *money* checks (1, 2, 5, 6) — that is the point of the gate.

Thresholds live in `app_settings.traffic_gate` and are edited in **Configurações › Gate de tráfego**.
The seeded defaults are deliberately strict and `enabled: false`, so no automatic lookup happens
until an operator reviews them.

### Ledger

The provider returns the real price of each request; that value is written to
`provider_requests.estimated_cost_usd`, so the monthly budget is enforced against actual spend
rather than an estimate. Failed calls are not billed by the provider and record no cost.

### Metric keys

`traffic.visits_total`, `traffic.visits_monthly_avg`, `traffic.visits_last_month`,
`traffic.visits_peak_month`, `traffic.months_with_traffic`, `traffic.trend_ratio`,
`traffic.paid_visits_total`, `traffic.serp_count_last_month`, `traffic.monthly_series` (JSON, one
row per month), plus the descriptors `traffic.window_months` / `traffic.window_from` /
`traffic.window_to` / `traffic.location_code` / `traffic.location_name` / `traffic.has_data`.

When the provider returns no row for a target the values are `unknown`; when it returns a row with
no month inside the window they are `not_available`. Neither is ever recorded as zero.

### Scoring

Score model **v1 ignores these metrics** (unchanged behaviour). Model **v2 is seeded as a draft**
with `configJson.useTrafficSignals: true`; activating it makes the SEO dimension use estimated
visits, month coverage and trend. Activation is an operator decision because it changes how every
future run is scored.

## Metric keys

`packages/contracts/src/metrics.ts` — `lexical.*`, `dns.*`, `http.*`, `rdap.*`, `seo.*`, `links.*`,
`traffic.*`, plus internal `internal.blacklisted`, `internal.candidate_gate_passed` and
`internal.traffic_gate_passed`.

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
