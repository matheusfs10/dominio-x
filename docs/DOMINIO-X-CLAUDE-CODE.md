# Dominio-X — Master Specification for Claude Code

> **Purpose of this file:** this is the execution specification for Claude Code.  
> Claude Code must **implement, test, provision and deploy** the complete Dominio-X MVP on Railway.  
> Do not stop at scaffolding, pseudocode, architectural diagrams or TODO-only implementations.

---

## 0. Operating mode for Claude Code

You are the principal engineer responsible for delivering **Dominio-X**, an internal domain-intelligence platform.

Your responsibilities are to:

1. inspect the repository and preserve any valid existing work;
2. implement the application described here;
3. create migrations, seeds and tests;
4. run lint, typecheck, tests and builds locally;
5. provision the required Railway infrastructure;
6. configure Railway services, variables, health checks and cron jobs;
7. run database migrations in production safely;
8. deploy all services;
9. verify the deployed application through health checks and smoke tests;
10. leave the repository documented and reproducible.

### Execution policy

- Work autonomously and make reasonable implementation decisions when this document leaves room for interpretation.
- Prefer the simplest production-safe solution over unnecessary infrastructure.
- Do **not** ask for confirmation for ordinary engineering decisions.
- Only require user interaction when genuinely blocked by:
  - Railway authentication;
  - a missing paid-provider secret such as `SEMRUSH_API_KEY`;
  - a custom domain/DNS action controlled outside the repository;
  - an irreversible destructive operation against an existing production resource.
- Never delete an existing Railway project, database, bucket, volume or production environment unless it is clearly disposable and the user explicitly authorized deletion.
- Never commit credentials, Railway tokens, API keys or production secrets.
- Never log secrets.
- Do not invent external API credentials.
- Optional providers must degrade gracefully when credentials are absent.
- Keep a running implementation checklist in the repository and update it as tasks are completed.
- At the end, produce a deployment report with:
  - services created;
  - Railway project names/IDs;
  - deployed public URLs;
  - database migration status;
  - configured providers;
  - disabled providers and why;
  - test results;
  - remaining non-blocking improvements.

---

# 1. Product definition

**Dominio-X** is an internal intelligence and decision platform for analyzing internet domains.

It must support:

1. **single-domain analysis** initiated manually;
2. **batch ingestion** from external domain lists;
3. continuous/periodic monitoring of the Registro.br domain release list;
4. local and external enrichment;
5. exclusion filters;
6. versioned rules;
7. multidimensional scoring;
8. shortlist creation;
9. evidence/auditability;
10. provider usage and cost control;
11. future source and provider modules without redesigning the core.

The platform is not merely a Semrush dashboard.

The core business asset must be the historical dataset and decision logic accumulated by Dominio-X.

---

# 2. Current principal source

Registro.br release list:

`https://registro.br/dominio/lista-processo-liberacao.txt`

Official process information:

`https://registro.br/dominio/processo-de-liberacao`

Important behavior:

- do not hard-code the assumption that the list is published on one fixed day every month;
- Registro.br currently states that the list is published two days before each release process;
- therefore the system must poll the source periodically and detect content changes;
- every distinct source version becomes an immutable **Source Batch**;
- preserve the original downloaded artifact and its SHA-256.

The watcher should run by Railway Cron and should be safe to run repeatedly.

Recommended initial cadence:

`0 */6 * * *`

Railway cron expressions are evaluated in UTC.

The job must:

1. fetch the source with a reasonable timeout;
2. capture response metadata where available (`ETag`, `Last-Modified`, content type, HTTP status);
3. compute SHA-256 of the content;
4. compare against previously ingested artifacts;
5. exit successfully with no changes when content is identical;
6. store the raw artifact when content changed;
7. create a new immutable source batch;
8. parse and normalize domains;
9. deduplicate;
10. enqueue the domains for the preflight analysis pipeline;
11. close all resources and terminate so Railway considers the cron run complete.

Do not mass-scrape Registro.br WHOIS.

---

# 3. Non-negotiable architecture principles

## 3.1 Provider independence

No external provider may own the Dominio-X data model.

Providers must be adapters.

Examples:

- Semrush
- DNS
- HTTP
- RDAP
- Certificate Transparency
- reputation providers
- backlink providers
- historical web providers
- future registry sources
- future auction sources
- future AI analysis providers

A provider can disappear or be replaced without changing the core domain model.

## 3.2 Evidence-first

Every derived result must be traceable to:

- source;
- provider;
- observation timestamp;
- analysis run;
- rule version;
- score version;
- raw evidence reference where applicable.

Never expose a final score with no explanation.

## 3.3 Cheap-first funnel

Never spend paid API credits on every ingested domain.

The pipeline must progressively filter candidates:

```text
Raw domains
   ↓
Normalization
   ↓
Local lexical filters
   ↓
Cheap network observations
   ↓
Candidate gate
   ↓
Paid provider enrichment
   ↓
Deep analysis
   ↓
Rule engine
   ↓
Scoring
   ↓
Shortlist / review
```

Paid providers must only run after configurable gates.

## 3.4 Version everything that changes decisions

Version:

- rulesets;
- scoring models;
- provider mapping logic when materially changed;
- normalization behavior when materially changed.

Historic analysis results must not silently change because code changed.

## 3.5 Distinguish unknown from zero

For any metric:

- `0` = measured zero;
- `null/unknown` = not measured or provider returned no value;
- `not_available` = provider explicitly cannot provide the metric;
- `error` = attempted but failed.

Never interpret missing Semrush data as a zero-quality domain.

---

# 4. Railway topology

Use Railway as the primary infrastructure platform.

As of this specification, Railway has no Brazil compute region. Use **US East / Virginia** for the initial core deployment because the operation is Brazil-focused and this is the preferred available Railway region for this project.

Compute region identifier:

`us-east4-eqdc4a`

Railway bucket region:

`iad`

## 4.1 Railway Project A — `dominio-x-core`

Create one Railway project named:

`dominio-x-core`

Services:

```text
dominio-x-core
├── web
├── api
├── worker
├── scheduler-registro-br
├── postgres
├── redis
└── dominio-x-data (Railway Storage Bucket)
```

Optional later:

```text
├── worker-seo
├── worker-history
└── worker-ai
```

For the MVP, one general-purpose `worker` is preferred. Split workers only when operational evidence justifies it.

### Public exposure

Public:

- `web`
- `api`

Private-only:

- PostgreSQL
- Redis
- worker
- cron service

PostgreSQL and Redis must not be exposed publicly.

Configure `/health` on `api` and an appropriate health endpoint on `web`.

## 4.2 Railway Project B — `dominio-x-crawlers`

Create a second Railway project:

`dominio-x-crawlers`

Initial service:

```text
dominio-x-crawlers
└── crawler
```

The crawler project is intentionally isolated from the core project's Railway private network.

The crawler must **not** receive:

- `DATABASE_URL`;
- Redis credentials;
- Semrush API keys;
- admin secrets;
- bucket write credentials unless absolutely required;
- unrestricted internal Core credentials.

Communication must happen through a narrow authenticated HTTPS machine API exposed by the Core API.

This isolation is required because crawler workloads interact with untrusted domains and are exposed to SSRF, DNS rebinding and malicious HTTP content.

---

