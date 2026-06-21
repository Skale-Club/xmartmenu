# Stack Research — v2.4 Xphere CRM Sync (NEW Capabilities Only)

**Domain:** Outbound CRM sync via durable message queue (Next.js 16 App Router → Upstash QStash → external REST `POST /api/v1/sync`)
**Researched:** 2026-06-20
**Confidence:** HIGH (versions verified from npm registry; QStash APIs verified from official Upstash docs + SDK README as of 2026-06-20)

> Scope note: This covers ONLY what is **new** for the Xphere CRM Sync milestone (v2.4). The existing Next.js 16 / React 19 / Supabase / Stripe / Tailwind / Upstash Redis stack is already documented in `.planning/codebase/STACK.md` and is NOT re-researched here. The transport (Upstash QStash) and the destination contract (`POST /api/v1/sync`, owned by a separate effort) are **decided** — this research scopes the SDK, env vars, verification flow, retry/DLQ config, HTTP-client considerations, and the public-URL deployment implication.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@upstash/qstash` | `2.11.1` (latest, published 2026-06-16) | TS SDK exposing **`Client`** (publish lifecycle events) and **`Receiver`** (verify QStash → worker callbacks) | Single official SDK for both publish + verify. Same vendor as the already-installed `@upstash/redis` / `@upstash/ratelimit`, so credentials, billing, and operational surface stay consolidated. HTTP-based (no persistent connection) — works cleanly in serverless and standalone-container Next.js. Verified current via npm + Upstash docs. |
| `zod` | `^4.4.3` (already installed) | Validate the QStash callback payload + the Xphere request/response shapes in `src/lib/xphere/` | Already a project dependency; reuse for runtime validation of the worker's inbound body and the typed Xphere contract. **No new install.** |
| Native `fetch` (Node 24 / undici) | built-in | Server-to-server call to `XPHERE_API_URL` from inside the worker route | Already the project's HTTP convention. `AbortSignal.timeout()` gives per-request timeouts with zero dependencies. **No HTTP-client library needed.** |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@sentry/nextjs` | `^10.55.0` (already installed) | Capture worker exceptions + surface `xphere_sync_error` to observability | Already wired into the app; reuse in the worker route's catch block. **No new install.** |
| `@upstash/redis` | `^1.38.0` (already installed) | (Optional) app-side idempotency ledger, mirroring the existing `processed_stripe_events` pattern but at the edge | Only if you want a fast dedup check beyond QStash's 10-min window. QStash dedup + a DB unique key on `external_id` are usually sufficient. **No new install.** |

> **Transitive deps pulled in by `@upstash/qstash@2.11.1`:** `jose@^5.x` (JWS signature verify), `crypto-js@>=4.2.0`, `neverthrow@^7.x`. All bundled by the SDK — nothing to install or configure manually. No native build step.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| QStash local dev server (optional) | Local publish/verify without hitting the cloud | `npx @upstash/qstash-cli dev` runs a local QStash and prints its own `QSTASH_URL` + signing keys; point `QSTASH_TOKEN` / `QSTASH_URL` at it for local E2E. Useful because the worker needs a public URL (see Deployment). |
| Upstash console | Inspect message log, DLQ, schedules, signing keys | Source of `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`. |

---

## Installation

```bash
# Core (the ONLY new runtime dependency for this milestone)
npm install @upstash/qstash

# zod, @sentry/nextjs, @upstash/redis are already in package.json — do NOT reinstall.
# No new dev dependencies required.
```

---

## Required Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `QSTASH_TOKEN` | `Client` (publisher side) | Auth token to publish messages. Read explicitly and passed to `new Client({ token })`. |
| `QSTASH_CURRENT_SIGNING_KEY` | `Receiver` (worker side) | Verifies the `Upstash-Signature` header on inbound deliveries. |
| `QSTASH_NEXT_SIGNING_KEY` | `Receiver` (worker side) | Second key so verification keeps working across Upstash key rotation. |
| `XPHERE_API_URL` | worker → Xphere | URL of the shared `POST /api/v1/sync` contract. |
| `XPHERE_API_KEY` | worker → Xphere | Key for the `sync:write` scope. Server-only. |
| `XPHERE_ORG_ID` | worker → Xphere | Target org (`e375f031-4d9a-42b1-9f3c-ade805650442`) included in the request. |
| `QSTASH_URL` | (optional, local only) | Override QStash base URL when using the local dev server. |

