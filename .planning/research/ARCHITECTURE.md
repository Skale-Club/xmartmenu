# Architecture Research

**Domain:** Outbound product→CRM lifecycle sync integrated into an existing Next.js 16 App Router + Supabase app (XmartMenu → Upstash QStash → shared external `POST /api/v1/sync`)
**Researched:** 2026-06-21
**Confidence:** HIGH (every integration point verified directly against repo source: `src/app/api/stripe/webhooks/route.ts`, `src/app/api/onboarding/route.ts`, `src/app/api/stripe/connect/callback/route.ts`, `src/lib/tenant-plan.ts`, `src/lib/superadmin-auth.ts`, `src/lib/rate-limit.ts`, `src/lib/observability.ts`, `src/types/database.ts`, `supabase/migrations/*`. Transport/destination decided in committed STACK.md/SUMMARY.md.)

> Scope: how the **new** QStash CRM sync wires into the **existing** architecture. The transport (QStash), destination contract (`POST /api/v1/sync`), idempotency key (`external_id = tenants.id`), and object model (Account + Contact + Opportunity) are already decided — this file specifies the exact files, edit points, worker design, module shape, migration, idempotency mechanics, payload mapping, backfill, and build order. It does not re-litigate the transport choice.

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│  PRODUCERS  (existing routes — MODIFIED, enqueue-only, fail-open)      │
├───────────────────────────────────────────────────────────────────────┤
│  onboarding   stripe/webhooks (3 branches)   stripe/connect/callback   │
│   route.ts          route.ts                       route.ts            │
│      │                  │                              │               │
│      └──────────────────┴──────────────────────────────┘               │
│                            │ enqueueXphereSync(tenantId, reason)        │
│                            │ (try/catch, returns void, NEVER throws)    │
├────────────────────────────┼──────────────────────────────────────────┤
│                  src/lib/xphere/queue.ts (NEW)                          │
│                  Client.publishJSON → Upstash QStash                    │
└────────────────────────────┼──────────────────────────────────────────┘
                             │ durable, at-least-once, signed delivery
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  WORKER  /api/internal/xphere-sync/route.ts (NEW, runtime=nodejs)      │
├───────────────────────────────────────────────────────────────────────┤
│  1. raw body = await req.text()                                        │
│  2. Receiver.verify(sig, rawBody, url)        → 401 if invalid         │
│  3. createServiceClient(): load tenant + profile + tenant_subscription │
│  4. getTenantPlan(tenantId) → EffectivePlan (applies overrides)        │
│  5. buildXpherePayload(...) (PURE, src/lib/xphere/mapping.ts)          │
│  6. syncToXphere(payload)  (src/lib/xphere/client.ts, native fetch)    │
│  7. write back xphere_*_id / xphere_synced_at, clear xphere_sync_error │
│     transient fail → 500 (QStash retries) | permanent → 489 + DLQ      │
└───────────────────────────────┬───────────────────────────────────────┘
                               │ POST source=xmartmenu, external_id=tenant.id
                               ▼
┌───────────────────────────────────────────────────────────────────────┐
│  EXTERNAL (NOT in this repo): Xphere POST /api/v1/sync                 │
│  upsert-by-external_id → Account + Contact + Opportunity               │
└───────────────────────────────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────────────┐
       │ BACKFILL /api/superadmin/xphere/backfill (NEW)        │
       │ assertSuperadmin() → paginate tenants →               │
       │ enqueueXphereSync(id,'backfill') per row (same path)  │
       └──────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation | New / Modified |