# 5. Technology stack

Use this stack unless repository constraints make an equivalent choice materially better.

## Language/runtime

- Node.js current Railway-supported LTS
- TypeScript
- `pnpm`
- Turborepo

## Frontend

- Next.js
- React
- Tailwind CSS
- shadcn/ui or equivalent accessible component layer
- TanStack Query
- Zod
- lightweight charting library only where useful

## API

- Fastify
- TypeScript
- Zod or TypeBox for runtime validation
- OpenAPI generation
- Pino structured logging
- request IDs

## Database

- PostgreSQL
- Drizzle ORM
- Drizzle migrations

Prefer PostgreSQL-native features over introducing additional databases.

## Queue

- Redis
- BullMQ

## Storage

- Railway Storage Bucket
- S3-compatible client using AWS SDK v3

## Testing

- Vitest
- Supertest/Fastify inject for API
- Playwright for critical web flows
- Docker Compose for local Postgres + Redis where useful

## Code quality

- ESLint
- Prettier
- strict TypeScript
- no `any` except tightly justified adapter boundaries

---

# 6. Monorepo structure

Create approximately:

```text
dominio-x/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── public/
│   │   ├── package.json
│   │   └── railway.json
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── routes/
│   │   │   ├── auth/
│   │   │   ├── middleware/
│   │   │   └── modules/
│   │   ├── package.json
│   │   └── railway.json
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── worker.ts
│   │   │   ├── processors/
│   │   │   └── queues/
│   │   ├── package.json
│   │   └── railway.json
│   │
│   ├── scheduler/
│   │   ├── src/
│   │   │   └── registro-br.ts
│   │   ├── package.json
│   │   └── railway.json
│   │
│   └── crawler/
│       ├── src/
│       │   ├── crawler.ts
│       │   ├── security/
│       │   └── analyzers/
│       ├── package.json
│       └── railway.json
│
├── packages/
│   ├── database/
│   │   ├── src/
│   │   ├── migrations/
│   │   └── package.json
│   │
│   ├── contracts/
│   ├── config/
│   ├── domain-core/
│   ├── normalization/
│   ├── rule-engine/
│   ├── scoring/
│   ├── providers/
│   │   ├── src/
│   │   │   ├── semrush/
│   │   │   ├── dns/
│   │   │   ├── rdap/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── source-adapters/
│   │   ├── src/
│   │   │   ├── registro-br/
│   │   │   ├── manual/
│   │   │   └── csv/
│   │   └── package.json
│   ├── queue/
│   ├── storage/
│   ├── observability/
│   └── ui/
│
├── scripts/
│   ├── railway-bootstrap.sh
│   ├── railway-deploy.sh
│   ├── smoke-production.sh
│   └── seed-admin.ts
│
├── docs/
│   ├── architecture.md
│   ├── providers.md
│   ├── scoring.md
│   ├── railway.md
│   ├── security.md
│   └── runbooks.md
│
├── .env.example
├── .gitignore
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── README.md
└── CLAUDE.md
```

If this specification itself is named differently, also create a concise repository `CLAUDE.md` linking to the master spec and containing the non-negotiable engineering rules.

---

# 7. Core domain entities

Use UUIDs (prefer UUIDv7 if a mature implementation is available; otherwise UUIDv4).

Use `timestamptz`.

Use database constraints in addition to application validation.

## 7.1 `domains`

Canonical unique domain identity.

Recommended fields:

```text
id
fqdn
ascii_fqdn
unicode_fqdn
sld
tld
registrable_domain
normalization_version
first_seen_at
last_seen_at
created_at
updated_at
```

Constraints:

- normalized `ascii_fqdn` unique;
- lowercase canonical storage;
- support IDN/punycode;
- reject invalid hostnames;
- preserve unicode representation when present.

Indexes:

- `ascii_fqdn` unique;
- `tld`;
- `sld`;
- `first_seen_at`;
- trigram index for search if useful.

## 7.2 `sources`

```text
id
key
name
type
enabled
config_json
created_at
updated_at
```

Initial source keys:

- `registro_br_release`
- `manual`
- `csv_import`

## 7.3 `source_batches`

```text
id
source_id
external_reference
status
content_sha256
artifact_key
etag
last_modified
detected_at
published_at nullable
domain_count
metadata_json
created_at
```

Uniqueness should prevent duplicate batches for the same content hash/source.

## 7.4 `source_batch_domains`

```text
source_batch_id
domain_id
raw_value
position
created_at
```

Composite unique key:

`(source_batch_id, domain_id)`

## 7.5 `analysis_runs`

```text
id
domain_id
trigger_type
trigger_reference
pipeline_version
status
priority
started_at
completed_at
failed_at
error_code
error_message_sanitized
created_at
```

Statuses:

- queued
- running
- completed
- partial
- failed
- cancelled

## 7.6 `analysis_steps`

```text
id
analysis_run_id
step_key
provider_key nullable
status
attempt
started_at
completed_at
duration_ms
error_code nullable
metadata_json
```

## 7.7 `domain_observations`

Generic normalized provider/local observations.

```text
id
domain_id
analysis_run_id
provider_key
metric_key
value_type
value_numeric nullable
value_text nullable
value_boolean nullable
value_json nullable
state
observed_at
expires_at nullable
confidence_numeric nullable
raw_evidence_key nullable
license_class
metadata_json
created_at
```

`state`:

- measured
- unknown
- not_available
- error

`license_class` examples:

- internal
- public_source
- provider_restricted
- provider_contractual

Create indexes for:

- `(domain_id, metric_key, observed_at desc)`
- `(provider_key, metric_key)`
- `expires_at`
- `analysis_run_id`

## 7.8 `provider_requests`

Track API usage and cost.

```text
id
provider_key
analysis_run_id nullable
domain_id nullable
endpoint_key
request_count
units_used nullable
estimated_cost_usd nullable
status_code nullable
started_at
duration_ms
cached
error_code nullable
metadata_json
```

No sensitive request bodies.

## 7.9 `rulesets`

```text
id
name
version
status
description
created_by
created_at
activated_at nullable
```

Only one active default ruleset per intended scope.

## 7.10 `rules`

```text
id
ruleset_id
key
name
description
category
priority
enabled
condition_json
action_json
reason_code
created_at
updated_at
```

No runtime `eval`.

Rule DSL must be parsed and validated.

## 7.11 `rule_executions`

```text
id
analysis_run_id
domain_id
rule_id
matched
action
reason_code
evidence_json
created_at
```

## 7.12 `score_models`

```text
id
name
version
status
weights_json
config_json
created_at
activated_at nullable
```

## 7.13 `domain_scores`

```text
id
domain_id
analysis_run_id
score_model_id
name_score
brand_score
seo_score
link_score
history_score
commercial_score
risk_score
acquisition_score
confidence_score
overall_score
explanation_json
created_at
```

All component scores use `0..100`.

For `risk_score`, higher means riskier.

For other value scores, higher generally means better.

## 7.14 `shortlists`

```text
id
name
description
status
created_by
created_at
updated_at
```

## 7.15 `shortlist_domains`

```text
shortlist_id
domain_id
analysis_run_id
rank nullable
note nullable
added_by
created_at
```

## 7.16 `tags` and `domain_tags`

Allow analyst-managed classification.

