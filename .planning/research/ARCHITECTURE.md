# Architecture Research

**Domain:** Outbound CRM sync integration (Xphere) inside an existing Next.js 16 App Router + Supabase multi-tenant SaaS
**Researched:** 2026-06-20
**Confidence:** HIGH (codebase verified directly; QStash SDK API verified against the official `@upstash/qstash` README)

This document defines how to wire the **Xphere CRM Sync** feature into XmartMenu's existing architecture. It assumes the decisions already locked in the milestone context (QStash transport, shared `POST /api/v1/sync` Xphere endpoint, Account+Contact+Opportunity model keyed by `external_id = tenants.id`, env-var credentials, `source='xmartmenu'`, new `tenants.xphere_*` columns). It does NOT re-litigate those.

---

## Standard Architecture

### System Overview

The integration is a **producer → durable queue → consumer (worker) → external API → write-back** pipeline. Lifecycle events in existing routes publish a small job; QStash delivers it (with retries) to an internal worker route; the worker reads canonical state via the service-role client, maps it to the Xphere contract, POSTs, and writes the returned IDs back onto the tenant row.

```
┌──────────────────────────────────────────────────────────────────────┐
│                       EVENT-PUBLISH PATH (producers)                  │
│  ┌───────────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
│  │ /api/onboarding│  │ /api/stripe/webhooks│  │ /api/stripe/connect/ │  │
│  │  (tenant create)│  │ (plan/sub lifecycle)│  │   callback           │  │
│  └───────┬────────┘  └─────────┬──────────┘  └──────────┬───────────┘  │
│          │  enqueueXphereSync(tenantId, reason)  (fire-and-forget)     │
│          └───────────────┬───────────────────────────────┘            │
├──────────────────────────┼────────────────────────────────────────────┤
│                          ▼   src/lib/xphere/queue.ts                   │
│              ┌───────────────────────────────────┐                    │
│              │  Upstash QStash  (durable queue,   │                    │
│              │  HMAC-signed delivery, retries)    │                    │
│              └───────────────┬───────────────────┘                    │
├──────────────────────────────┼────────────────────────────────────────┤
│                              ▼   WORKER (consumer)                     │
│        POST /api/internal/xphere-sync                                  │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ 1. Receiver.verify(signature, rawBody)  → 401 if bad          │    │
│   │ 2. createServiceClient(): load tenant + profile + subscription│    │
│   │ 3. buildXpherePayload(...)  (mapping.ts, pure fn)             │    │
│   │ 4. xphereClient.sync(payload)  (client.ts → POST /api/v1/sync)│    │
│   │ 5. write-back xphere_*_id / xphere_synced_at / xphere_sync_error│  │
│   └──────────────────────────────────────────────────────────────┘    │
├──────────────────────────────┬────────────────────────────────────────┤
│           external            ▼            data store                  │
│   ┌───────────────────────┐      ┌─────────────────────────────────┐  │
│   │ Xphere POST /api/v1/sync│     │ Supabase: tenants (xphere_* cols)│  │
│   │ (built by Xtimator)     │     │ profiles, tenant_subscriptions   │  │
│   └───────────────────────┘      └─────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

         SUPERADMIN BACKFILL: POST /api/superadmin/xphere/backfill
         → loops tenants → enqueueXphereSync(id) for each (re-uses producer)
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `enqueueXphereSync()` (queue.ts) | Single choke-point producer. Publishes `{ tenantId, reason }` to QStash. Never throws into the caller. | `new Client({ token }).publishJSON({ url, body, retries })` wrapped in try/catch → returns void |
| QStash | Durable transport + retry/backoff. Decouples request latency from Xphere availability. | Upstash QStash (managed). Signs delivery with HMAC. |
| Worker route `/api/internal/xphere-sync` | Verify signature, load canonical state, map, POST, write back. Idempotent & retry-safe. | App Router `route.ts`, `runtime = 'nodejs'`, reads raw body |
| `xphere/client.ts` | HTTP client for `POST /api/v1/sync`. Owns auth headers, base URL, timeout, error shaping. | `fetch` wrapper; reads `XPHERE_API_URL/KEY/ORG_ID` |
| `xphere/mapping.ts` | Pure function: tenant+profile+subscription → Xphere sync payload (Account/Contact/Opportunity, `external_id`, `source`). | Pure, no I/O — unit-testable in isolation |
| `xphere/types.ts` | Contract types for request/response of `/api/v1/sync` + internal `SyncReason`. | TypeScript interfaces mirroring the documented Xphere contract |
| Producer hooks | Call `enqueueXphereSync()` at the right lifecycle moments. | Edits to onboarding, stripe webhooks, connect callback |
| Backfill route | Superadmin-triggered fan-out over existing tenants. | `assertSuperadmin()` + paginated enqueue loop |
| `tenants.xphere_*` columns | Persisted CRM linkage + last sync status/error. | Migration `054_xphere_sync_columns.sql` |

---

## Recommended Project Structure

NEW vs MODIFIED is explicit so the roadmapper can derive phases.

```
src/
├── lib/
│   └── xphere/                       # NEW — all integration logic, no route concerns
│       ├── types.ts                  # NEW — Xphere contract + SyncReason + payload types
│       ├── client.ts                 # NEW — POST /api/v1/sync HTTP client (auth, timeout)
│       ├── mapping.ts                # NEW — pure: tenant+profile+sub → payload
│       └── queue.ts                  # NEW — enqueueXphereSync() producer (QStash publish)
├── app/
│   └── api/
│       ├── internal/
│       │   └── xphere-sync/
│       │       └── route.ts          # NEW — QStash worker (verify→load→map→POST→write-back)
│       ├── superadmin/
│       │   └── xphere/
│       │       └── backfill/
│       │           └── route.ts      # NEW — superadmin fan-out over existing tenants
│       ├── onboarding/route.ts       # MODIFIED — enqueue after tenant fully created
│       └── stripe/
│           ├── webhooks/route.ts     # MODIFIED — enqueue in plan/sub event branches
│           └── connect/callback/route.ts  # MODIFIED — enqueue after stripe_connections upsert
├── types/
│   └── database.ts                   # MODIFIED — add xphere_* fields to interface Tenant
supabase/
└── migrations/
    └── 054_xphere_sync_columns.sql   # NEW — ALTER tenants ADD xphere_* columns