|-----------|----------------|----------------|----------------|
| `enqueueXphereSync()` | Single choke-point producer. Publish thin `{tenantId, reason}` to QStash, swallow all errors. | `src/lib/xphere/queue.ts` — `Client.publishJSON`, wrapped in try/catch, returns `void` | **NEW** |
| Worker route | Verify signature, fat-read live state, map, POST Xphere, write back, classify retry. | `src/app/api/internal/xphere-sync/route.ts` | **NEW** |
| `client.ts` | The only network-touching file. `fetch` to `XPHERE_API_URL` with auth + timeout. Env-presence gated. | `src/lib/xphere/client.ts` | **NEW** |
| `mapping.ts` | Pure function: tenant + profile + subscription + plan → Account/Contact/Opportunity payload. | `src/lib/xphere/mapping.ts` | **NEW** |
| `types.ts` | Typed `/api/v1/sync` request/response contract + `SyncReason` union + stage constants. | `src/lib/xphere/types.ts` | **NEW** |
| Producer hooks | Call `enqueueXphereSync` after each lifecycle DB write succeeds. | onboarding, webhooks, connect callback | **MODIFIED** |
| Backfill route | Superadmin fan-out of all tenants through the same worker path. | `src/app/api/superadmin/xphere/backfill/route.ts` | **NEW** |
| `tenants.xphere_*` | Persist CRM linkage + last sync status/error. | migration `054_xphere_sync_columns.sql` + `Tenant` interface | **NEW (migration) + MODIFIED (type)** |

---

## Recommended Project Structure

```
src/
├── lib/
│   └── xphere/                          # NEW — mirrors lib/{domain}/ convention (lib/supabase, lib/auth)
│       ├── types.ts                     # contract types + SyncReason + XPHERE_STAGES constants
│       ├── mapping.ts                   # PURE map: tenant+profile+sub+plan → payload (offline unit-testable)
│       ├── client.ts                    # syncToXphere() — native fetch, env-gated, the only network file
│       └── queue.ts                     # enqueueXphereSync() — QStash Client, fail-open producer
├── app/
│   └── api/
│       ├── internal/
│       │   └── xphere-sync/
│       │       └── route.ts             # NEW — QStash worker (Receiver.verify, runtime=nodejs)
│       ├── superadmin/
│       │   └── xphere/
│       │       └── backfill/
│       │           └── route.ts         # NEW — assertSuperadmin() + paginated enqueue
│       ├── onboarding/route.ts          # MODIFIED — enqueue after subscription insert
│       └── stripe/
│           ├── webhooks/route.ts        # MODIFIED — enqueue in 3 success branches
│           └── connect/callback/route.ts# MODIFIED — enqueue after upsert succeeds
├── types/
│   └── database.ts                      # MODIFIED — add xphere_* fields to interface Tenant
supabase/migrations/
└── 054_xphere_sync_columns.sql          # NEW — ALTER tenants ADD xphere_* columns
.env.example                             # MODIFIED — document QSTASH_* + XPHERE_* vars
```

### Structure Rationale

- **`src/lib/xphere/`:** Matches the established `lib/{domain}/` convention (`lib/supabase/`, `lib/auth/`, `lib/marketing/`). Splitting into types/mapping/client/queue isolates the contract (types), the bug-prone logic (mapping, pure → testable offline against the documented contract), the network surface (client, the single place contract drift is absorbed), and the producer (queue, the single fail-open choke-point). No barrel `index.ts` — repo convention is direct imports (`@/lib/xphere/queue`).
- **`api/internal/xphere-sync/`:** New `internal/` segment signals "machine-to-machine, not user-facing." Security is **signature verification**, not session auth — same trust model as `api/stripe/webhooks` (no cookies, service-role client, verify-before-work). Must be publicly reachable with no auth wall in front of it (see Integration Points / deployment).
- **`api/superadmin/xphere/backfill/`:** Lives under the existing `api/superadmin/*` tree so it inherits the established `assertSuperadmin()` guard pattern and folder semantics (no tenant scoping, platform-level op).
- **Migration `054_`:** Next free number — highest existing is `053_local_seo_address_geo.sql` (note: two `051_` and two `052_` collisions already exist in the tree; `054` is unambiguous and avoids extending the collision).

---

## Architectural Patterns

### Pattern 1: Enqueue-only, fail-open producer (never break core flows)

**What:** Every lifecycle hook calls one function that publishes to QStash inside a try/catch and returns `void`. A CRM/QStash outage can never propagate an error into onboarding or a Stripe webhook ack.
**When to use:** Always, at every producer site. This is the single most important safeguard — the Xphere endpoint is built by a separate effort and may not exist when this ships.
**Trade-offs:** A swallowed publish error means a missed sync until the next lifecycle event or a backfill re-run heals it. Acceptable because every sync re-asserts full identity (self-healing); never acceptable to break a paid user's onboarding for a CRM mirror.

**Mirrors the existing `rate-limit.ts` fail-open discipline** (`if (!redis) return { ok: true }` + `catch { return { ok: true } }`).