## 7.17 `audit_logs`

Track sensitive/internal changes:

- login;
- ruleset activation;
- score model activation;
- shortlist changes;
- provider config changes;
- manual reanalysis;
- admin changes.

---

# 8. Domain normalization

Create one deterministic normalization module with tests.

Required behavior:

1. trim whitespace;
2. lowercase canonical representation;
3. remove accidental URL scheme/path if user pastes a URL, but clearly distinguish the extraction step from domain validation;
4. normalize trailing dot;
5. support IDN conversion;
6. preserve original unicode;
7. derive registrable domain using a maintained Public Suffix List implementation;
8. reject IP addresses as domains;
9. reject localhost and malformed hostnames;
10. enforce practical length constraints.

All ingestion paths must use the same normalization package.

---

# 9. Source adapter contract

Create a stable interface similar to:

```ts
export interface SourceAdapter {
  readonly key: string;

  probe(input: SourceProbeContext): Promise<SourceProbeResult>;

  fetch(input: SourceFetchContext): Promise<SourceArtifact>;

  parse(artifact: SourceArtifact): AsyncIterable<RawDomainRecord>;
}
```

The Core must not contain source-specific parsing code.

Implement:

- `RegistroBrReleaseSourceAdapter`
- `ManualSourceAdapter`
- `CsvSourceAdapter`

CSV import should accept a simple one-domain-per-row format initially and return clear row-level validation errors.

---

# 10. Registro.br adapter

The adapter must use:

`https://registro.br/dominio/lista-processo-liberacao.txt`

Requirements:

- standard HTTP client, not browser automation;
- timeout;
- retry only for transient failures;
- custom descriptive User-Agent;
- conditional request support when possible;
- calculate SHA-256 regardless of headers;
- store raw bytes in Railway Bucket;
- parser must be tolerant of blank lines and safe formatting differences;
- parser must not guess invalid lines into valid domains;
- record parse statistics;
- idempotent ingestion;
- duplicate source content must not generate a new batch;
- repeated domains across different batches must reference the existing domain identity.

Object key convention:

```text
sources/registro-br/YYYY/MM/<timestamp>-<sha256>.txt
```

Store metadata separately or in the database.

---

# 11. Provider contract

Create a provider abstraction similar to:

```ts
export type ProviderCapability =
  "dns" | "http" | "seo" | "backlinks" | "traffic" | "keywords" | "rdap" | "reputation" | "history";

export interface EnrichmentProvider {
  readonly key: string;
  readonly capabilities: readonly ProviderCapability[];

  isConfigured(): Promise<boolean> | boolean;

  estimate(request: EnrichmentRequest): Promise<ProviderEstimate>;

  enrich(request: EnrichmentRequest): Promise<ProviderResult>;
}
```

Provider metadata/config must include:

```text
key
enabled
paid
rate_limit
concurrency_limit
timeout
default_ttl
retention_policy
capabilities
```

Provider errors must not crash the entire analysis.

Use circuit-breaker behavior for repeatedly failing providers.

---

# 12. Initial providers

## 12.1 Local lexical provider

Cost: zero.

Metrics should include at least:

- domain length;
- SLD length;
- number of labels;
- digit count;
- hyphen count;
- repeated-character patterns;
- alphabetic ratio;
- contains punycode;
- tokenizable terms when confidently detected;
- suspiciously long/random-looking name heuristic;
- TLD;
- whether it is `.br`;
- whether it is `.com.br`.

Do not overstate linguistic/brand quality from primitive heuristics.

## 12.2 DNS provider

Collect safely:

- A
- AAAA
- MX
- NS
- TXT presence/count
- CNAME where applicable
- resolution status

Record TTL where useful.

Do not follow network targets here.

## 12.3 RDAP provider

Implement as a modular provider.

Do not make RDAP mandatory for every `.br` domain.

Use only standards-compliant endpoints and rate limiting.

Never build a mass personal-data harvesting feature.

## 12.4 Semrush provider

Use official Semrush APIs.

**Do not implement Semrush website scraping as the production data source.**

The provider must remain disabled if `SEMRUSH_API_KEY` is absent.

As of 2026-09-02, Semrush documentation states a general limit of:

- 10 requests/second;
- 10 simultaneous requests/account;

and API use is also constrained by plan/API units.

Therefore:

- implement a Redis-backed global rate limiter;
- set the default configuration below those ceilings, e.g. 8 RPS and 8 concurrent;
- handle 429 with exponential backoff + jitter;
- enforce timeout;
- record API units/cost where returned or calculable;
- centralize all API calls in the provider adapter;
- never let arbitrary route handlers call Semrush directly;
- provide a `provider_requests` ledger;
- expose daily/monthly usage in the admin UI;
- implement a configurable quota ceiling that can stop paid analysis before budget overrun.

### Semrush retention/licensing

Provider data retention must be configurable by metric/provider.

Default provider-restricted TTL should be conservative.

Do not assume Dominio-X has perpetual rights to store or use Semrush-derived data.

Create configuration such as:

```env
SEMRUSH_DATA_TTL_DAYS=30
```

and make provider retention rules explicit.

Do not train an ML model on provider-restricted data unless contractually permitted.

---

# 13. HTTP crawler architecture

HTTP/domain crawling must run only from the isolated `dominio-x-crawlers` project.

The crawler must claim work from Core through authenticated HTTPS endpoints.

Suggested flow:

```text
crawler
  ↓ POST /v1/internal/crawler/jobs/claim
core
  ↓ returns one short-lived job
crawler
  ↓ performs constrained fetch
crawler
  ↓ POST /v1/internal/crawler/jobs/:id/complete
core
  ↓ validates result and enqueues next stage
```

Authentication:

- machine token with crawler-only scope;
- token stored only in Railway Variables;
- rotateable;
- use constant-time verification where relevant;
- TLS only;
- no user/admin session reuse.

Use a dedicated variable:

`CRAWLER_MACHINE_TOKEN`

The token must be at least 32 random bytes.

Prefer job lease semantics:

- claim;
- lease expiry;
- heartbeat optional;
- complete;
- failed;
- reclaim after timeout.

---

# 14. SSRF and crawler security — mandatory

This is not optional.

Before every network connection:

1. parse URL;
2. allow only `http:` and `https:`;
3. reject embedded credentials;
4. resolve DNS;
5. reject any address that is:
   - loopback;
   - private;
   - link-local;
   - carrier-grade NAT;
   - multicast;
   - unspecified;
   - documentation/test network;
   - reserved;
   - IPv4-mapped unsafe IPv6;
   - cloud metadata destination;
6. pin/revalidate resolved addresses where practical;
7. repeat validation on every redirect;
8. cap redirect count;
9. cap response bytes;
10. cap total duration;
11. cap decompressed size;
12. restrict methods to GET/HEAD initially;
13. do not execute downloaded binaries;
14. do not execute page JavaScript in the MVP crawler;
15. do not use Playwright unless a later explicit module requires it.

Initial crawler limits:

```text
connect timeout: 5s
total timeout: 12s
max redirects: 5
max body: 2 MB
max decompressed body: 4 MB
```

Values should be configurable.

Block known metadata destinations such as `169.254.169.254`.

The crawler service should not have secrets unrelated to crawling.

---

# 15. Analysis pipeline