> All are **server-only** — never prefix with `NEXT_PUBLIC_`. Follow the existing fail-open/guard convention in `src/lib/rate-limit.ts`: gate publishing on `process.env.QSTASH_TOKEN` so the app degrades gracefully (skip-and-log) when QStash is not yet provisioned.

---

## How the Publish + Verify Flow Works (App Router)

### (a) Publish — lifecycle hook → QStash

Triggered from onboarding, the Stripe webhook handlers (`plan activated`, `subscription updated`, `past_due`, `churn`), the Connect callback, and the superadmin backfill route. The publisher does **not** call Xphere directly — it enqueues, so the lifecycle handler stays fast and non-blocking.

```ts
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

await qstash.publishJSON({
  // Public URL of the worker route (see Deployment section)
  url: `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/xphere-sync`,
  body: { tenantId, event: "subscription.updated", /* ... */ },
  retries: 5,                                               // Upstash-Retries header
  deduplicationId: `${tenantId}:${event}:${stripeEventId}`, // idempotency, 10-min window
  // failureCallback: `${APP_URL}/api/internal/xphere-sync/failed`, // optional DLQ alert
});
```

Key options confirmed in the current SDK:
- `retries` → sets the `Upstash-Retries` header (per-message override of the plan default).
- `deduplicationId` → QStash returns HTTP **202** + the existing message id on a duplicate within the **10-minute** dedup window. Use a deterministic key (`tenantId:event:stripeEventId`) so a Stripe webhook retry doesn't double-enqueue. `contentBasedDeduplication: true` is an alternative (hashes URL + body + forwarded headers).
- `delay` / `notBefore` available if a lifecycle event should sync later.
- `callback` / `failureCallback` → URLs QStash hits after success / after **all retries are exhausted** (failure payload includes the DLQ id). Wire `failureCallback` to a small route that writes `xphere_sync_error` for observability.
- `Upstash-Forward-*` prefixed headers are forwarded verbatim to the worker if you need to pass metadata.

### (b) Verify + deliver — QStash → worker route → Xphere

The worker lives at `POST /api/internal/xphere-sync`. QStash signs every delivery with the `Upstash-Signature` header (a JWS). Verification **must** run against the **raw request-body string** — do not `JSON.parse` then re-`stringify`, or the hash won't match and every delivery 401s.

```ts
import { Receiver } from "@upstash/qstash";

export const runtime = "nodejs"; // SDK uses jose/crypto-js — avoid Edge

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

export async function POST(req: Request) {
  const signature = req.headers.get("Upstash-Signature") ?? "";
  const body = await req.text();            // RAW string — required for verify()

  const isValid = await receiver.verify({
    signature,
    body,
    url: `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/xphere-sync`, // recommended
  });
  if (!isValid) return new Response("invalid signature", { status: 401 });

  const payload = JSON.parse(body);         // parse only AFTER verification
  // ... call Xphere (see HTTP client section) ...
  // return 2xx on success; non-2xx (or thrown error) → QStash retries
}
```

App Router specifics:
- Use the Web `Request`; read the signature from `req.headers.get("Upstash-Signature")` and the body via `req.text()`.
- Force the route to the Node.js runtime (`export const runtime = "nodejs"`).
- The route's **HTTP status code is the retry signal**: return `2xx` to ack; any non-2xx (or an uncaught throw) tells QStash to retry on its backoff schedule.

---

## Retry / DLQ Configuration (decided behaviour)

| Concern | Behaviour | How to control |
|---------|-----------|----------------|
| Default retries | Plan maximum (set lower per-message) | `retries` option / `Upstash-Retries` header |
| Backoff schedule | Exponential: `delay = min(86400, e^(2.5·n))` → ~12s, ~2m28s, ~30m, ~6h, then capped at 24h | Default; override per-message via `Upstash-Retry-Delay` |
| Endpoint-driven backoff | Worker may return `Retry-After` / `X-RateLimit-Reset` to control the next attempt | Respond with header from the route |
| Non-retryable failure | Send the message straight to DLQ: respond **HTTP 489** + header `Upstash-NonRetryable-Error: true` | Use when Xphere returns a permanent 4xx (e.g. validation) — don't waste retries |
| DLQ entry | After all retries exhausted, the message lands in the DLQ; `failureCallback` fires with the DLQ id | Inspect / requeue via Upstash console or the DLQ API |
| Attempt counter | QStash adds `Upstash-Retried` header with the current attempt number | Read in the worker for logging |
| Observability | On final failure, persist `xphere_sync_error` on the tenant row | Write from the `failureCallback` route and/or the worker catch block + Sentry |