```typescript
// src/lib/xphere/queue.ts
import { Client } from '@upstash/qstash'
import type { SyncReason } from '@/lib/xphere/types'

const token = process.env.QSTASH_TOKEN
const client = token ? new Client({ token }) : null

export async function enqueueXphereSync(tenantId: string, reason: SyncReason): Promise<void> {
  // Fail-open env gate — like rate-limit.ts. Unset QSTASH_TOKEN/XPHERE_* → skip-and-log, app keeps working.
  if (!client || !process.env.XPHERE_API_URL) return
  try {
    await client.publishJSON({
      url: `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/xphere-sync`,
      body: { tenantId, reason },                       // THIN message — see Pattern 2
      retries: 5,
      deduplicationId: `xphere:${tenantId}:${reason}`,   // 10-min QStash dedup window
    })
  } catch (err) {
    // NEVER rethrow into the caller — onboarding / Stripe ack must not fail for a CRM mirror.
    console.error('xphere.enqueue_failed', { tenantId, reason, err })
  }
}
```

### Pattern 2: Thin message + fat read (stale-proof, idempotent retries)

**What:** The QStash message carries only `{ tenantId, reason }`. The worker re-reads live tenant + profile + subscription via the service-role client at process time and maps from current truth — never trusts data captured at enqueue time.
**When to use:** Always. QStash gives no ordering guarantee and at-least-once delivery; a retry hours later must re-send current state, not a stale snapshot.
**Trade-offs:** One extra DB read per delivery (cheap). In exchange, out-of-order delivery, duplicate delivery, and late retries all converge to the same correct upsert. A late `past_due` retry that arrives after the tenant already churned simply re-reads the now-`cancelled` subscription and sends that — no stale write.

```typescript
// inside the worker, after signature verification
const { tenantId, reason } = JSON.parse(rawBody)
const supabase = createServiceClient()
const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
const { data: profile } = await supabase
  .from('profiles').select('full_name, phone, id')         // owner = store-admin
  .eq('tenant_id', tenantId).eq('role', 'store-admin').limit(1).maybeSingle()
const plan = await getTenantPlan(tenantId, supabase)        // EffectivePlan — applies overrides
const payload = buildXpherePayload({ tenant, profile, plan, reason })  // PURE
```

### Pattern 3: Machine-to-machine trust via raw-body signature verification

**What:** The worker reads the raw request body once with `req.text()`, verifies the `Upstash-Signature` JWS with both signing keys + the URL claim, and only then parses. This is the exact discipline the Stripe webhook already uses (`request.text()` → `stripe.webhooks.constructEvent` before any work).
**When to use:** Every inbound machine delivery with no session.
**Trade-offs:** None meaningful. The one footgun: `JSON.parse(body)` then re-`stringify` before `verify()` changes the bytes and 401s every delivery — so parse strictly *after* verification.

```typescript
// src/app/api/internal/xphere-sync/route.ts
import { Receiver } from '@upstash/qstash'
export const runtime = 'nodejs'   // SDK uses jose/crypto-js — not Edge

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
})

export async function POST(req: Request) {
  const signature = req.headers.get('Upstash-Signature') ?? ''
  const rawBody = await req.text()                          // RAW — required for verify()
  const valid = await receiver.verify({
    signature, body: rawBody,
    url: `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/xphere-sync`,
  })
  if (!valid) return new Response('invalid signature', { status: 401 })
  const { tenantId, reason } = JSON.parse(rawBody)          // parse AFTER verify
  // ... fat read → map → POST → write back ...
}
```

### Pattern 4: 2xx/5xx/489 retry classification (transient vs permanent)

**What:** The worker's HTTP status code is the retry signal QStash reads. Map outcomes deliberately:

| Outcome | Worker responds | QStash behaviour |
|---------|-----------------|------------------|
| Xphere `2xx`, write-back ok | `200` | Acked, done |
| Xphere `5xx` / network / timeout / `429` | `500` (optionally `Retry-After`) | Retried on exponential backoff (~12s, ~2m, ~30m, ~6h, cap 24h) |
| Xphere `4xx` validation / unknown stage / tenant-not-found / bad payload | `489` + header `Upstash-NonRetryable-Error: true` | Straight to DLQ — no wasted retries |
| Signature invalid | `401` | Unsigned = attacker, not a real delivery |