Use BullMQ.

Queues should be named and versioned.

Initial logical stages:

```text
domain.preflight
domain.dns
domain.crawl
domain.candidate-gate
domain.seo
domain.rules
domain.score
domain.complete
```

The worker may consume several queues in the MVP, but queue names/contracts must allow future split workers.

## Pipeline sequence

### Stage A — preflight

- normalize;
- lexical metrics;
- cheap exclusions;
- dedupe current work;
- create/update observations.

### Stage B — DNS

- basic DNS enrichment;
- no paid provider.

### Stage C — crawler

Only if enabled/configured.

- HTTP status;
- redirect chain;
- final hostname;
- title;
- lightweight meta description;
- content type;
- approximate content length;
- HTTPS availability.

Do not persist full arbitrary HTML by default.

### Stage D — candidate gate

Decide whether paid enrichment is justified.

The gate must be configuration-driven and visible in the UI.

Default behavior should be conservative.

Example initial concept:

```text
hard reject:
- invalid normalization
- extreme random-string heuristic
- prohibited internal/manual blacklist match

paid-provider candidate:
- not hard rejected
- passes minimum lexical quality OR
- has meaningful DNS/HTTP evidence OR
- analyst forced deep analysis
```

Do not hard-code arbitrary business thresholds throughout the codebase.

### Stage E — Semrush

Run only if:

- provider enabled;
- configured;
- candidate gate says yes;
- quota/budget allows;
- result is not already fresh according to TTL unless forced.

### Stage F — rules

Evaluate current active ruleset against the latest valid observations.

### Stage G — scores

Compute component scores and explanation.

### Stage H — complete

Mark analysis as:

- completed;
- partial when optional providers failed but a usable result exists;
- failed only when core analysis could not be produced.

---

# 16. Job semantics

Every job must be:

- idempotent;
- retry-safe;
- traceable to `analysis_run_id`;
- bounded by timeout;
- able to resume after worker restart.

Use deterministic BullMQ `jobId` where useful to prevent accidental duplicate work.

Retries:

- no retries for deterministic validation errors;
- limited retries for transient network/API failures;
- exponential backoff + jitter.

Do not retry permanent provider quota/authentication errors endlessly.

Dead-letter behavior:

- persist failure details;
- expose them in admin UI;
- allow manual retry.

---

# 17. Rule engine

Build a JSON rule DSL.

Do not use JavaScript `eval`, dynamic functions, SQL fragments from the UI or arbitrary code execution.

Supported operators should initially include:

```text
eq
neq
gt
gte
lt
lte
exists
not_exists
in
not_in
contains
starts_with
ends_with
matches_safe_regex
and
or
not
```

Use RE2 or another safe-regex strategy if regex is supported.

Example rule:

```json
{
  "all": [
    { "metric": "lexical.sld_length", "op": "lte", "value": 12 },
    { "metric": "lexical.digit_count", "op": "eq", "value": 0 }
  ]
}
```

Actions:

```text
reject
quarantine
warn
tag
score_adjustment
candidate_allow
candidate_deny
```

Every rule execution must record:

- matched or not;
- rule version;
- reason code;
- relevant evidence;
- resulting action.

## Initial system rules

Seed a small, conservative ruleset only.

Examples:

- invalid/malformed → reject;
- analyst blacklist → reject;
- excessive digits → warning or score penalty, not necessarily hard reject;
- excessive hyphens → warning/penalty;
- punycode → flag for review, not automatic malicious classification;
- crawler security failure → quarantine;
- provider reputation risk when future provider exists → quarantine.

Avoid aggressive early rules that may discard valuable domains before the company has real acquisition feedback.

---

# 18. Scoring engine

Scores must be versioned and explainable.

Dimensions:

```text
name_score
brand_score
seo_score
link_score
history_score
commercial_score
risk_score
acquisition_score
confidence_score
overall_score
```

The MVP may have unavailable dimensions when no provider supplies evidence.

Do not fabricate data.

## Initial philosophy

The first scoring model should deliberately be simple and transparent.

It should use weighted normalized signals.

Example:

```text
overall value score =
  25% name
  20% brand
  25% seo
  10% link
  10% history
  10% commercial
```

Then apply risk/acquisition considerations separately.

However, if SEO/link/history inputs are unavailable, renormalize only among valid dimensions and reduce `confidence_score`.

Do not reward absence of risk data as if risk had been checked.

### Confidence score

Must account for:

- number of expected dimensions measured;
- provider freshness;
- provider failures;
- consistency of evidence;
- whether deep analysis was skipped intentionally.

The UI must show why confidence is low.

### Score explanation

Persist a human-readable structured explanation:

```json
{
  "positive": [
    {
      "signal": "Short SLD",
      "impact": 12,
      "evidence": "8 characters"
    }
  ],
  "negative": [
    {
      "signal": "Digit in name",
      "impact": -4,
      "evidence": "1 digit"
    }
  ],
  "missing": [
    {
      "signal": "SEO traffic",
      "reason": "Semrush not configured"
    }
  ]
}
```

---

# 19. Manual analyst decisions

The analyst must be able to:

- force reanalysis;
- force deep/paid analysis;
- add/remove domain tags;
- add to shortlist;
- add notes;
- manually mark:
  - interesting;
  - rejected;
  - monitoring;
  - acquisition target;
  - acquired;
- override automatic disposition without rewriting historic rule results.

Human action should be additive and audited.

---

# 20. Initial web application

Design for internal desktop use first, while remaining responsive.

Visual style:

- professional;
- information-dense;
- clean;
- neutral;
- fast;
- no unnecessary marketing UI.

## Main navigation

```text
Overview
Domains
Release Batches
Analysis Queue
Shortlists
Rules
Providers
Usage & Costs
Audit
Settings
```

## 20.1 Overview

Show:

- domains known;
- domains analyzed;
- current queue depth;
- analysis success/partial/failure;
- latest Registro.br batch;
- latest batch funnel;
- high-score candidates;
- provider usage;
- Semrush units/cost if configured;
- recent operational errors.

## 20.2 Domain Explorer

Filters:

- fqdn search;
- source;
- batch;
- TLD;
- overall score range;
- individual score ranges;
- confidence;
- analysis status;
- tags;
- digits;
- hyphens;
- domain length;
- Semrush presence;
- DNS presence;
- HTTP status;
- shortlisted;
- manual disposition.

Support sortable columns.

Pagination must be server-side.

Do not load entire batches into the browser.

## 20.3 Domain detail

Sections:

### Header

- domain;
- overall score;
- confidence;
- disposition;
- tags;
- actions.

### Score cards

- Name
- Brand
- SEO
- Link
- History
- Commercial
- Risk
- Acquisition
- Confidence

### Why this score?

Show positive, negative and missing evidence.

### Observations

Table:

```text
metric
value
provider
observed_at
expires_at
state
analysis_run
```

### Analysis history

Timeline of previous analysis runs.

### Rules

Show matched rules and consequences.

### Source history

Show all batches/imports where the domain appeared.

### Provider history

Show provider requests without leaking secrets.

## 20.4 Release Batches

List batches.

Batch detail:

- source;
- detection date;
- content hash;
- raw artifact;
- total domains;
- new domains;
- previously seen;
- analyzed;
- rejected locally;
- paid-analyzed;
- high potential;
- shortlisted;
- failed.

