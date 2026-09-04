# Architecture

## Topology

```
dominio-x-core (Railway project, US East)            dominio-x-crawlers (separate project)
├── web        Next.js, public, proxies /api/v1 → api ├── crawler   no DB/Redis/provider secrets
├── api        Fastify, public, /health /ready         │           talks to api over HTTPS with
├── worker     BullMQ consumers (all stages)           │           CRAWLER_MACHINE_TOKEN
├── scheduler  cron 0 */6 * * * (Registro.br watcher)  └──────────────────────────────────────
├── postgres   private
├── redis      private
└── bucket     dominio-x-data (raw source artifacts)
```

The browser only talks to the web origin. Next.js rewrites `/api/v1/*` to the API over Railway's
private network, so the session cookie stays first-party (`SameSite=Lax`) and the API's Origin-based
CSRF check applies.

## Packages (dependency order)

| Package           | Role                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `contracts`       | Enums, metric keys, error codes, Zod request schemas shared by api and web                                                      |
| `config`          | Zod-validated environment per process (api / worker / scheduler / crawler)                                                      |
| `observability`   | Pino logger with secret redaction, optional Sentry                                                                              |
| `normalization`   | Deterministic domain normalization (IDN, PSL via tldts, validation)                                                             |
| `storage`         | `ObjectStorage` interface: S3 (Railway bucket / MinIO), fs (dev), memory (tests)                                                |
| `database`        | Drizzle schema, immutable migrations, seed, admin CLI, argon2id passwords                                                       |
| `queue`           | BullMQ queue names/prefix, deterministic job ids, backoff, stage worker factory                                                 |
| `providers`       | `EnrichmentProvider` contract + lexical, DNS, RDAP, Semrush (standby) adapters, rate limiters, circuit breaker                  |
| `source-adapters` | `SourceAdapter` contract + Registro.br, CSV, manual adapters                                                                    |
| `rule-engine`     | JSON rule DSL (Zod-validated, RE2 regex), evaluator, summary                                                                    |
| `scoring`         | Score model v1: dimensions, renormalized weights, confidence, explanation                                                       |
| `domain-core`     | Services: ingestion, analysis runs, observations, pipeline stages, crawler leases, auth, rulesets, shortlists, usage, retention |
| `test-utils`      | Embedded PostgreSQL global setup, per-test databases, Redis probe                                                               |

Packages are consumed as TypeScript source ("just-in-time" packages); apps bundle them with tsup.

## Pipeline

```
preflight (lexical + blacklist) → dns → crawl (isolated crawler, lease-based) → candidate_gate
→ seo (paid, gated + budgeted) → traffic (paid, free qualification gate + USD budget)
→ rules → score → complete
```

Each stage is a BullMQ job with a deterministic id `<stage>:<runId>`; handlers are idempotent
(finished steps are skipped) and retry-safe (exponential backoff with jitter; deterministic errors are
`UnrecoverableError`). The crawl stage creates a `crawler_jobs` row and a delayed `crawl_timeout` job;
the crawler claims the row through the machine API, and completion (or timeout) advances the run.

Observations carry TTLs; a stage reuses fresh observations of its provider unless the run was
forced (`forceRefresh`). Lexical observations never expire; DNS 24h; HTTP 72h; Semrush per
`SEMRUSH_DATA_TTL_DAYS`; DataForSEO per `DATAFORSEO_DATA_TTL_DAYS`, plus a gate-level cooldown
(`reuseWithinDays`) that stops us paying twice for a domain measured recently.

`domain_summaries` is a denormalized "latest state" table maintained by the pipeline and analyst
actions; it powers the explorer. It can always be rebuilt from the historical tables.

## Data model highlights

- `domains` — canonical identity (unique `ascii_fqdn`, trigram index for search)
- `sources` / `source_batches` / `source_batch_domains` — immutable batches per content SHA-256
- `analysis_runs` / `analysis_steps` — run + per-stage tracking (provider, attempt, duration, outcome)
- `domain_observations` — provider/metric/value/state/TTL/license class (values purged by retention)
- `provider_requests` — usage & cost ledger
- `rulesets` / `rules` / `rule_executions` — versioned DSL + evidence per run
- `score_models` / `domain_scores` — versioned models + explanation per run
- `shortlists`, `tags`, `domain_notes`, `domain_dispositions` (additive manual decisions), `audit_logs`
- `crawler_jobs` — lease queue for the isolated crawler
- `app_settings` — candidate gate configuration (UI editable)
