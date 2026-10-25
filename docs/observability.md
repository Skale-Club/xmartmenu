# Observability

One **request id** ties everything together. The middleware gives every request
an id (or keeps the one from the proxy) and returns it in the `x-request-id`
response header. The same id shows up in:

- **logs**: the `request_id` field on every line of that request;
- **Sentry**: the `request_id` tag;
- **audit trail**: the `request_id` column of each change the request made;
- **API error bodies**: `{"error": "...", "request_id": "..."}`.

So a user report ("it failed at 14:32") → the response's `x-request-id` (browser
devtools, or the error body) → the logs, the Sentry event and the database
changes of that exact request.

## Logs

Code: `src/lib/observability/log.ts`. Each line is one JSON object on
stdout/stderr, which Coolify collects:

```json
{"ts":"2026-10-25T20:52:31.825Z","level":"info","event":"http.request","request_id":"723da9df-…","route":"GET /api/health/ready","tenant_id":"…","actor_id":"…","method":"GET","status":200,"duration_ms":882}
```

- API routes wrapped with `withApi('POST /api/orders', handler)` log one
  `http.request` line per call, with status and duration. All admin,
  superadmin, order, payment, chat and analytics routes are wrapped. An
  unexpected throw is logged as `http.unhandled_error`, sent to Sentry and
  answered as a 500 that includes the `request_id`.
- `log.info|warn|error('event.name', { ...fields, err })` adds the current
  request, restaurant and user on its own.
- Secret-looking fields (key, token, password, secret, cookie, authorization)
  are redacted. Use `maskPhoneForLog()` for phone numbers.
- `LOG_LEVEL=debug|info|warn|error` (default `info`).

**Searching in Coolify:** open the app → Logs, and search for a `request_id`, an
`event` (`orders.create_error`) or a `tenant_id`.

## Sentry

Installed but **off until a DSN is set**. To turn it on:

1. Create a Next.js project at sentry.io.
2. **Coolify (runtime env):** `SENTRY_DSN`. Optional:
   `SENTRY_ENVIRONMENT=production` and `SENTRY_TRACES_SAMPLE_RATE` (default 0.1).
3. **GitHub → Settings → Variables:** `NEXT_PUBLIC_SENTRY_DSN` (the same DSN,
   baked into the browser bundle), plus `SENTRY_ORG` and `SENTRY_PROJECT`.
4. **GitHub → Secrets:** `SENTRY_AUTH_TOKEN`, so source maps are uploaded and
   stack traces point at the real code.

What it records:

- **Release:** every event carries the git sha of the deploy (`GIT_SHA` →
  `NEXT_PUBLIC_RELEASE`).
- **Tags:** `request_id`, `route`, `tenant_id`, `role`, plus the user id.
- **Scrubbing** before sending (`sentry-scrub.ts`): cookies, auth headers and
  keys are removed, phones and e-mails are masked, and only the user id is kept.

## Audit trail

Migration `20261025180000_audit_trail.sql`. Triggers record every
insert/update/delete on restaurants, settings, subscriptions, plans, users,
menus, categories, dishes, options, media, ingredients, tables, locations,
delivery zones, chat and Stripe settings, and QR codes. For orders, only
status changes are recorded.

Each change records:

- **who** (`actor_id`);
- **from where** (`via`):
  - `browser`: the admin's own token;
  - `server`: an API route, with the user taken from the `x-actor-id` header
    our server sends;
  - `sql`: migrations or the dashboard;
- **what changed**: `{"price": [20, 24]}`, with secrets redacted;
- **the request id**.

Where to see it:

- **Superadmin → Audit trail** (`/audit`): filter by restaurant, kind of
  change, person, period or request id.
- **Owners** can read their own restaurant's history via RLS (no screen yet).
  Staff can't read it.

Nobody can edit or delete it through the API.

Growth: one row per change. Prune old rows when needed:

```sql
DELETE FROM audit_events WHERE occurred_at < now() - interval '1 year';
```

## Health

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness: the process is up. Used by Docker/Coolify. No dependencies. |
| `GET /api/health/ready` | Readiness: database reachable, latency, release, uptime. 200 `ok`/`degraded`, 503 `down`. |

Send `Authorization: Bearer $HEALTH_TOKEN` to `/ready` to also see which
integrations are configured (Sentry, OpenRouter, Stripe, rate-limit store,
storage). It shows booleans only, never values. Set `HEALTH_TOKEN` in Coolify.

**Uptime monitor:** `.github/workflows/uptime.yml` calls `/ready` every 15
minutes and fails (GitHub e-mails you) when production is down. Optional
settings:

- variable `APP_URL`;
- secret `HEALTH_TOKEN`.