Include funnel visualization.

## 20.5 Queue

Show BullMQ-derived operational counters plus persisted run state.

Allow retry of failed analysis.

## 20.6 Shortlists

Create/edit shortlists and notes.

Export shortlist to CSV.

## 20.7 Rules

- list rulesets;
- create draft;
- clone active ruleset;
- edit rules;
- validate DSL;
- test a draft ruleset against selected domains;
- activate version;
- retain old active versions historically.

Do not edit an active version in place.

## 20.8 Providers

For each provider:

- configured?
- enabled?
- status;
- capabilities;
- default TTL;
- rate limit;
- last success;
- recent failure rate;
- request count;
- units/cost.

API keys must never be returned to the frontend.

## 20.9 Usage & Costs

At minimum:

- requests by provider/day;
- Semrush units;
- estimated provider cost;
- cache hit rate;
- paid analyses skipped by candidate gate;
- monthly configurable budget;
- budget utilization.

---

# 21. Authentication and authorization

Dominio-X is an internal system.

Implement app-level authentication.

Use secure server-side sessions.

Initial roles:

- `admin`
- `analyst`
- `viewer`

Permissions:

### admin

- everything;
- provider settings;
- ruleset activation;
- user management.

### analyst

- analyze domains;
- batches;
- shortlists;
- notes;
- tags;
- draft rules;
- cannot expose/change secrets;
- cannot manage users.

### viewer

- read-only analytics.

Security requirements:

- password hashing with Argon2id or a mature equivalent;
- secure, HttpOnly cookies;
- `SameSite=Lax` or stricter where workable;
- `Secure` in production;
- session expiry;
- CSRF protection for state-changing cookie-auth requests;
- login rate limiting;
- audit authentication events;
- do not expose password hashes.

### Bootstrap admin

Support environment variables only for initial bootstrap:

```env
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=
```

On first migration/seed, create the admin if no user exists.

After successful creation:

- document that these variables should be removed from Railway;
- do not recreate/reset the admin on subsequent deploys;
- never print the password.

If the variables are absent, provide a secure CLI script:

`pnpm admin:create`

---

# 22. API

Prefix:

`/v1`

Generate OpenAPI documentation.

Keep internal crawler routes outside ordinary analyst capabilities.

## Public authenticated endpoints

Minimum:

```text
POST   /v1/auth/login
POST   /v1/auth/logout
GET    /v1/auth/me

GET    /v1/dashboard

GET    /v1/domains
POST   /v1/domains
GET    /v1/domains/:domainId
POST   /v1/domains/:domainId/analyze
GET    /v1/domains/:domainId/analyses
GET    /v1/domains/:domainId/observations
GET    /v1/domains/:domainId/rules
GET    /v1/domains/:domainId/scores

GET    /v1/batches
GET    /v1/batches/:batchId
POST   /v1/batches/import
POST   /v1/batches/:batchId/analyze

GET    /v1/analysis-runs
GET    /v1/analysis-runs/:runId
POST   /v1/analysis-runs/:runId/retry

GET    /v1/shortlists
POST   /v1/shortlists
GET    /v1/shortlists/:id
PATCH  /v1/shortlists/:id
POST   /v1/shortlists/:id/domains
DELETE /v1/shortlists/:id/domains/:domainId
GET    /v1/shortlists/:id/export.csv

GET    /v1/rulesets
POST   /v1/rulesets
GET    /v1/rulesets/:id
POST   /v1/rulesets/:id/clone
POST   /v1/rulesets/:id/activate
POST   /v1/rulesets/:id/test

GET    /v1/providers
GET    /v1/providers/:key
PATCH  /v1/providers/:key

GET    /v1/usage
GET    /v1/audit
```

## Health

```text
GET /health
GET /ready
```

`/health` should indicate the process is alive.

`/ready` should verify critical dependencies such as DB and Redis with strict short timeouts.

Do not leak internal hostnames/secrets in health output.

## Internal crawler endpoints

```text
POST /v1/internal/crawler/jobs/claim
POST /v1/internal/crawler/jobs/:jobId/heartbeat
POST /v1/internal/crawler/jobs/:jobId/complete
POST /v1/internal/crawler/jobs/:jobId/fail
```

Protect these with machine-token middleware and dedicated rate limiting.

---

# 23. Search and filtering

Use PostgreSQL.

Do not introduce Elasticsearch in the MVP.

For domain search:

- exact normalized match;
- prefix/substring where useful;
- `pg_trgm` extension when needed;
- indexed numeric score filters.

Use keyset or efficient pagination for large tables when practical.

Avoid `OFFSET` pagination for extremely deep pages if performance degrades.

---

# 24. Storage abstraction

Create:

```ts
export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(input: GetObjectInput): Promise<Readable>;
  headObject(input: HeadObjectInput): Promise<ObjectMetadata | null>;
  createPresignedGetUrl(...): Promise<string>;
}
```

Implement Railway S3-compatible adapter.

Never make business logic depend directly on Railway-specific APIs.

Expected env vars:

```env
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_REGION=auto
S3_URL_STYLE=virtual
```

Map Railway bucket credentials into these variables using Railway variable references where possible.

Raw artifacts are private.

Only authenticated users may receive short-lived presigned URLs where the UI needs artifact access.

---

# 25. Configuration

Use runtime-validated environment configuration.

Fail fast for missing critical config.

Optional provider config must not prevent application boot.

Example `.env.example`:

```env
NODE_ENV=development

# API / Web
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000
PORT=4000

# Security
SESSION_SECRET=
CRAWLER_MACHINE_TOKEN=

# Bootstrap
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=

# PostgreSQL
DATABASE_URL=postgresql://dominiox:dominiox@localhost:5432/dominiox

# Redis
REDIS_URL=redis://localhost:6379

# Storage
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio123
S3_BUCKET=dominio-x-data
S3_REGION=us-east-1
S3_URL_STYLE=path

# Registro.br
REGISTRO_BR_RELEASE_URL=https://registro.br/dominio/lista-processo-liberacao.txt
REGISTRO_BR_USER_AGENT=Dominio-X/1.0 (+internal-domain-intelligence)

# Semrush
SEMRUSH_ENABLED=false
SEMRUSH_API_KEY=
SEMRUSH_MAX_RPS=8
SEMRUSH_MAX_CONCURRENCY=8
SEMRUSH_DATA_TTL_DAYS=30
SEMRUSH_MONTHLY_UNIT_BUDGET=

# Crawler
CRAWLER_ENABLED=true
CRAWLER_CORE_API_URL=http://localhost:4000
CRAWLER_CONNECT_TIMEOUT_MS=5000
CRAWLER_TOTAL_TIMEOUT_MS=12000
CRAWLER_MAX_REDIRECTS=5
CRAWLER_MAX_BODY_BYTES=2097152
CRAWLER_MAX_DECOMPRESSED_BYTES=4194304

# Observability
SENTRY_DSN=
LOG_LEVEL=info
```

Generate strong random production secrets.

---

# 26. Local development

Create `docker-compose.yml` with:

- PostgreSQL;
- Redis;
- MinIO for local S3-compatible testing.

Do not require paid APIs for local boot.