.env.example                          # MODIFIED — document XPHERE_* + QSTASH_* vars
package.json                          # MODIFIED — add @upstash/qstash dependency
```

### Structure Rationale

- **`src/lib/xphere/` (one module, four files):** Mirrors the repo's existing `src/lib/{domain}/` convention (`supabase/`, `auth/`, `marketing/`, `storage/`). Keeps all Xphere knowledge — contract, mapping, HTTP, queueing — in one place so the worker route and the producers stay thin. `mapping.ts` is pure so it can be unit-tested against the documented contract with zero network or DB.
- **`queue.ts` separate from `client.ts`:** The producer (publish to QStash) and the consumer's HTTP client (call Xphere) are different concerns invoked from different runtimes. Splitting them means a producer import never pulls in Xphere HTTP code and vice-versa, and keeps each independently testable.
- **`/api/internal/xphere-sync`:** New `internal/` segment signals "not user-facing, authenticated by signature not by cookie/session." Parallel to how `/api/stripe/webhooks` is machine-to-machine. Keeps it out of `admin/`, `superadmin/`, and `public/` which all carry cookie-auth semantics.
- **Backfill under `/api/superadmin/xphere/`:** Reuses the existing `assertSuperadmin()` guard and the established `api/superadmin/*` namespace — no new auth pattern.
- **Migration `054_`:** Next sequential number after the highest existing (`053_…`; note two duplicate `051_`/`052_` numbers already exist in the tree, so `054` is unambiguous).

---

## Architectural Patterns

### Pattern 1: Fire-and-forget producer via a single choke-point

**What:** Every lifecycle hook calls one function, `enqueueXphereSync(tenantId, reason)`, which publishes to QStash and **swallows its own errors**. The CRM sync must never fail onboarding, a Stripe webhook ack, or the Connect callback redirect.

**When to use:** Any time a request's primary job (create tenant, ack webhook) must not be coupled to a best-effort side effect against a flaky/unbuilt external system.

**Trade-offs:** (+) Primary flows stay fast and resilient; QStash gives durability so "fire-and-forget" doesn't mean "lose the event." (−) A publish failure (e.g. QStash down) is silently dropped for that one event — mitigated by logging to Sentry inside the catch, and by the superadmin backfill as a recovery path.

**Example:**
```typescript
// src/lib/xphere/queue.ts
import { Client } from '@upstash/qstash'
import { captureSecurityEvent } from '@/lib/observability'
import type { SyncReason } from './types'

const hasQstash = !!process.env.QSTASH_TOKEN
const qstash = hasQstash ? new Client({ token: process.env.QSTASH_TOKEN! }) : null

function workerUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || ''
  return `${base}/api/internal/xphere-sync`
}

/** Best-effort. NEVER throws — callers must not be coupled to CRM sync. */
export async function enqueueXphereSync(tenantId: string, reason: SyncReason): Promise<void> {
  if (!qstash) return // FAIL-OPEN like rate-limit.ts: no QSTASH_TOKEN ⇒ no-op
  try {
    await qstash.publishJSON({
      url: workerUrl(),
      body: { tenantId, reason },
      retries: 3,                              // QStash retries the WORKER on non-2xx
      deduplicationId: `${tenantId}:${reason}`, // optional: collapse rapid dupes
    })
  } catch (err) {
    // Log, do not rethrow. Backfill is the recovery path.
    captureSecurityEvent('xphere: enqueue failed', {
      tenantId, reason, message: err instanceof Error ? err.message : String(err),
    })
  }
}
```
This intentionally copies the **FAIL-OPEN pattern** already proven in `src/lib/rate-limit.ts` (no env ⇒ no-op, never block the app) so the team works with a familiar shape and the feature can ship before QStash credentials are live.

### Pattern 2: Signed worker that re-reads canonical state (thin payload, fat read)

**What:** The QStash message carries only `{ tenantId, reason }` — NOT a full snapshot. The worker re-loads tenant + profile + subscription fresh via the service-role client at execution time, then maps and POSTs. This mirrors the repo's existing **"follow-up query after Realtime INSERT"** decision (the event tells you *what changed*, you re-fetch the truth).

**When to use:** Whenever the queue delivery can be delayed or retried — a thin pointer + fresh read guarantees you sync the *current* state, never a stale snapshot, and makes retries naturally idempotent.

**Trade-offs:** (+) Idempotent and stale-proof; small messages. (−) One extra DB read per job (negligible at this scale).

**Example:**
```typescript
// src/app/api/internal/xphere-sync/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import { createServiceClient } from '@/lib/supabase/server'
import { buildXpherePayload } from '@/lib/xphere/mapping'
import { syncToXphere } from '@/lib/xphere/client'
import { captureSecurityEvent } from '@/lib/observability'