**Recommendation:** Treat Xphere `5xx`/timeout as retryable (return non-2xx → let QStash retry). Treat Xphere `4xx` validation errors as terminal (return `489` + `Upstash-NonRetryable-Error: true`) so a bad payload doesn't churn the queue. Always record the error for the superadmin observability surface.

---

## HTTP Client Considerations (worker → Xphere REST)

Use native `fetch` (undici, built into Node 24) — no new library.

| Concern | Approach |
|---------|----------|
| Timeout | `fetch(url, { signal: AbortSignal.timeout(10_000) })`. Keep the worker's total time under QStash's plan **Max HTTP Response Duration**, otherwise QStash treats the delivery as failed and retries the whole message. |
| Idempotency to Xphere | Send a deterministic `Idempotency-Key` header (e.g. `${tenantId}:${event}:${stripeEventId}`) so an at-least-once QStash retry doesn't create duplicate Account/Contact/Opportunity rows. Layer this on top of QStash's own dedup; the destination is the safer place to enforce it. **Confirm the exact header name against the documented Xphere `/api/v1/sync` contract.** |
| Auth | `Authorization: Bearer ${XPHERE_API_KEY}` (or per the contract) + `XPHERE_ORG_ID` in header/body. |
| Source tagging | Include `source: "xmartmenu"` in the body per the milestone contract. |
| Error mapping | Xphere `2xx` → ack (return 2xx to QStash); `5xx` / network / timeout → retryable; `4xx` validation → terminal (489 + non-retryable header). |
| Response handling | Persist returned `xphere_account_id` / `xphere_contact_id` / `xphere_opportunity_id` + `xphere_synced_at` on the tenant row. |

---

## Deployment / Public Callback URL — IMPORTANT

QStash is a **cloud-hosted publisher that delivers by making an outbound HTTPS request to your worker URL**. Therefore the worker route **must be reachable from the public internet** — QStash cannot reach `localhost`, a private network, or an internal-only container port.

- **`.planning/codebase/STACK.md` and `PROJECT.md` say "Deployment: Vercel."** The current repo state contradicts this: there is a `Dockerfile`, a `docker-compose.yaml` for **Coolify** GHCR-pull deploy, and recent CI commits building a GHCR image — i.e. the app now appears to run as a **Next.js standalone container** behind Coolify (production domain `xmartmenu.skale.club`). **Flag for requirements: confirm the live deployment target before building.**
- **Implication for QStash:** The standalone container's public ingress (the Coolify-managed reverse proxy on `xmartmenu.skale.club`) must expose `POST /api/internal/xphere-sync` over HTTPS with **no auth wall in front of it** that would block QStash. Security is provided by **`Receiver` signature verification**, not by network restriction. Do **not** put the worker behind Basic Auth / IP allowlist / Vercel deployment protection that QStash can't satisfy.
- **Publish URL must be the public origin:** set `url` in `publishJSON` from a public base (`NEXT_PUBLIC_APP_URL` / production origin = `https://xmartmenu.skale.club`), never `http://localhost` in deployed environments.
- **Local dev:** since QStash can't reach a dev machine, use the **QStash local dev server** (`npx @upstash/qstash-cli dev`) or a tunnel (ngrok / cloudflared) and point `QSTASH_URL` at it. The Receiver still verifies with the dev server's signing keys.