Commands should work:

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Root scripts:

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "lint": "...",
    "typecheck": "...",
    "test": "...",
    "test:e2e": "...",
    "db:generate": "...",
    "db:migrate": "...",
    "db:seed": "...",
    "admin:create": "..."
  }
}
```

---

# 27. Testing requirements

Do not deploy until the critical suite passes.

## Unit tests

At minimum:

- normalization;
- IDN/punycode;
- source parser;
- SHA dedupe;
- rule operators;
- rule action handling;
- scoring;
- confidence score;
- provider TTL behavior;
- candidate gate;
- SSRF IP classification;
- redirect validation;
- rate limiter logic where practical.

## Integration tests

- create domain;
- enqueue analysis;
- worker completes local analysis;
- same domain dedupes;
- same Registro.br artifact does not create duplicate batch;
- changed artifact creates new batch;
- observations are versioned;
- rules execute;
- scores generated;
- shortlist flow;
- provider missing credentials results in partial/skip, not crash;
- API RBAC;
- crawler job lease.

## E2E

Critical browser flow:

1. login;
2. submit one domain;
3. see queued/running/completed analysis;
4. open domain detail;
5. add to shortlist;
6. view batch page.

## Security tests

Explicit tests for crawler blocking:

- `127.0.0.1`;
- `0.0.0.0`;
- `10.0.0.0/8`;
- `172.16.0.0/12`;
- `192.168.0.0/16`;
- `169.254.169.254`;
- IPv6 loopback;
- IPv6 private/link-local;
- redirect from public target to private target.

---

# 28. Observability

Use structured JSON logs.

Every relevant log should include as appropriate:

```text
request_id
analysis_run_id
domain_id
job_id
provider_key
source_batch_id
duration_ms
```

Do not log raw auth tokens or provider secrets.

Implement:

- request logging;
- worker job start/end;
- provider request summary;
- source ingestion summary;
- uncaught exception logging;
- queue failures.

Sentry is optional and enabled only when `SENTRY_DSN` exists.

Create an internal operational dashboard from persisted metrics first. Avoid introducing Prometheus/Grafana into the MVP unless actually required.

---

# 29. Database migrations and deploy safety

Use immutable migrations.

Production deploy flow:

1. deploy code that is backward compatible with the current schema when possible;
2. run migrations once using an explicit migration command/job;
3. verify migration;
4. activate dependent feature.

Do not have every API/worker replica race to run migrations at boot.

Create a deploy migration script.

If using Railway pre-deploy command is reliable for the chosen structure, configure it. Otherwise execute:

```bash
railway run --service api pnpm db:migrate
```

or an equivalent targeted command.

Never run destructive migration automatically without backup/review.

---

# 30. Railway configuration as code

Each deployable app should have a `railway.json` or `railway.toml`.

Use Railway Config as Code for:

- start command;
- healthcheck;
- restart policy;
- cron schedule;
- region where supported.

Remember Railway monorepo behavior:

- shared JavaScript monorepos are supported;
- services should use distinct start commands / watch paths;
- `railway.json` path/root configuration must be correct;
- do not cause every source change to rebuild every service unnecessarily.

Use `watchPatterns`/Watch Paths when supported by the current Railway config schema.

Before writing final config, verify the current official Railway Config as Code schema.

---

# 31. Railway provisioning — required

Claude Code must provision the platform, not merely write instructions.

First verify:

```bash
railway --version
railway whoami
```

If Railway CLI is unavailable, install through an official method appropriate to the environment.

Official npm option:

```bash
npm i -g @railway/cli
```

If authentication is required:

```bash
railway login
```

Only this external authentication step may require user interaction.

## 31.1 Avoid duplicate resources

Before creation:

```bash
railway project list
```

If `dominio-x-core` or `dominio-x-crawlers` already exists, inspect it and reuse safely rather than blindly creating a duplicate.

## 31.2 Create core project

If absent:

```bash
railway init --name dominio-x-core
```

Provision:

```bash
railway add --database postgres
railway add --database redis