**Critical parallel to existing Stripe handler:** in `stripe/webhooks/route.ts`, business-logic failure returns `500` and does NOT record the idempotency row, so Stripe genuinely reprocesses (lines 345-350). Here, transient failure returns `500` and does NOT write `xphere_synced_at` (records `xphere_sync_error`), so QStash genuinely retries. **Mirror that discipline exactly.**

```typescript
try {
  const res = await syncToXphere(payload)        // throws XphereTransientError / XpherePermanentError
  await supabase.from('tenants').update({
    xphere_account_id: res.accountId,
    xphere_contact_id: res.contactId,
    xphere_opportunity_id: res.opportunityId,
    xphere_synced_at: new Date().toISOString(),
    xphere_sync_error: null,                       // clear on success
  }).eq('id', tenantId)
  return new Response('ok', { status: 200 })
} catch (err) {
  await supabase.from('tenants')
    .update({ xphere_sync_error: scrub(String(err)) }).eq('id', tenantId)   // scrub secrets from key
  captureSecurityEvent('xphere.sync_failed', { tenantId, reason })
  if (err instanceof XpherePermanentError) {
    return new Response('permanent', { status: 489, headers: { 'Upstash-NonRetryable-Error': 'true' } })
  }
  return new Response('transient', { status: 500 })   // QStash retries
}
```

### Pattern 5: Idempotent backfill reusing the worker path (one code path = one guarantee)

**What:** The superadmin backfill does NOT build payloads or call Xphere itself. It paginates `tenants` and calls `enqueueXphereSync(id, 'backfill')` per row, throttled. Every tenant flows through the identical worker, so backfill and live events share one set of guarantees and converge via upsert-by-external_id.
**When to use:** Hydrating history; re-running after errors; manual single-tenant re-sync (just `enqueueXphereSync(id, 'manual')`).
**Trade-offs:** Backfill + a live webhook can enqueue the same tenant concurrently — harmless because both upsert by `external_id` to the same Account/Contact/Opportunity. Throttle the fan-out (QStash `delay` / staggered enqueue) to stay under the `/api/v1/sync` rate limit.

---

## Data Flow

### Lifecycle event → CRM (the happy path)

```
Stripe "customer.subscription.updated" (kind=plan, status=past_due)
    ↓
webhooks/route.ts: update tenant_subscriptions → past_due  (existing DB write, line ~251)
    ↓  (after idempotency row recorded at line ~353, inside success path)
enqueueXphereSync(tenantId, 'plan.past_due')   → QStash  [returns void, non-blocking]
    ↓  Stripe gets 200 immediately
QStash → POST /api/internal/xphere-sync  (signed, at-least-once)
    ↓
worker: verify → fat-read tenant+profile+sub+plan → buildXpherePayload (At-Risk stage)
    ↓
client.syncToXphere → POST /api/v1/sync {source:'xmartmenu', external_id:tenantId, account, contact, opportunity}
    ↓  2xx + {accountId, contactId, opportunityId}
worker: UPDATE tenants SET xphere_*_id, xphere_synced_at, xphere_sync_error=null
```

### Exact producer integration points (verified line context)

| File (MODIFIED) | Insert `enqueueXphereSync(...)` here | Reason value |
|---|---|---|
| `api/onboarding/route.ts` | After the `tenant_subscriptions` insert succeeds (after line ~198) — note the resume-path branch (existing tenant, no menu) skips subscription creation, so enqueue should also cover the final success `return` (line ~310) to catch resumes | `'onboarding'` |
| `webhooks/route.ts` → `checkout.session.completed`, `kind==='plan'` branch | After `tenant_subscriptions` update succeeds (≈ line 198) | `'plan.activated'` |
| `webhooks/route.ts` → `customer.subscription.updated`/`deleted`, `kind==='plan'` branch | After the update succeeds (≈ line 260) — derive reason from the computed `status` local (`active`/`past_due`/`cancelled`) | `'plan.updated'` / `'plan.past_due'` / `'plan.churned'` |
| `webhooks/route.ts` → `invoice.payment_failed` branch | After the `past_due` update (≈ line 298) — this branch only has `stripe_subscription_id`, so look up `tenant_id` from `tenant_subscriptions` to enqueue | `'plan.past_due'` |
| `stripe/connect/callback/route.ts` | After the `stripe_connections` upsert succeeds (≈ line 79-83, before the success redirect at line 86) | `'connect.connected'` |