> Whether the host is Vercel or a Coolify standalone container does **not** change the SDK code — only the requirement that the callback URL is publicly resolvable over HTTPS. Standalone-container deployment is fully compatible; it just makes the "public ingress + no blocking auth" requirement explicit.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@upstash/qstash` Client/Receiver | `@upstash/workflow` (durable multi-step orchestration on top of QStash) | If the sync grew into a long multi-step saga (create Account → wait → create Contact → wait → Opportunity) needing durable steps. Overkill for a single `POST /api/v1/sync` call — **do not add.** |
| Native `fetch` + `AbortSignal.timeout` | `ky` / `axios` / `got` | Only if you need rich retry/interceptor ergonomics on the Xphere call itself. Unnecessary — QStash already owns retries; the worker→Xphere call should be a single attempt and let QStash retry the whole delivery. |
| QStash `deduplicationId` + DB unique key | Custom Redis idempotency ledger (`@upstash/redis`) | If you need a longer idempotency window than QStash's 10 minutes and can't rely on a DB unique constraint on `external_id`. Mirrors the existing `processed_stripe_events` pattern. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Inngest** | Adds a second background-job vendor; milestone explicitly decided on QStash; the repo has no job queue and shouldn't grow one | `@upstash/qstash` |
| **BullMQ / a Redis-backed worker** | Requires a long-running worker process — incompatible with the serverless / standalone-container HTTP model; doubles infra | QStash HTTP delivery to a route handler |
| **Calling Xphere synchronously inside the Stripe webhook handler** | Blocks / risks the webhook timing out; Xphere downtime would break the Stripe ack flow; no retries | Publish to QStash, return fast, sync in the worker |
| **`crypto` / manual HMAC for signature checks** | QStash signatures are JWS-based; rolling your own is error-prone | `Receiver.verify()` from the SDK |
| **`JSON.parse` then `JSON.stringify` before `verify()`** | Re-serialization changes bytes → signature mismatch → all deliveries 401 | Pass the **raw** `await req.text()` string to `verify()` |
| **`NEXT_PUBLIC_` prefix on QStash / Xphere secrets** | Leaks tokens to the client bundle | Server-only env vars |
| **Edge runtime for the worker route** | SDK relies on `jose` / `crypto-js`; Node APIs are safest | `export const runtime = "nodejs"` |
| **`axios` / new HTTP client just for the Xphere call** | Native `fetch` covers timeouts (`AbortSignal.timeout`), headers, and JSON | Native `fetch` |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@upstash/qstash@2.11.1` | Next.js 16.2.x / React 19 | Pure server-side usage (Client in actions / route handlers, Receiver in route handler). No React/Next coupling. |
| `@upstash/qstash@2.11.1` | Node.js 24 (project runtime) | SDK ships ESM + CJS; transitive `jose@5`, `crypto-js@>=4.2.0`, `neverthrow@7` — all Node-compatible, no native build step. |
| `@upstash/qstash@2.11.1` | existing `@upstash/redis@1.38` / `@upstash/ratelimit@2.0.8` | Independent products; share the Upstash account but use a separate token (`QSTASH_TOKEN` vs `UPSTASH_REDIS_REST_TOKEN`). No conflict. |

---

## Sources

- npm registry `@upstash/qstash` — latest `2.11.1`, published 2026-06-16; deps `jose@^5.2.3`, `crypto-js@>=4.2.0`, `neverthrow@^7.0.1` — **HIGH** (direct registry query)
- https://upstash.com/docs/qstash/howto/signature — `Receiver` constructor (`currentSigningKey` / `nextSigningKey`), `verify({ signature, body, url })`, `Upstash-Signature` header, raw-body requirement — **HIGH**
- https://github.com/upstash/sdk-qstash-ts (README) — `Client({ token })`, `publishJSON({ url, body })`, `Receiver.verify()` — **HIGH**
- https://upstash.com/docs/qstash/features/retry — default/max retries, `Upstash-Retries`, exponential backoff formula + schedule, DLQ via HTTP 489 + `Upstash-NonRetryable-Error: true`, `Retry-After` support, `Upstash-Retried` header — **HIGH**
- https://upstash.com/docs/qstash/features/deduplication — `deduplicationId`, `contentBasedDeduplication`, 10-minute window, `Upstash-Forward-*` header forwarding — **HIGH**
- https://upstash.com/docs/qstash/features/callbacks — `callback` / `failureCallback` (fires after all retries exhausted, includes DLQ id) — **HIGH**
- Repo evidence (`Dockerfile`, `docker-compose.yaml` Coolify/GHCR, recent CI commits) vs `.planning/codebase/STACK.md` + `PROJECT.md` "Vercel" — deployment-target discrepancy flagged — **HIGH** (direct repo inspection)
- `package.json` (project) — confirms `@upstash/redis`, `@upstash/ratelimit`, `zod`, `@sentry/nextjs`, `stripe` already installed; `@upstash/qstash` absent — **HIGH**

---
*Stack research for: v2.4 Xphere CRM Sync — Outbound CRM sync via Upstash QStash (Next.js 16 App Router → QStash → Xphere REST)*
*Researched: 2026-06-20*