railway add --service web
railway add --service api
railway add --service worker
railway add --service scheduler-registro-br
```

Create bucket:

```bash
railway bucket create dominio-x-data --region iad
```

Configure all core compute in US East / Virginia when the current Railway CLI/API supports it.

Use Railway variable references so API/worker/scheduler receive private DB, Redis and bucket credentials.

Do not expose Postgres or Redis publicly.

## 31.3 Create crawler project

Create/link the second project safely:

```bash
railway init --name dominio-x-crawlers
railway add --service crawler
```

Configure crawler in US East.

Crawler variables must include only:

```text
NODE_ENV
CRAWLER_CORE_API_URL
CRAWLER_MACHINE_TOKEN
crawler limits
LOG_LEVEL
SENTRY_DSN optional
```

No DB/Redis/Semrush credentials.

## 31.4 Service source/build configuration

All code may come from the same repository.

For the shared monorepo:

- `web` starts only web;
- `api` starts only API;
- `worker` starts only worker;
- `scheduler-registro-br` starts the one-shot scheduler command;
- `crawler` starts only crawler.

The scheduler service must have Railway cron:

```text
0 */6 * * *
```

and the process must exit after completion.

## 31.5 Health checks

API:

```text
/health
```

Web:

implement a lightweight endpoint such as:

```text
/api/health
```

and configure Railway health checks.

The worker/crawler are not public web health services unless needed; use process lifecycle and operational endpoints appropriately.

## 31.6 Production variables

Generate production values for:

```text
SESSION_SECRET
CRAWLER_MACHINE_TOKEN
```

Use cryptographically secure random values.

Set Railway variables without echoing secrets into source or logs.

Semrush:

- if API key is available, configure it;
- otherwise leave provider disabled;
- do not block production deploy.

Bootstrap admin:

- if the user supplied credentials securely, set them temporarily;
- otherwise create a secure CLI/admin bootstrap path and report the exact one-time command the operator must run.

## 31.7 Storage credentials

Use:

```bash
railway bucket credentials
```

or Railway variable references.

Do not commit output.

Map Railway's S3 values into app variables.

Railway currently provides S3-compatible bucket values including endpoint, access key, secret, bucket name and region.

## 31.8 Deploy code

Use current Railway CLI supported deployment commands.

For application code:

```bash
railway up --service web
railway up --service api
railway up --service worker
railway up --service scheduler-registro-br
```

In the crawler project:

```bash
railway up --service crawler
```

If the service is connected to GitHub with autodeploy and deploy is triggered by push, verify the deployment status rather than blindly uploading twice.

Use:

```bash
railway service status
railway logs
```

as needed.

Fix failed builds and redeploy until healthy.

## 31.9 Public URLs

Generate Railway public networking/domain for:

- web;
- api.

Use Railway-provided domains initially.

Do not make custom DNS a blocker.

Configure:

```text
APP_URL=<web public URL>
API_URL=<api public URL>
NEXT_PUBLIC_API_URL=<api public URL>
CRAWLER_CORE_API_URL=<api public URL>
```

Then redeploy impacted services.

---

# 32. Railway region/layout rules

Core stateful services should stay in the same Railway region whenever possible.

Initial target:

- API: US East
- web: US East
- worker: US East
- scheduler: US East
- PostgreSQL: US East
- Redis: US East
- bucket: `iad`
- crawler: US East

Do not create cross-region chatter for no reason.

---

# 33. Queue connection

Use Railway private networking/reference variables inside `dominio-x-core`.

Do not route Postgres/Redis traffic over public TCP proxies.

The API and workers should use Railway's private database/Redis variables.

---

# 34. Cost controls

The application must contain provider-level cost controls independent of Railway billing.

Implement:

- Semrush monthly units budget;
- paid-provider enabled switch;
- maximum deep analyses per batch optional;
- estimated cost ledger;
- skip reason when budget exhausted;
- analyst forced analysis permission;
- dashboard budget utilization.

Never let an accidental batch import trigger unlimited paid-provider calls.

Recommended safeguard:

```text
new batch → local analysis first
paid enrichment → only after candidate gate
```

No provider request loop may be unbounded.

---

# 35. Caching/freshness

Observations have TTL.

A pipeline stage should reuse a fresh observation unless:

- forced reanalysis;
- a new analysis policy requires recomputation;
- observation is invalid;
- provider-specific rules require refresh.

Example categories:

```text
lexical: no expiry until normalization version changes
DNS: short TTL
HTTP: hours/days
Semrush: provider-configured TTL
```

Do not copy provider values into permanent domain columns.

---

# 36. Historical integrity

Never mutate prior analysis evidence to match the newest score.

When analysis runs again:

- create a new `analysis_run`;
- create new observations where remeasured;
- reuse a fresh observation by reference/metadata if allowed;
- create new rule executions;
- create new score row.

Domain detail should default to latest analysis, with historical runs available.

---

# 37. Data retention

Create a scheduled retention routine or maintenance command.

Rules:

- public/internal raw artifacts: retain according to internal policy;
- provider-restricted observations: expire according to provider policy/config;
- logs: do not rely on application DB for unlimited logs;
- audit logs: retain longer;
- secrets: never persist as observation.

When expiring restricted provider data:

- retain non-sensitive metadata necessary for audit where contract allows (e.g. provider called, timestamp, status, units);
- remove the restricted value/raw payload when retention expires.

Do not assume legal permissions that were not provided.

---

# 38. Semrush-specific implementation boundary

No UI/API code outside `packages/providers/semrush` should know Semrush endpoint URLs or response field names.

Normalize into generic metrics.

Example generic metric keys:

```text
seo.organic_keywords
seo.estimated_organic_traffic
seo.paid_keywords
seo.estimated_paid_traffic
seo.authority
links.referring_domains
links.backlinks
```

Only map values that the actual selected Semrush endpoint returns.

Do not fabricate metrics if a plan/endpoint lacks them.

Keep raw response storage off by default unless required and contractually allowed.

---

# 39. Initial filtering strategy

The MVP's first job is **data capture and learning**, not aggressive automatic rejection.

Create dispositions:

```text
accepted
rejected
quarantined
needs_review
```

Seed hard rejects sparingly.

Suggested initial cheap signals:

- malformed domain → reject;
- local/manual blacklist → reject;
- obvious unsupported namespace → reject;
- excessive digits → penalty;
- excessive hyphens → penalty;
- very long SLD → penalty;
- random-looking pattern → penalty;
- unicode/punycode → review flag;
- DNS presence → evidence, not automatically positive;
- active website → evidence, not automatically positive or negative.

Analysts must be able to see what the rule engine did.

---

# 40. CSV export/import safety

CSV export:

- prevent formula injection by escaping cells beginning with `=`, `+`, `-`, `@` when needed;
- UTF-8;
- deterministic headers.

CSV import:

- size cap;
- row cap configurable;
- row-level error summary;
- do not load arbitrarily huge files entirely into memory;
- stream when practical.

---

# 41. Security baseline

Implement:

- Zod/TypeBox validation;
- security headers;
- CORS allowlist;
- request size limits;
- auth rate limiting;
- RBAC;
- parameterized queries via ORM;
- no raw user SQL;
- no user-controlled shell commands;
- no dynamic imports from user input;
- secrets redaction;
- safe error responses;
- CSRF protection;
- SSRF protection;
- output encoding through React;
- CSV formula injection protection;
- pagination caps;
- upload limits;
- audit logs.

Dependencies:

- run package audit;
- do not ignore known critical vulnerabilities in reachable production code.

---

# 42. API error contract

Use a consistent shape:

```json
{
  "error": {
    "code": "DOMAIN_INVALID",
    "message": "The domain is invalid.",
    "requestId": "..."
  }
}
```

Do not expose stack traces in production.

Provider errors should be normalized, e.g.:

```text
PROVIDER_NOT_CONFIGURED
PROVIDER_RATE_LIMITED
PROVIDER_AUTH_FAILED
PROVIDER_QUOTA_EXHAUSTED
PROVIDER_TIMEOUT
PROVIDER_UPSTREAM_ERROR
```

---

# 43. Performance expectations

MVP targets:

- manual domain submission responds quickly with a queued analysis ID;
- no HTTP request waits for deep enrichment;
- list screens use pagination;
- background jobs handle batches;
- DB connections are pooled responsibly;
- provider concurrency is bounded;
- queue backlog does not cause API instability.

Use database indexes based on actual query paths.

Run `EXPLAIN` for the main domain explorer query with representative data.

---

# 44. Seed/dev dataset

Create development seed data including:

- one admin;
- example analysts/viewer in dev only;
- sample domains;
- sample source batch;
- sample analyses;
- active ruleset v1;
- score model v1;
- provider registry entries.

Never seed fake users into production except explicit bootstrap admin.

---

# 45. MVP milestones

Implement in this order.

## M0 — Repository foundation

Acceptance:

- monorepo boots;
- lint/typecheck/test commands;
- Docker Compose works;
- config validation;
- docs.

## M1 — Core identity and auth

Acceptance:

- Postgres schema;
- migrations;
- sessions;
- RBAC;
- admin bootstrap;
- audit basics.

## M2 — Domain ingestion

Acceptance:

- single domain;
- CSV;
- normalization;
- dedupe;
- domain explorer.

## M3 — Registro.br source

Acceptance:

- watcher;
- source artifact storage;
- SHA dedupe;
- immutable batch;
- batch UI;
- enqueue local analyses.

## M4 — Analysis core

Acceptance:

- BullMQ;
- local lexical provider;
- DNS provider;
- run/step tracking;
- queue UI.

## M5 — Isolated crawler

Acceptance:

- separate Railway crawler project;
- machine job API;
- SSRF defenses;
- HTTP observations;
- security tests.

## M6 — Rule engine

Acceptance:

- versioned rule DSL;
- draft/activate;
- executions/evidence;
- conservative default rules.

## M7 — Scoring

Acceptance:

- multidimensional scores;
- confidence;
- explanation;
- score history;
- filters.

## M8 — Semrush

Acceptance:

- official API adapter;
- provider disabled without key;
- global rate limit;
- unit/cost ledger;
- TTL;
- quota ceiling;
- candidate gate;
- usage dashboard.

## M9 — Shortlists & analyst workflow

Acceptance:

- shortlists;
- notes/tags;
- export;
- manual overrides/disposition.

## M10 — Railway production deployment

Acceptance:

- both projects deployed;
- core services healthy;
- databases private;
- bucket configured;
- cron configured;
- migration complete;
- public web/API URLs working;
- smoke test passes;
- deployment report written.

Do not claim a milestone complete while its acceptance criteria fail.

---

# 46. Production smoke test

Create `scripts/smoke-production.sh`.

It should, without exposing secrets:

1. verify API `/health`;
2. verify web health;
3. authenticate with a test/operator account when secure credentials are supplied through env;
4. submit a harmless known domain, e.g. `example.com`;
5. verify analysis run creation;
6. poll with a bounded timeout;
7. confirm local analysis completes/partially completes;
8. verify domain detail endpoint;
9. confirm no private DB endpoint is exposed.

Do not trigger paid Semrush analysis during smoke tests unless explicitly enabled for smoke usage.

---

# 47. Registro.br production verification

After production deploy:

- manually execute the scheduler once;
- verify response;
- verify raw artifact in bucket;
- verify `source_batches`;
- verify parser count;
- verify deduplication;
- verify some analysis jobs enqueue;
- run scheduler again against identical content;
- verify no duplicate batch.

Do not perform repeated aggressive polling manually.

---

# 48. Backup/runbook

Create `docs/runbooks.md` including:

- how to restore Postgres from Railway backup/snapshot;
- how to validate restore into a non-production DB;
- how to rotate `SESSION_SECRET` safely;
- how to rotate crawler machine token;
- how to rotate Semrush key;
- how to disable Semrush immediately;
- how to pause workers;
- how to retry dead jobs;
- how to re-run a source batch safely;
- how to export shortlists;
- how to respond to crawler SSRF/security incident.

Do not automate a destructive restore against production.

---

# 49. CI

Use GitHub Actions if the repository is on GitHub.

On pull request / push:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not require production secrets.

Production deploy may use Railway GitHub autodeploy from `main`.

Do not commit a Railway API token into GitHub.

If using token-based CI, use GitHub secrets.

---

# 50. Git policy

Create meaningful commits by milestone when practical.

Before production deploy:

- clean working tree or clearly documented generated changes;
- all source committed;
- no `.env`;
- no credentials;
- lockfile committed.

Suggested conventional commits:

```text
feat(core): ...
feat(registro-br): ...
feat(crawler): ...
feat(rules): ...
feat(scoring): ...
feat(semrush): ...
chore(railway): ...
```

Do not rewrite unrelated user history.

---

# 51. Definition of Done

Dominio-X MVP is only done when all of the following are true:

- [ ] repository builds cleanly;
- [ ] lint passes;
- [ ] typecheck passes;
- [ ] unit tests pass;
- [ ] integration tests pass;
- [ ] critical E2E passes;
- [ ] domain normalization is tested;
- [ ] manual single-domain analysis works;
- [ ] CSV ingestion works;
- [ ] Registro.br watcher works and is idempotent;
- [ ] raw Registro.br artifact is stored;
- [ ] batches are immutable;
- [ ] BullMQ pipeline works;
- [ ] DNS analysis works;
- [ ] crawler is isolated;
- [ ] SSRF test matrix passes;
- [ ] rule engine is versioned;
- [ ] scoring is explainable;
- [ ] shortlists work;
- [ ] provider cost ledger exists;
- [ ] Semrush integrates through official API when key exists;
- [ ] Semrush is safely disabled when key is absent;
- [ ] PostgreSQL is private;
- [ ] Redis is private;
- [ ] Railway bucket is private;
- [ ] Railway cron is configured;
- [ ] API healthcheck works;
- [ ] web healthcheck works;
- [ ] production migrations succeed;
- [ ] web is deployed;
- [ ] API is deployed;
- [ ] worker is deployed;
- [ ] scheduler is deployed;
- [ ] crawler is deployed in its separate project;
- [ ] production smoke test succeeds;
- [ ] operational runbook exists;
- [ ] final deployment report exists.

---

# 52. Things explicitly out of scope for the first MVP

Do not delay MVP for:

- Kubernetes;
- AWS migration;
- ClickHouse;
- Elasticsearch;
- custom ML training;
- automated domain purchasing;
- Registro.br account automation;
- mass WHOIS harvesting;
- automated trademark legal decisions;
- Playwright/browser crawling;
- public multi-tenant SaaS;
- billing;
- customer-facing accounts;
- mobile app;
- advanced AI scoring;
- arbitrary user-defined executable code.

Architecture should allow later modules, but do not build speculative complexity.

---

# 53. Future-ready module boundaries

The following must be easy to add later:

```text
SourceAdapter
├── Registro.br release
├── other registries
├── auctions
├── CSV
└── internal feeds