**Placement rule (mirrors Stripe idempotency discipline):** enqueue ONLY after the DB write succeeds AND (in the webhook) inside the success path. Never enqueue before the work, never inline-call Xphere, never enqueue on a failure branch. In the webhook, the cleanest spot is just before the final `return NextResponse.json({ received: true })` (line ~369, after the idempotency row is recorded at line ~353): each branch sets a local `pendingSync: {tenantId, reason} | null`, and one `if (pendingSync) await enqueueXphereSync(...)` fires at the end. That guarantees enqueue happens only when the event is genuinely processed, and a Stripe retry — which short-circuits at the idempotency check (line 73-76) — won't double-enqueue.

### Idempotency strategy (three layers, given at-least-once + upsert endpoint)

1. **Endpoint upsert-by-`external_id` (authoritative).** `/api/v1/sync` upserts on `external_id = tenants.id` (immutable). Re-delivery re-asserts the same row — no duplicates by construction. This is the real guarantee; everything else is optimization.
2. **QStash `deduplicationId` (`xphere:${tenantId}:${reason}`).** Collapses duplicate enqueues within a 10-min window (e.g., a Stripe webhook retry that slips past the idempotency check). Cheap, free with the SDK.
3. **Optional `Idempotency-Key` header to Xphere** (e.g., `${tenantId}:${reason}`) — belt-and-suspenders if the contract supports it. **Confirm the exact header name against the documented `/api/v1/sync` contract** before relying on it.

**Do NOT** key idempotency on email/phone — chain owners share emails; that would merge or split tenants. `external_id = tenants.id` only. Email/phone are attributes, never lookup keys.

