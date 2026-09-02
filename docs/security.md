# Security

## Authentication & sessions

- Argon2id password hashing (`@node-rs/argon2`, m=19456 KiB, t=2, p=1); timing-equalized login.
- Opaque 256-bit session tokens; only their SHA-256 is stored (`sessions` table, sliding `last_seen_at`).
- Cookie `dx_session`: `HttpOnly`, `SameSite=Lax`, `Secure` in production, expiry = `SESSION_TTL_HOURS`.
- Roles `admin > analyst > viewer` enforced per route (`requireRole`).
- Login rate limit (`LOGIN_RATE_LIMIT_MAX` per `LOGIN_RATE_LIMIT_WINDOW_MS`, Redis-backed) plus a global
  600 req/min/IP limit. Auth events (`auth.login`, `auth.login_failed`, `auth.logout`) are audited.

## CSRF

State-changing requests authenticated by cookie must carry an `Origin` (or `Referer`) header whose
origin is in the allow-list (`APP_URL`, `API_URL`, `CORS_ALLOWED_ORIGINS`). Combined with
`SameSite=Lax` this blocks cross-site form posts and cross-origin fetches. Machine-token routes are
not cookie-authenticated and are exempt.

## Machine API (crawler)

`/v1/internal/crawler/*` requires `x-machine-token` equal to `CRAWLER_MACHINE_TOKEN` (≥ 32 random
bytes), compared in constant time on SHA-256 digests; dedicated rate limit; no user session accepted.
Jobs are leased (`claim` → `heartbeat` → `complete|fail`, reclaim after lease expiry).

## SSRF / crawler policy (`apps/crawler/src/security`)

Before every connection (and again on every redirect): parse URL → only `http:`/`https:` → reject
embedded credentials → allow ports 80/443 only → reject `localhost`, `.local`, `.internal` → resolve
DNS → every answer must be globally routable unicast (loopback, private, link-local incl.
`169.254.169.254`, CGNAT, multicast, unspecified, documentation/benchmark, reserved, IPv6
unique-local/link-local, IPv4-mapped/embedded forms and known cloud metadata endpoints are blocked)
→ pin the socket to the validated address (undici `connect.lookup`) → cap redirects (5), body (2 MB),
decompressed body (4 MB), connect (5 s) and total time (12 s). GET/HEAD only. No JavaScript execution,
no Playwright, no binary execution. Test matrix: `apps/crawler/src/security/ssrf.test.ts`.

The crawler service holds only `CRAWLER_CORE_API_URL`, `CRAWLER_MACHINE_TOKEN`, crawler limits,
`LOG_LEVEL` and optionally `SENTRY_DSN`.

## Other controls

- Zod validation on every body/query/param; consistent error contract without stack traces.
- Helmet security headers, CORS allow-list with credentials, request body limit (`BODY_LIMIT_BYTES`).
- Parameterized queries only (Drizzle); no user-controlled SQL, shell, or dynamic imports.
- Rule DSL: no `eval`, RE2 regexes (no catastrophic backtracking), depth/size limits.
- Secrets redacted from logs (`REDACT_PATHS`), never returned by `/v1/providers`.
- CSV export escapes formula-leading cells (`= + - @ \t \r`); import has size and row caps.
- Object keys validated against traversal; artifacts private; presigned URLs expire in 5 minutes.
- Server-side pagination with a hard cap of 200 rows per page.
- Audit log for logins, activations, shortlist/provider/settings changes, manual decisions.