export const runtime = 'nodejs' // needs service-role key + raw body

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
})

export async function POST(req: NextRequest) {
  // 1. Verify QStash signature against the RAW body (like Stripe's constructEvent)
  const rawBody = await req.text()
  const signature = req.headers.get('upstash-signature') ?? ''
  const valid = await receiver.verify({ signature, body: rawBody }).catch(() => false)
  if (!valid) {
    captureSecurityEvent('xphere worker: invalid QStash signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { tenantId, reason } = JSON.parse(rawBody) as { tenantId: string; reason: string }
  const supabase = createServiceClient()

  // 2. Load canonical state fresh (service role bypasses RLS, like the webhook)
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug, xphere_account_id, xphere_contact_id, xphere_opportunity_id')
    .eq('id', tenantId).single()
  if (!tenant) return NextResponse.json({ ok: true, skipped: 'no tenant' }) // 200: don't retry forever

  const { data: profile } = await supabase
    .from('profiles').select('full_name, phone').eq('tenant_id', tenantId)
    .eq('role', 'store-admin').limit(1).maybeSingle()
  const { data: subscription } = await supabase
    .from('tenant_subscriptions').select('status, plan_id, billing_cycle, current_period_end')
    .eq('tenant_id', tenantId).maybeSingle()

  // 3. Map → 4. POST
  try {
    const payload = buildXpherePayload({ tenant, profile, subscription, reason })
    const result = await syncToXphere(payload) // throws on non-2xx

    // 5. Write back the returned CRM IDs + clear error
    await supabase.from('tenants').update({
      xphere_account_id: result.accountId,
      xphere_contact_id: result.contactId,
      xphere_opportunity_id: result.opportunityId,
      xphere_synced_at: new Date().toISOString(),
      xphere_sync_error: null,
    }).eq('id', tenantId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Persist the error for observability, then 500 so QStash retries (bounded by `retries`).
    await supabase.from('tenants')
      .update({ xphere_sync_error: message.slice(0, 500) }).eq('id', tenantId)
    captureSecurityEvent('xphere worker: sync failed', { tenantId, reason, message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
```
Note the **error contract that drives retries**: return 500 on a transient/Xphere failure so QStash retries (matching the Stripe webhook's "return 500 so it's reprocessed" idiom), but return **200 with `skipped`** for permanent no-ops (tenant deleted) so QStash stops.

### Pattern 3: Decouple from the unbuilt endpoint via a typed contract + pure mapping

**What:** The Xphere `/api/v1/sync` endpoint is being built separately (Xtimator effort) and may not exist when this code is written. `types.ts` encodes the **documented contract** as TypeScript types; `mapping.ts` is a pure function producing that type; `client.ts` is the only place that touches the network. Build and unit-test mapping against the contract now; defer the live integration test until the endpoint exists behind an env-presence gate.

**When to use:** Whenever you must build a producer against a consumer that doesn't exist yet — depend on the *interface*, not the *implementation*.

**Trade-offs:** (+) Work proceeds in parallel; the mapping (the part most likely to have bugs) is fully testable offline. (−) Contract drift risk — if the real endpoint differs from the documented contract, `client.ts` + `types.ts` absorb the change in one place; mapping/worker stay untouched.

**Example:**
```typescript
// src/lib/xphere/client.ts
import type { XphereSyncPayload, XphereSyncResponse } from './types'

const isConfigured = () =>
  !!(process.env.XPHERE_API_URL && process.env.XPHERE_API_KEY && process.env.XPHERE_ORG_ID)

export async function syncToXphere(payload: XphereSyncPayload): Promise<XphereSyncResponse> {
  if (!isConfigured()) throw new Error('xphere: not configured (XPHERE_API_URL/KEY/ORG_ID)')
  const res = await fetch(`${process.env.XPHERE_API_URL}/api/v1/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.XPHERE_API_KEY}`,
      'X-Org-Id': process.env.XPHERE_ORG_ID!,
    },
    body: JSON.stringify({ ...payload, source: 'xmartmenu' }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`xphere sync ${res.status}: ${await res.text().catch(() => '')}`)
  return (await res.json()) as XphereSyncResponse
}
```
Until the endpoint is live, `XPHERE_*` env vars stay unset in production → `client.ts` throws "not configured" → the worker records `xphere_sync_error` and QStash exhausts its retries. The queue, producers, mapping, and write-back are all exercisable end-to-end *without* the real Xphere by pointing `XPHERE_API_URL` at a local stub. **Gate live calls on the presence of the env vars** (same shape as `hasUpstash` in rate-limit.ts) so the integration "activates" the moment credentials land — zero code change.

---

## Data Flow

### Request Flow (event → CRM, the happy path)

```
[tenant lifecycle event: onboarding / plan activated / past_due / churn / connect]
    ↓ enqueueXphereSync(tenantId, reason)   — fire-and-forget, never blocks
[QStash durable queue]  ──(HMAC-signed POST, retriable)──▶
[POST /api/internal/xphere-sync]
    ↓ Receiver.verify(signature, rawBody)         (reject → 401)
    ↓ createServiceClient() → load tenant+profile+subscription   (fresh read)
    ↓ buildXpherePayload(...)                      (pure mapping)
    ↓ syncToXphere(payload) → POST /api/v1/sync    (Xphere, external)
    ↓ returns { accountId, contactId, opportunityId }
[UPDATE tenants SET xphere_*_id, xphere_synced_at, xphere_sync_error=null]
    ↓ 200 OK  → QStash marks delivered
```

On Xphere/transient failure: worker writes `xphere_sync_error`, returns 500, QStash retries up to `retries`; after exhaustion the error persists on the tenant row for the superadmin to see and re-trigger.

### Producer hook placements (the integration points)

| Producer file (MODIFIED) | Insertion point | `reason` |
|--------------------------|-----------------|----------|
| `api/onboarding/route.ts` | After step 6 (product created) succeeds, just before the success `NextResponse.json` — tenant + settings + subscription all exist | `'onboarding'` |
| `api/stripe/webhooks/route.ts` → `checkout.session.completed` (kind === 'plan') | After the `tenant_subscriptions` update succeeds | `'plan_activated'` |
| `api/stripe/webhooks/route.ts` → `customer.subscription.updated` / `.deleted` (kind === 'plan') | After the status mirror update; covers active / past_due / cancelled (churn) | `'subscription_updated'` |
| `api/stripe/webhooks/route.ts` → `invoice.payment_failed` | After marking `past_due` | `'past_due'` |
| `api/stripe/connect/callback/route.ts` | After the `stripe_connections` upsert succeeds, before the redirect | `'connect'` |

In the webhook, place each `enqueueXphereSync(...)` **inside the existing branch, after the DB write succeeds**, awaited but error-swallowed by `queue.ts` itself, so it cannot affect `updateResult` or the idempotency record. Do NOT enqueue before recording the idempotency row — enqueue is best-effort and must not change the webhook's 200/500 contract.

### Key Data Flows

1. **Linkage establishment (first sync):** `xphere_*_id` columns are NULL → worker sends a create-style payload with `external_id = tenants.id`; Xphere upserts by `external_id` and returns IDs → worker persists them. Subsequent syncs send the same `external_id`; Xphere updates the existing records (idempotent by design of the shared endpoint).
2. **Backfill:** Superadmin POSTs `/api/superadmin/xphere/backfill` → route pages through `tenants` (optionally `WHERE xphere_account_id IS NULL`) and calls `enqueueXphereSync(id, 'backfill')` for each → identical worker path. Reuses the producer; no special-case code in the worker.
3. **Observability read:** `xphere_sync_error IS NOT NULL` surfaces failed tenants in the superadmin tenant list/detail; re-trigger = enqueue again.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1k tenants | No changes. QStash free/low tier handles event volume; one job per lifecycle event is trivial. Backfill loops synchronously. |
| 1k–100k tenants | Backfill must paginate (e.g. 500/page) and enqueue in batches to avoid a long-running superadmin request; consider `publishJSON` batching. Worker stays single-tenant per message (good — bounded work, clean retries). |
| 100k+ tenants | Add a QStash URL-group / flow-control to cap concurrency against Xphere's rate limits; debounce rapid repeated events per tenant via `deduplicationId`/short delay so subscription churn bursts don't hammer the CRM. |

### Scaling Priorities

1. **First bottleneck — Xphere rate limits during backfill.** A full re-sync enqueues N jobs near-simultaneously. Fix: enqueue with a small staggered `delay`, or use QStash flow-control/parallelism caps. The thin-message + fresh-read design means stale ordering is harmless.
2. **Second bottleneck — duplicate events per tenant.** Stripe can emit several subscription events in seconds. Fix: `deduplicationId = ${tenantId}:${reason}` (already shown) collapses rapid duplicates; the worker is idempotent regardless.

---

## Anti-Patterns

### Anti-Pattern 1: Calling Xphere synchronously inside the lifecycle request

**What people do:** `await fetch(xphereUrl)` directly inside `/api/onboarding` or the Stripe webhook handler.
**Why it's wrong:** Couples onboarding/webhook latency and success to a flaky, possibly-not-yet-built external API. A slow or down Xphere would slow onboarding or cause Stripe to see a 500 and retry the *whole* webhook. It also has no durable retry.
**Do this instead:** `enqueueXphereSync()` (fire-and-forget) → QStash → worker. The request returns immediately; QStash owns retries.

### Anti-Pattern 2: Putting a full state snapshot in the queue message

**What people do:** Serialize the entire tenant+subscription into the QStash body.
**Why it's wrong:** Delivery can be delayed/retried; a snapshot goes stale and you sync outdated data. Bigger messages, contract coupling in the producer.
**Do this instead:** Send `{ tenantId, reason }`; the worker re-reads canonical state at execution time (Pattern 2). Matches the repo's existing Realtime "re-fetch on event" decision.

### Anti-Pattern 3: Letting an enqueue failure break the caller

**What people do:** `await enqueueXphereSync(...)` that can throw, inside the webhook's success path.
**Why it's wrong:** A QStash hiccup would flip a successful webhook to 500 → Stripe retries → duplicate processing risk; or aborts onboarding.
**Do this instead:** `queue.ts` swallows its own errors and logs to Sentry (FAIL-OPEN, like `rate-limit.ts`). The backfill route is the recovery mechanism for dropped enqueues.

### Anti-Pattern 4: Skipping signature verification on the worker route

**What people do:** Treat `/api/internal/xphere-sync` as trusted because it "looks internal."
**Why it's wrong:** It's a public HTTP endpoint; anyone could POST `{ tenantId }` and trigger CRM writes / enumerate tenants.
**Do this instead:** `Receiver.verify({ signature, body })` against the raw body before any work — the exact discipline already used for Stripe's `constructEvent`. Reject with 401.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Upstash QStash | `Client.publishJSON({ url, body, retries })` to enqueue; `Receiver.verify()` to authenticate delivery on the worker. | NEW dependency `@upstash/qstash`. Env: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`. Upstash account already in use for Redis. FAIL-OPEN if `QSTASH_TOKEN` unset. |
| Xphere CRM `POST /api/v1/sync` | `fetch` from `client.ts` with `Authorization: Bearer XPHERE_API_KEY`, `X-Org-Id`, body `{ ...payload, source: 'xmartmenu', external_id: tenantId }`. | Built by separate Xtimator effort — DO NOT modify. Depend on the documented contract via `types.ts`. Gate live calls on `XPHERE_*` env presence. Org `e375f031-…`. |
| Supabase (service role) | `createServiceClient()` in the worker + backfill to read/write bypassing RLS. | Reuses existing factory. Same trust model as the Stripe webhook. |
| Sentry | `captureSecurityEvent()` for enqueue failures, bad signatures, sync failures. | Reuses `src/lib/observability.ts`; no-ops without a DSN. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Producers ↔ `queue.ts` | Direct function call `enqueueXphereSync(tenantId, reason)` | Single choke-point; producers never import the Xphere HTTP client. |
| `queue.ts` ↔ worker | Async via QStash (HTTP, signed) | Only coupling is the `{ tenantId, reason }` body shape (define in `types.ts`). |
| Worker ↔ `mapping.ts` | Pure function call | No I/O in mapping → unit-testable against the contract offline. |
| Worker ↔ `client.ts` | Function call → `fetch` | Only place that network-touches Xphere; absorbs contract drift. |
| Worker ↔ Supabase | `createServiceClient()` read + write-back | `tenants.xphere_*` is the persisted linkage + status surface. |

### Suggested Build Order (dependency-respecting → phases for the roadmapper)

1. **Migration** — `054_xphere_sync_columns.sql`: `ALTER TABLE tenants ADD COLUMN xphere_account_id text, xphere_contact_id text, xphere_opportunity_id text, xphere_synced_at timestamptz, xphere_sync_error text;` + update `interface Tenant` in `types/database.ts`. (No dependencies; everything below reads/writes these columns.)
2. **Lib module** — `src/lib/xphere/types.ts` → `mapping.ts` (pure, unit-tested against the documented contract) → `client.ts` (env-gated `fetch`) → `queue.ts` (QStash producer, FAIL-OPEN). Add `@upstash/qstash` to `package.json`. (Depends on migration types; independently testable, no live Xphere.)
3. **Worker** — `/api/internal/xphere-sync/route.ts`: signature verify → load → map → POST → write-back. (Depends on lib + migration. Testable end-to-end against a local Xphere stub.)
4. **Hooks** — wire `enqueueXphereSync()` into onboarding, the three Stripe webhook branches, and the Connect callback. (Depends on `queue.ts` + worker existing so enqueued jobs land somewhere.)
5. **Backfill** — `/api/superadmin/xphere/backfill/route.ts`: `assertSuperadmin()` + paginated enqueue loop. (Depends on producer + worker.)
6. **Observability** — surface `xphere_sync_error` / `xphere_synced_at` in the superadmin tenant UI; Sentry alerts already wired via `captureSecurityEvent`. (Depends on data being written by the worker.)

**Decoupling from the unbuilt endpoint:** Steps 1–5 ship and are fully exercisable with `XPHERE_*` unset (client throws "not configured" → error recorded) or pointed at a local stub; unit tests cover `mapping.ts` against the documented contract. The **live integration test** (deferrable, after step 6) only runs once Xtimator ships `/api/v1/sync` and real `XPHERE_*` credentials are set — at which point the env-presence gate activates real calls with zero code change.

---

## Sources

- XmartMenu codebase (verified directly): `src/app/api/stripe/webhooks/route.ts`, `src/app/api/onboarding/route.ts`, `src/app/api/stripe/connect/callback/route.ts`, `src/lib/rate-limit.ts`, `src/lib/supabase/server.ts`, `src/lib/observability.ts`, `src/lib/superadmin-auth.ts`, `src/types/database.ts`, `supabase/migrations/*` — HIGH confidence
- `@upstash/qstash` SDK README (`Client.publishJSON`, `Receiver.verify`, env vars) — HIGH confidence
- `.planning/PROJECT.md` milestone v2.4 constraints + locked decisions — HIGH confidence

---
*Architecture research for: Xphere CRM Sync integration (XmartMenu v2.4)*
*Researched: 2026-06-20*