**Staleness guard:** since the worker fat-reads, the payload always reflects current truth, so an out-of-order retry self-corrects. If the contract ever needs ordering, gate writes on `xphere_synced_at` (don't apply an event older than the last sync) — but with fat-read + full upsert this is usually unnecessary.

### Payload mapping model (tenant/profile/subscription/plan → Account/Contact/Opportunity)

Pure function in `mapping.ts`. Source fields verified against `interface Tenant` (id, slug, name, plan, custom_domain), `interface TenantSettings` (phone, address), `Profile` (full_name, phone, role), and `EffectivePlan` (from `getTenantPlan`).

```
Account     ← tenants (+ tenant_settings)
  external_id   = tenants.id            (immutable match key)
  name          = tenants.name
  domain/url    = tenants.custom_domain ?? `${NEXT_PUBLIC_APP_URL}/${tenants.slug}`
  source        = 'xmartmenu'           (always)

Contact     ← profiles (store-admin OWNER only — NOT every staff member)
  external_id   = `${tenants.id}:owner` (or owner profile id, per contract)
  name          = profile.full_name
  email         = owner auth email
  phone         = profile.phone ?? tenant_settings.phone

Opportunity ← tenant_subscriptions + EffectivePlan + reason
  external_id   = tenants.id (or `${tenants.id}:opp`)
  stage         = XPHERE_STAGES[reason]   // Onboarding | Active/Won | At-Risk | Churned
  amount (MRR)  = plan.monthly_price       // from getTenantPlan → applies grandfathered overrides;
                                           // NEVER read raw plans.monthly_price
  plan_name     = plan.name
```

**MRR rule:** always source the amount from `getTenantPlan()` (`EffectivePlan.monthly_price`), which applies `override_monthly_price` (verified in `tenant-plan.ts` line 100). Reading `plans.monthly_price` directly would ignore grandfathered/custom pricing and report wrong MRR.

**Stage mapping** lives in a central `XPHERE_STAGES` constant in `types.ts` (stage *names* are data-only config in the Xphere org, so map `SyncReason` → the agreed stage label and preflight-assert unknown reasons → permanent 489).

### Superadmin backfill flow

```
POST /api/superadmin/xphere/backfill
    ↓
assertSuperadmin()  → 401 if not superadmin   (existing helper, superadmin-auth.ts)
    ↓
service.from('tenants').select('id').order('created_at').range(offset, offset+page)   // paginate
    ↓  for each tenant (throttled — QStash delay / staggered)
enqueueXphereSync(tenant.id, 'backfill')
    ↓  → same worker → same upsert → idempotent, re-runnable
return { enqueued: n }
```

Filter internal/test/opt-out tenants at this producer (and the lifecycle producers). **Confirm during planning whether a marketing-consent / internal-tenant flag exists** in the schema; if not, flag to product before syncing PII (LGPD/GDPR).

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1k tenants | Default config is sufficient. Backfill in one paginated pass; QStash plan retries handle transient Xphere downtime. |
| 1k–10k tenants | Throttle backfill fan-out (QStash `delay` / staggered enqueue) to stay under `/api/v1/sync` rate limit. Monitor the DLQ. Honor `Retry-After`/`429` from Xphere (return `500`, let backoff space attempts). |
| 10k+ tenants | Backfill in chunked batches across time windows. Consider a `failureCallback` route that writes `xphere_sync_error` in bulk for DLQ entries. The fat-read-per-delivery DB cost is the next thing to watch — but Supabase handles it long before this scale. |

### Scaling Priorities

1. **First bottleneck: `/api/v1/sync` rate limit during backfill.** A naive "enqueue all tenants at once" fan-out bursts every message to Xphere within QStash's delivery window. Fix: staggered enqueue (`delay: i * k` seconds) or QStash flow-control.
2. **Second bottleneck: poison-message retry storms.** A permanently-bad payload retried on 24h backoff churns the queue. Fix: the 489 + `Upstash-NonRetryable-Error` classification (Pattern 4) routes permanent failures straight to DLQ instead of retrying.

---

## Anti-Patterns

### Anti-Pattern 1: Calling Xphere synchronously inside the producer

**What people do:** `await syncToXphere(...)` directly in the onboarding route or the Stripe webhook branch.
**Why it's wrong:** Xphere downtime would block onboarding or time out the Stripe webhook ack (Stripe then retries the whole event); a CRM mirror failure becomes a core-flow failure.
**Do this instead:** `enqueueXphereSync(...)` (fire-and-forget) → QStash → worker. The producer stays fast and non-blocking.

### Anti-Pattern 2: Fat message (capturing tenant state at enqueue time)

**What people do:** Serialize the full tenant/subscription snapshot into the QStash body.
**Why it's wrong:** At-least-once + no-ordering means a retry hours later replays a stale snapshot, overwriting newer CRM state.
**Do this instead:** Thin `{tenantId, reason}` message; the worker fat-reads live state. Retries always send current truth.

### Anti-Pattern 3: Verifying the signature against re-serialized JSON

**What people do:** `const body = await req.json()` then `verify({ body: JSON.stringify(body) })`.
**Why it's wrong:** Re-serialization changes bytes; the JWS hash won't match; every delivery 401s.
**Do this instead:** `const raw = await req.text()`, verify with `raw`, `JSON.parse(raw)` only after verification — exactly as the Stripe handler reads `request.text()` before `constructEvent`.

### Anti-Pattern 4: Idempotency keyed on email/phone

**What people do:** Match/dedup the CRM record by the owner's email.
**Why it's wrong:** Restaurant chain owners share an email across tenants → records merge or split; one tenant's churn corrupts another's Opportunity.
**Do this instead:** Match exclusively on `external_id = tenants.id` (immutable). Email/phone are attributes pushed on every sync, never lookup keys.

### Anti-Pattern 5: Recording sync success before the write-back / on the failure branch

**What people do:** Return 200 (or skip retry) before persisting `xphere_*_id`, or enqueue on a branch where the DB write failed.
**Why it's wrong:** Loses the CRM linkage / fires syncs for state that didn't persist — diverges from the proven Stripe pattern where the idempotency row is recorded ONLY after business logic succeeds.
**Do this instead:** Write back `xphere_*_id` + `xphere_synced_at` before returning 200; enqueue ONLY after the lifecycle DB write succeeds.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Upstash QStash (publish) | `Client.publishJSON` from `enqueueXphereSync`, env-gated on `QSTASH_TOKEN` | Same Upstash account as existing Redis/ratelimit; separate token. Fail-open if unset. |
| Upstash QStash (deliver) | Signed POST → worker route; `Receiver.verify` with both signing keys + URL claim | Worker MUST be publicly reachable over HTTPS with **no auth wall** QStash can't satisfy (no Basic Auth / IP allowlist / deployment protection). Security = signature, not network. |
| Xphere `POST /api/v1/sync` | Native `fetch` from `client.ts`, `Authorization: Bearer XPHERE_API_KEY`, `AbortSignal.timeout(10s)`, body includes `source:'xmartmenu'` + `XPHERE_ORG_ID` + `external_id` | Built by separate Xtimator effort — DO NOT modify that repo. Code against the documented contract; treat shape mismatch as recordable `xphere_sync_error`, not a crash. Confirm atomicity (single call upserts all 3 objects?) + exact `Idempotency-Key` header name. |
| Supabase (service-role) | `createServiceClient()` in the worker for the fat-read + write-back; bypasses RLS like the Stripe webhook does | Worker has no cookies — same pattern as `stripe/webhooks/route.ts` line 63. |
| Sentry | `captureSecurityEvent` in the worker catch block | Already wired (`src/lib/observability.ts`); reuse. Scrub `XPHERE_API_KEY` from any error written to `xphere_sync_error`. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| producers ↔ queue | direct function call (`enqueueXphereSync`) | One choke-point; fail-open; never throws into producer. |
| queue ↔ worker | QStash durable async | At-least-once, signed, retried. |
| worker ↔ mapping | direct (pure function) | `mapping.ts` has zero I/O → unit-testable offline against the documented contract; highest-value test target (note: repo has no test runner yet — flag during planning). |
| worker ↔ client | direct (`syncToXphere`) | `client.ts` is the only network-touching file; all contract drift absorbed here. |
| worker ↔ Supabase | service-role read + write-back | Reuse `getTenantPlan(tenantId, supabase)` so MRR honors overrides. |
| backfill ↔ worker | via queue (same path) | One code path = one set of guarantees. |

### Deployment caveat (flag for requirements)

`PROJECT.md`/codebase STACK say **Vercel**, but the repo has a `Dockerfile` + Coolify GHCR `docker-compose` and CI building a GHCR image (production `xmartmenu.skale.club`). Whichever host: (1) the worker URL must be publicly resolvable over HTTPS, (2) no blocking auth in front of it, (3) `publishJSON` `url` must use the public origin (`NEXT_PUBLIC_APP_URL` = `https://xmartmenu.skale.club`), never `localhost` in deployed envs. The SDK code is identical either way — confirm the live target before building so the callback URL is right.

---

## Suggested Build Order (dependency-respecting)

Phases 1–5 are fully buildable and exercisable **offline** against the documented contract (XPHERE_* unset → client skips/throws not-configured, error recorded; or pointed at a local stub). Live integration is deferred until Xtimator ships `/api/v1/sync`; the env-presence gate activates real calls with zero code change.

| Order | Deliverable | New / Modified files | Depends on |
|-------|-------------|----------------------|-----------|
| **1. Schema + Contract** | `054_xphere_sync_columns.sql` (add `xphere_account_id`, `xphere_contact_id`, `xphere_opportunity_id`, `xphere_synced_at`, `xphere_sync_error`); `Tenant` interface update; `xphere/types.ts` (contract + `SyncReason` + `XPHERE_STAGES`); `xphere/mapping.ts` (pure, tested) | migration **NEW**, `database.ts` **MOD**, `types.ts`+`mapping.ts` **NEW** | nothing — front-loads the idempotency key + stage mapping (riskiest correctness) |
| **2. Worker + client** | `api/internal/xphere-sync/route.ts` (verify → fat-read → map → POST → write-back → 2xx/500/489); `xphere/client.ts` (env-gated fetch + `XphereTransientError`/`XpherePermanentError`) | both **NEW** | Phase 1 (reads columns, uses mapping/types). Keystone — the retry/signature contract everything relies on. |
| **3. Producer hooks** | `xphere/queue.ts` (`enqueueXphereSync`, fail-open); wire into onboarding, 3 webhook branches, connect callback | `queue.ts` **NEW**; onboarding/webhooks/callback **MOD** | Phase 2 (enqueued jobs need somewhere to land). Enforces never-break-core-flows. |
| **4. Backfill** | `api/superadmin/xphere/backfill/route.ts` (assertSuperadmin + paginated, throttled enqueue) | **NEW** | Phase 3 (reuses producer + worker) |
| **5. Observability + Ops** | surface `xphere_sync_error`/`xphere_synced_at` in superadmin tenant detail; manual re-sync button; DLQ monitor; secret-scrub; optional `XPHERE_SYNC_ENABLED` kill switch; `.env.example` docs | superadmin UI **MOD**, env docs **MOD** | Phase 4 (uses data the worker writes) |
| **6. (deferred) Live integration test** | Run against the real `/api/v1/sync` once credentials land; idempotency / out-of-order / stale-retry / signature / partial-failure / missing-stage / backfill+live race / endpoint-down checklist | — | Xtimator ships endpoint + creds |

**Ordering rationale:** dependency-forced (migration+types → lib → worker → hooks → backfill → observability — each layer reads/writes what the one below created) and risk-front-loaded (idempotency key in P1, signature+retry contract in P2, enqueue-only producers in P3 — the three things that, if wrong, cause cross-tenant corruption, an open CRM-write endpoint, or broken onboarding — are built earliest). This matches the consensus phase skeleton already in `SUMMARY.md`.

### Migration sketch (`054_xphere_sync_columns.sql`)

```sql
-- v2.4 Xphere CRM Sync — persist CRM linkage + last sync status/error on tenants.
-- external_id for the upsert = tenants.id (immutable). These columns are the
-- write-back target of the worker; no RLS change needed (service-role only writes).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS xphere_account_id     TEXT        NULL,
  ADD COLUMN IF NOT EXISTS xphere_contact_id     TEXT        NULL,
  ADD COLUMN IF NOT EXISTS xphere_opportunity_id TEXT        NULL,
  ADD COLUMN IF NOT EXISTS xphere_synced_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS xphere_sync_error     TEXT        NULL;

-- Optional: partial index for the superadmin sync-health dashboard
-- (find errored / never-synced tenants fast).
CREATE INDEX IF NOT EXISTS idx_tenants_xphere_error
  ON tenants (xphere_synced_at) WHERE xphere_sync_error IS NOT NULL;
```

Corresponding `interface Tenant` additions in `src/types/database.ts`:
```typescript
xphere_account_id: string | null
xphere_contact_id: string | null
xphere_opportunity_id: string | null
xphere_synced_at: string | null
xphere_sync_error: string | null
```

---

## Sources

- XmartMenu codebase (verified directly, 2026-06-21): `src/app/api/stripe/webhooks/route.ts` (idempotency-after-success lines 345-367, raw-body verify lines 36-59, 500-to-retry discipline, plan/connect event branches), `src/app/api/onboarding/route.ts` (tenant + subscription creation point lines 187-198, resume branch lines 91-112), `src/app/api/stripe/connect/callback/route.ts` (service-role upsert lines 69-83), `src/lib/tenant-plan.ts` (`getTenantPlan` override resolution → MRR line 100), `src/lib/superadmin-auth.ts` (`assertSuperadmin` lines 43-53), `src/lib/rate-limit.ts` (fail-open env-gate pattern lines 13, 38, 52), `src/lib/observability.ts` (`captureSecurityEvent`), `src/types/database.ts` (`Tenant`/`TenantSettings` shape lines 85-105), `supabase/migrations/*` (numbering → next free `054`) — **HIGH**
- `.planning/research/STACK.md` + `SUMMARY.md` (committed v2.4 research: QStash SDK 2.11.1, Receiver/Client APIs, retry/DLQ/489 + `Upstash-NonRetryable-Error`, 10-min dedup, deployment caveat) — **HIGH**
- `.planning/PROJECT.md` (v2.4 milestone scope, locked decisions: `external_id = tenants.id`, do-not-modify-Xphere, env vars) — **HIGH**
- Upstash QStash docs (signature/raw-body/two-key verify, exponential backoff, 489 DLQ, deduplicationId) — **HIGH** (via committed STACK.md citations)

---
*Architecture research for: v2.4 Xphere CRM Sync — integration of QStash-backed outbound CRM sync into existing XmartMenu architecture*
*Researched: 2026-06-21*