EnrichmentProvider
├── Semrush
├── Ahrefs
├── Majestic
├── DataForSEO
├── SecurityTrails
├── VirusTotal
├── CT
└── web history

Decision Engine
├── Rules
├── Score Models
├── Segment-specific models
└── acquisition strategy
```

Do not add concrete vendor dependencies outside adapter packages.

---

# 54. Railway notes current at specification date

Specification date: **2026-09-02**.

Claude Code should verify current official documentation before using commands that may have changed.

Official Railway references consulted:

- Monorepos:  
  `https://docs.railway.com/deployments/monorepo`
- CLI:  
  `https://docs.railway.com/cli`
- CLI init:  
  `https://docs.railway.com/cli/init`
- CLI add:  
  `https://docs.railway.com/cli/add`
- CLI deploying:  
  `https://docs.railway.com/cli/deploying`
- Variables:  
  `https://docs.railway.com/variables`
- PostgreSQL:  
  `https://docs.railway.com/databases/postgresql`
- Private networking:  
  `https://docs.railway.com/networking/private-networking`
- Storage buckets:  
  `https://docs.railway.com/storage-buckets`
- Bucket CLI:  
  `https://docs.railway.com/cli/bucket`
- Cron jobs:  
  `https://docs.railway.com/cron-jobs`
- Health checks:  
  `https://docs.railway.com/deployments/healthchecks`
- Regions:  
  `https://docs.railway.com/deployments/regions`
- Config as Code:  
  `https://docs.railway.com/config-as-code/reference`
- Railway Claude Code plugin:  
  `https://docs.railway.com/ai/claude-code-plugin`

Railway currently documents a Claude Code plugin installable through:

```text
/plugin install railway@claude-plugins-official
```

Use it if available and useful, but do not make the plugin a blocker when Railway CLI is available.

Official external references:

- Registro.br release process:  
  `https://registro.br/dominio/processo-de-liberacao`
- Registro.br release list:  
  `https://registro.br/dominio/lista-processo-liberacao.txt`
- Semrush API restrictions:  
  `https://developer.semrush.com/api/v4/introduction/api-usage-restrictions/`

Always prefer official API/documentation over scraping third-party documentation.

---

# 55. Final Claude Code instruction

Start by inspecting the repository.

Then execute the milestones in order.

Do not merely tell the operator how to implement Dominio-X: **implement it**.

Do not merely tell the operator how to deploy to Railway: **provision and deploy it** once authentication is available.

When a paid provider credential is missing, finish every part of the platform that does not depend on that credential and leave the provider correctly shown as `Not configured`.

When the Railway deployment is healthy, provide a concise final report with URLs and infrastructure status.

The final product must be a working internal Dominio-X MVP whose architecture can grow without being tied to Registro.br, Semrush or any other single provider.
