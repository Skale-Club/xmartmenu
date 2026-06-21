# Feature Research

**Domain:** Outbound product→CRM lifecycle sync (XmartMenu tenants mirrored into Xphere CRM)
**Researched:** 2026-06-20 · **Re-verified against codebase:** 2026-06-21
**Milestone:** v2.4 CRM & Integrations — Xphere CRM Sync
**Downstream consumer:** Requirements definition — feature list grouped by category, each marked table-stakes/differentiator/anti-feature, with complexity + XmartMenu code dependencies
**Confidence:** HIGH (lifecycle event → webhook mapping verified line-by-line in `src/app/api/stripe/webhooks/route.ts`, `onboarding/route.ts`, `connect/callback/route.ts`, `tenant-plan.ts`)

> Scope note: This milestone adds **outbound, one-way** sync that mirrors every XmartMenu tenant
> into the dedicated Xphere CRM org. The object mapping, transport, and idempotency key are already
> **DECIDED** and are NOT re-evaluated here:
>
> | XmartMenu entity | Xphere CRM object | Idempotency key |
> |---|---|---|
> | `tenants` row (the business) | **Account** | `external_id = tenants.id` |
> | store-admin profile (the owner) | **Contact** | `external_id = tenants.id` (+ contact email) |
> | `tenant_subscriptions` (lifecycle) | **Opportunity** | `external_id = tenants.id` |
>
> Transport: producer enqueues to **QStash** → worker route `/api/internal/xphere-sync` → calls the
> **shared** `POST /api/v1/sync` Xphere endpoint with `source='xmartmenu'`. Every event carries
> `external_id = tenants.id` so the Xphere side upserts deterministically.
>
> This research defines **behavior**: which lifecycle events fire, what each does to the Opportunity
> (stage + tags + custom_fields snapshot + timeline note), how the one-time backfill behaves, and
> what observability is table-stakes — grouped table-stakes / differentiator / anti-feature with
> complexity and dependencies on existing XmartMenu code.

---

## Entity Mapping (already decided — restated for the requirements doc)

| XmartMenu source of truth | Xphere object | Key fields written each sync | Notes |
|---|---|---|---|
| `tenants` row | **Account** | name (`tenants.name`), slug, `external_id = tenants.id` | Re-asserted on every sync (cheap, self-healing). |
| store-admin `profiles` row | **Contact** | full_name, email, phone, linked to Account by `external_id` | **Owner only** — never store-staff (read-only operational users → noise). |
| `tenant_subscriptions` row | **Opportunity** | stage, amount (=MRR), tags, custom_fields snapshot, timeline note | One Opportunity per tenant (the subscription **is** the deal); not one-per-invoice. |

**Why Account+Contact upsert runs first on every event:** each sync re-asserts identity from current
DB state *before* moving the Opportunity, so a missed earlier event never leaves the three objects
incoherent. A dropped event is repaired by the next one (self-healing replay) — this is the standard
Salesforce upsert-by-ExternalId pattern.

---

## Opportunity Stage Model (concrete)

Stages are configured **data-only in the Xphere org UI/MCP** (org `e375f031-…`), NOT in repo code
(milestone constraint). The XmartMenu worker only *names* the target stage per event.

```
Onboarding ──plan activated──> Active ──past_due──> At Risk ──cancel──> Churned (Lost)
    │                            │  ▲                    │
    │                            │  └──payment recovers──┘
    └──(rarely) abandons─────────┴──────────────────────────────> Churned (Lost)
```

| Stage | Won/Lost semantics | Entered by event | Opportunity amount (MRR) |
|---|---|---|---|
| **Onboarding** | Open | #1 signup (entry `menu` plan, `status='active'` but not yet paid via Stripe) | entry-plan MRR (often the floor) |
| **Active** | **Won** (closed-won the moment a paid Stripe checkout completes) | #2 plan activated | resolved MRR via `getTenantPlan` |
| **At Risk** | Open / re-opened (dunning) | #4 past_due | last known MRR (unchanged) |
| **Churned** | **Lost** | #5 cancel/delete | set to 0 (or keep last MRR with `status:churned` — pick one and be consistent) |

**Won/Lost decision (recommended):** treat **Active = Won** and **Churned = Lost**; At Risk is an
*open, re-openable* state, not Lost — past_due frequently recovers, and flipping Lost↔Won on every
dunning cycle pollutes win-rate reporting. A tenant that recovers from At Risk moves back to Active
(Won) on the next successful `customer.subscription.updated status='active'`.

**MRR as opportunity value — must be normalized:** resolve via `getTenantPlan(tenantId)` (applies
`override_*` grandfathering), then **normalize annual to monthly**:
`MRR = billing_cycle === 'annual' ? effective.annual_price / 12 : effective.monthly_price`.
Never read raw `plans.monthly_price` — grandfathered/custom-priced tenants carry overrides.
(`getTenantPlan` returns both `monthly_price` and `annual_price` already override-resolved.)

---

## Lifecycle Event → CRM Effect Mapping (verified against code)

Each event is emitted from an existing XmartMenu choke point, enqueued to QStash with
`external_id = tenants.id`, and produces a deterministic Opportunity move.

| # | Lifecycle event | Verified source choke point | Stage → | Tags | custom_fields snapshot | Timeline note | Dedup key |
|---|---|---|---|---|---|---|---|
| 1 | **Signup / onboarding** | `onboarding/route.ts` **after step 3b** (line 187 `tenant_subscriptions` insert) | `Onboarding` | `source:xmartmenu`, `plan:menu` | slug, business_type, plan slug, billing_cycle, created_at | "Tenant onboarded (plan: menu)" | `onboarding:<tenant_id>` |
| 2 | **Plan activated** (paid checkout) | `webhooks` → `checkout.session.completed`, `metadata.kind==='plan'` (line 186) | `Active` / **Won** | `plan:<slug>`, `status:active` | plan slug, **MRR (normalized)**, billing_cycle, stripe_customer_id, period_end | "Plan activated: <plan> (<cycle>)" | Stripe `event.id` |
| 3 | **Plan upgrade / downgrade** | `webhooks` → `checkout.session.completed` plan_id differs (**not** detectable in `subscription.updated` today) | stays `Active`; **amount/MRR updated** | swap `plan:*`; add `upgrade`/`downgrade` | new plan, new MRR, prev plan, direction | "Plan upgraded menu→orders" / "downgraded" | Stripe `event.id` |
| 4 | **Payment past_due** (dunning) | `webhooks` → `invoice.payment_failed` (line 288) **and** `subscription.updated` status `past_due`/`unpaid` (line 247) | `At Risk` | add `status:past_due`; drop `status:active` | status, current_period_end, dunning_since | "Payment failed — past_due" | Stripe `event.id` |
| 5 | **Churn / cancellation** | `webhooks` → `customer.subscription.deleted` (line 222) or `.updated` status `canceled` (line 248) | `Churned` / **Lost** | add `status:churned`; drop active/past_due | churned_at, last plan, cancel_at_period_end | "Subscription cancelled / churned" | Stripe `event.id` |
| 6 | **Stripe Connect connected** | `connect/callback/route.ts` (line 69 upsert) **+** `webhooks` → `account.updated` `charges_enabled` (line 307) | stays current; **flag set** | `connect:active` / `connect:disabled` | stripe_account_id, charges_enabled, payouts_enabled | "Stripe Connect connected (charges enabled)" | callback: `connect:<tenant_id>` · webhook: `event.id` |
| 7 | **First paid order** (OPTIONAL — differentiator) | `webhooks` → `payment_intent.succeeded` (line 82, has `metadata.tenant_id`) | stays current; activation signal | add `activated` (one-time) | first_order_at, first_order_total | "First paid order — tenant is live" | first-order guard |

### Code-verified nuances (sharpen the requirements)

- **Event #1 fires only on first-time onboarding.** `onboarding/route.ts` has two early paths that do
  NOT re-create the subscription: `already_configured` (line 100, menu exists) and the resume path
  (line 108, tenant exists/menu missing). Enqueue the onboarding sync **only inside the `else` branch
  that creates the tenant + subscription** (line 113+). The resume/`already_configured` paths are
  still safe to re-sync because of `external_id`, but they should fire a **`full-sync`**, not a fresh
  "onboarded" note (avoids a duplicate timeline note).
- **Onboarding tenants land on the `menu` entry plan with `status='active'` immediately** (line 193),
  *before any Stripe payment*. So "Onboarding" stage ≠ "trialing" — the tenant is on a paid-tier entry
  plan that simply hasn't been charged yet. Event #2 (Stripe checkout) is what marks them **Won**.
- **Event #3 (upgrade/downgrade) is MEDIUM, not LOW.** The existing `customer.subscription.updated`
  branch (line 221) does **not** compare old vs new `plan_id`; `plan_id` is only rewritten in
  `checkout.session.completed` (line 194). Detecting direction requires reading the *current*
  `tenant_subscriptions.plan_id` **before** the update overwrites it, then comparing plan rank. New
  logic — budget for it accordingly.
- **The webhook returns HTTP 500 on any business-logic failure to force a Stripe retry** (lines
  345–350, idempotency recorded *only after* success). This is exactly why the CRM call must be
  **enqueued, never awaited inline**: a CRM 500 thrown inside the webhook would fail the whole event
  and make Stripe retry the *Stripe* work forever. Enqueue must be fire-and-forget *after* the DB
  update succeeds and must never throw into the handler.
- **Event #6 has two producers with different knowledge.** The OAuth callback (line 69) knows the
  account is linked but only sets `is_active:true` optimistically — it does NOT know `charges_enabled`
  yet. `account.updated` (line 307) is the authoritative `charges_enabled`/`payouts_enabled` source.
  Both enqueue the same connect-flag event; the worker writes whatever the latest event carries.
- **Event #7 first-order detection is not free.** `payment_intent.succeeded` carries
  `metadata.tenant_id` + `order_id` but there's no "is this the first?" signal — needs a
  `tenants.first_paid_order_at` (or a count) to fire exactly once. Hence P3.

### Mapping principles (apply to every event)

- **Account + Contact upsert runs first and is idempotent.** Each sync re-asserts Account name/slug +
  contact email from current DB. A missed event is repaired by the next one.
- **Stage moves are explicit, never inferred.** Each event maps to exactly one target stage.
- **custom_fields = a snapshot of current truth, not an event log** (see next section).
- **Tags are additive + idempotent**; status tags are mutually exclusive (set new, drop stale).
- **Timeline notes are append-only, deduplicated by the dedup key** (Stripe `event.id` or
  `onboarding:<tenant_id>` / `connect:<tenant_id>`) so QStash redelivery + Stripe retries never
  double-post.

---

## custom_fields vs timeline notes (explicit distinction)

This is a frequent point of confusion — the requirements doc must state it plainly.

| | **custom_fields** (snapshot) | **timeline notes** (event log) |
|---|---|---|
| Semantics | "What is true **right now**" | "What **happened**, in order" |
| Write behavior | **Overwrite** each sync with current resolved values | **Append-only**, deduped by event id |
| Cardinality | One value per field (latest wins) | Many entries, chronological |
| Examples | `current_plan`, `mrr`, `billing_cycle`, `subscription_status`, `stripe_customer_id`, `stripe_account_id`, `charges_enabled`, `current_period_end`, `churned_at`, `first_paid_order_at` | "Plan activated: orders (annual)", "Payment failed — past_due", "Upgraded menu→orders", "Stripe Connect connected" |
| Why split | A snapshot field stays correct under out-of-order delivery (last write wins on a stable field). An event log preserves history a snapshot would erase. | A note answers "when/why did this change" that a snapshot can't. |

**Rule of thumb:** if RevOps would *filter or sort the pipeline by it* → custom_field. If it's
*narrative history a human reads* → timeline note. MRR, plan, status, period dates, Connect flags =
custom_fields. Every transition also drops one human-readable note.

---

## Feature Landscape

For an internal CRM-mirror integration, "users" = the **superadmin / RevOps operator** who lives in
Xphere and the **engineer** who owns reliability.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Dependencies / Notes |
|---------|--------------|------------|----------------------|
| **Transport spine** — `src/lib/xphere/` (client+mapping+types) + QStash producer + `/api/internal/xphere-sync` worker | Nothing syncs without it; everything depends on it | MEDIUM | New code. Worker verifies QStash signing keys, idempotent, writes `xphere_*` columns. |
| **`tenants` migration** — `xphere_account_id`, `xphere_contact_id`, `xphere_opportunity_id`, `xphere_synced_at`, `xphere_sync_error` | Per-tenant sync state must be queryable | LOW | New columns; `external_id = tenants.id` already exists as PK. |
| **Onboarding sync (event #1)** → Account+Contact+Opportunity (Onboarding) | Every tenant must exist in CRM from day 1 | MEDIUM | Hook **inside the tenant-creating `else` branch**, after step 3b (line 187). Enqueue, do NOT block the 201/200. |
| **Plan activated (event #2)** → Active/Won + normalized MRR | Revenue is the whole point of mirroring subscriptions | MEDIUM | `checkout.session.completed` branch (line 186); MRR via `getTenantPlan` + annual/12 normalization. |
| **Past_due (event #4)** → At Risk + tag | Dunning visibility is core lifecycle | LOW | Reuse `invoice.payment_failed` (288) + `past_due` mapping (247). |
| **Churn (event #5)** → Churned/Lost + tag | Closing the cancellation loop is expected | LOW | `customer.subscription.deleted` (222) / status `canceled` (248). |
| **Idempotent upsert by `external_id`** | Replays/retries must never duplicate objects | LOW (contract handles it) | Producer's only job: always send `external_id`. |
| **One-time backfill** of existing tenants (superadmin route) | Existing tenants must populate the pipeline | MEDIUM | Iterate `tenants`, enqueue a `full-sync` per tenant. Idempotent → safe to re-run. |
| **Error surfacing (`xphere_sync_error`)** | A silent failed sync is worse than none | LOW–MEDIUM | Worker writes last error on failure, clears on success. Surface in superadmin tenant detail. |
| **Manual re-sync (single tenant)** | Operator needs one-click retry after an error | LOW | Superadmin button → enqueue `full-sync` for that tenant. |
| **Async / non-blocking delivery** | A CRM outage must never break onboarding or webhook 200s | MEDIUM | QStash decouples; producers only enqueue. **Critical** given the webhook's 500-retry contract. |
| **Retry with backoff** | Transient CRM/network failures must self-recover | LOW (QStash handles it) | QStash retries on non-2xx from the worker; keep worker idempotent. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Plan upgrade/downgrade direction tag (event #3) | Spot expansion vs contraction | **MEDIUM** | Must compare current `tenant_subscriptions.plan_id` *before* the webhook overwrites it; emit `upgrade`/`downgrade`. Not free. |
| Stripe Connect connected flag (event #6) | Marks payments-tier activation — strong PQL signal | MEDIUM | Connect callback (69) + `account.updated` (307); `connect:active`/`connect:disabled`. |
| Normalized MRR snapshot in custom_fields | Opportunity amount reflects real revenue incl. overrides + annual→monthly | LOW | `getTenantPlan` + annual/12. |
| Timeline notes per transition | Human-readable CRM history | LOW | Append-only, deduped by dedup key. |
| Backfill dry-run / report mode | Preview what backfill changes before firing for all tenants | MEDIUM | Count + per-tenant intended action, no enqueue. |
| Superadmin sync dashboard (synced / errored / never-synced) | At-a-glance mirror health | MEDIUM | Aggregate `xphere_synced_at` / `xphere_sync_error` across `tenants`. |
| First paid order activation signal (event #7) | "Tenant is truly live" CSM trigger | MEDIUM | `payment_intent.succeeded` + first-order detection (`tenants.first_paid_order_at`). |

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Two-way / bidirectional sync** | "Keep both systems in sync" | Conflict resolution, loop prevention, a write path INTO the app DB from outside, RLS/security surface | **One-way outbound only.** XmartMenu DB is source of truth; CRM is a downstream mirror. |
| **Per-tenant CRM orgs** | Feels "isolated" per customer | Org/provisioning explosion, API-key sprawl, defeats book-of-business RevOps view | **Single shared XmartMenu Xphere org**; tenants are Accounts within it. |
| **Synchronous/inline sync in the webhook** | "Instant" CRM updates | The webhook returns **500 to force Stripe retry** — an inline CRM 500 would make Stripe retry forever / break onboarding | **Enqueue to QStash after the DB write**, return 200. Eventual consistency is fine for a CRM. |
| **Syncing every order / per-order revenue line** | "Full revenue picture in CRM" | High volume, noisy timeline, turns CRM into an order log | **First paid order only** (optional). Aggregate revenue stays in Stripe/analytics. |
| **Modifying the Xphere repo** | Convenient to "just add a field" | Out of scope — `/api/v1/sync`, `external_id`, `sync:write` owned by the separate Xtimator effort | **Build against the documented contract.** Stages configured data-only in Xphere UI/MCP. |
| **Caching CRM data back in XmartMenu** | "Show CRM status in admin" | Duplicates source of truth, goes stale, invites two-way temptation | Store only **CRM ids + sync metadata** (`xphere_*_id`, `synced_at`, `sync_error`). |
| **Custom retry/queue implementation** | "We control retries" | Reinvents QStash; adds cron, DLQ, backoff to maintain | **Use QStash** retries + signing-key verification on the worker. |
| **Per-staff-member Contacts** | "Sync everyone" | store-staff are read-only operational users, not buying contacts; CRM noise | **Contact = store-admin (owner) only.** |
| **A separate Opportunity per invoice / per upgrade** | "Track each deal" | The subscription is one continuous relationship; multiple Opportunities fragment MRR + win-rate | **One Opportunity per tenant**; upgrades update amount + drop a note. |
| **Re-posting an "onboarded" note on resume/re-sync** | "Always log onboarding" | Resume path + backfill would spam duplicate notes | Onboarding note fires **once** (creation branch); resume/backfill use `full-sync` (snapshot, no fresh note). |

---

## Feature Dependencies

```
Transport spine (src/lib/xphere/ + QStash producer + /api/internal/xphere-sync worker)
    └──requires──> tenants migration (xphere_* columns)
    └──requires──> Xphere /api/v1/sync contract + XPHERE_API_KEY + XPHERE_ORG_ID
    └──requires──> QSTASH_TOKEN + signing keys

Onboarding hook (event #1) ──requires──> transport spine
    └──requires──> onboarding/route.ts tenant-creation branch (enqueue after step 3b)

Stripe lifecycle hooks (#2–#6) ──requires──> transport spine
    └──requires──> stripe/webhooks/route.ts (existing choke point; enqueue per branch AFTER DB update)
    └──requires──> getTenantPlan() for override-resolved MRR (src/lib/tenant-plan.ts)

Connect hook (event #6) ──requires──> transport spine
    └──requires──> connect/callback/route.ts (second producer) + account.updated webhook branch

Event #3 (upgrade/downgrade) ──requires──> reading prior plan_id before checkout overwrites it

Backfill route (superadmin) ──requires──> transport spine (reuses full-sync event shape)
    └──enhances──> observability (populates xphere_synced_at across all tenants)

Observability (sync status / error / re-sync) ──requires──> xphere_* columns
    └──enhances──> Manual re-sync (re-enqueues full-sync for one tenant)

Two-way sync ──conflicts──> one-way source-of-truth model (DO NOT BUILD)
Per-tenant CRM orgs ──conflicts──> single shared Xphere org (DO NOT BUILD)
```

### Dependency Notes

- **Build the transport spine first.** All hooks are thin: resolve `tenant_id` → enqueue.
- **Stripe hooks slot into the existing `switch`** in `stripe/webhooks/route.ts`. Add the enqueue
  call **after the DB update succeeds within each branch** and **before** the 500-on-failure return —
  never enqueue in a path that will 500, and never `await` the CRM round-trip in the handler.
- **MRR must be resolved AND normalized** — `getTenantPlan()` for overrides, then annual/12.
- **Event #1 fires only in the tenant-creation branch** of onboarding; resume + backfill use
  `full-sync` (snapshot only, no duplicate onboarded note).
- **Connect is a second producer** alongside `account.updated`.

---

## MVP Definition

### Launch With (v1) — P1

- [ ] Transport spine — `src/lib/xphere/` + QStash producer + signature-verified, idempotent worker
- [ ] `tenants` migration — `xphere_account_id/contact_id/opportunity_id/synced_at/sync_error`
- [ ] Event #1 Onboarding → Account+Contact+Opportunity (Onboarding stage)
- [ ] Event #2 Plan activated → Active/Won + normalized MRR snapshot
- [ ] Event #4 Past_due → At Risk
- [ ] Event #5 Churn → Churned/Lost
- [ ] One-time backfill route (superadmin), idempotent re-runnable, no duplicate onboarded note
- [ ] Observability v1 — `xphere_sync_error` surfaced in superadmin tenant detail + manual re-sync button

### Add After Validation (v1.x) — P2

- [ ] Event #3 Plan upgrade/downgrade direction tags (needs prior-plan diff)
- [ ] Event #6 Stripe Connect connected flag (callback + account.updated)
- [ ] Backfill dry-run / report mode
- [ ] Superadmin sync health dashboard (synced/errored/never-synced counts)

### Future Consideration (v2+) — P3

- [ ] Event #7 First paid order activation signal (needs `first_paid_order_at` detection)
- [ ] Templated / richer timeline notes

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Transport spine (xphere lib + QStash worker) | HIGH | MEDIUM | P1 |
| `tenants` xphere_* migration | HIGH | LOW | P1 |
| Event #1 Onboarding sync | HIGH | MEDIUM | P1 |
| Event #2 Plan activated + normalized MRR | HIGH | MEDIUM | P1 |
| Event #4 Past_due → At Risk | HIGH | LOW | P1 |
| Event #5 Churn → Churned | HIGH | LOW | P1 |
| One-time backfill route | HIGH | MEDIUM | P1 |
| Error surfacing + manual re-sync | HIGH | LOW | P1 |
| Event #3 upgrade/downgrade tags | MEDIUM | MEDIUM | P2 |
| Event #6 Stripe Connect flag | MEDIUM | MEDIUM | P2 |
| Backfill dry-run mode | MEDIUM | MEDIUM | P2 |
| Sync health dashboard | MEDIUM | MEDIUM | P2 |
| Event #7 First paid order | MEDIUM | MEDIUM | P3 |
| Two-way sync | (negative) | HIGH | DO NOT BUILD |
| Per-tenant CRM orgs | (negative) | HIGH | DO NOT BUILD |

**Priority key:** P1 = launch · P2 = add after validation · P3 = future.

---

## Pattern Analysis (how established tools do product→CRM lifecycle sync)

| Concern | HubSpot lifecycle-stage sync | Salesforce upsert-by-ExternalId | XmartMenu→Xphere approach |
|---------|------------------------------|----------------------------------|---------------------------|
| Direction | Often bidirectional | Either; ExternalId enables one-way feeds | **One-way outbound only** |
| Idempotency | Record dedup by property | Upsert on `ExternalId` | Upsert on `external_id = tenants.id` |
| Trigger model | Event-driven (product event → property change) | Webhook live + scheduled backfill | Stripe/onboarding events via QStash + superadmin backfill |
| Lifecycle stages | Trial/Onboarding/Active/At-Risk/Churned | Pipeline stages on Opportunity | Onboarding/Active/At Risk/Churned (+Won/Lost), data-only in Xphere |
| Backfill | Bulk import + scheduled sync | MERGE/UPSERT by business key, re-runnable | Superadmin route, idempotent re-runnable full-sync per tenant |
| Reliability | Retries + replay | Idempotent replays / self-healing | QStash retries + idempotent worker |

The 2026 consensus: **event-driven, not calendar-driven**; **CRM as a downstream mirror** of the
product lifecycle; **idempotent upserts on a stable external id**; **webhooks for live events + a
triggered/scheduled backfill to hydrate history** — exactly the shape decided for this milestone.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|-----------|-------|
| Lifecycle event set + stage mapping | HIGH | Standard SaaS lifecycle + every choke point + event branch verified in `stripe/webhooks/route.ts`, `onboarding/route.ts`, `connect/callback/route.ts` |
| MRR resolution + annual normalization | HIGH | Read `tenant-plan.ts` — returns override-resolved monthly+annual; billing_cycle on subscription |
| Event #3 raised to MEDIUM | HIGH | Confirmed `subscription.updated` does NOT diff plan_id; plan_id only set in `checkout.session.completed` |
| Non-blocking as critical (not just nice) | HIGH | Webhook returns 500-on-failure to force Stripe retry (verified lines 345–350) |
| One-way + idempotent-upsert + backfill pattern | HIGH | Salesforce integration patterns + decided mapping |
| Anti-features (two-way, per-tenant orgs) | HIGH | Explicit milestone constraints in PROJECT.md + best practice |
| Observability scope (status/error/re-sync) | MEDIUM–HIGH | Standard for internal integrations; exact superadmin UI surface depends on existing admin patterns |

---

## Sources

- [HubSpot — Use lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages) — Onboarding/Active/At-Risk/Churned model
- [HubSpot — Sync record lifecycle stages](https://knowledge.hubspot.com/object-settings/manage-how-lifecycle-stages-sync-between-objects) — event-driven stage propagation
- [Salesforce — Data 360 integration patterns](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360_integration_patterns_and_practices) — upsert by ExternalId, self-healing replays, webhook-live + scheduled-backfill
- [Salesforce — Idempotent record writes](https://help.salesforce.com/s/articleView?id=release-notes.rn_api_idempotent_records.htm&language=en_US&release=240&type=5) — prevent duplication on replay
- [Backfilling historical data with idempotent pipelines (ml4devs)](https://www.ml4devs.com/what-is/backfilling-data/) — re-runnable MERGE/UPSERT by business key
- [Data pipeline design patterns: idempotency, DLQ, CDC (dataskew.io, 2026)](https://dataskew.io/blog/data-pipeline-design-patterns/)
- XmartMenu code (choke points verified 2026-06-21): `src/app/api/stripe/webhooks/route.ts`, `src/app/api/onboarding/route.ts`, `src/app/api/stripe/connect/callback/route.ts`, `src/lib/tenant-plan.ts`
- `.planning/PROJECT.md` + auto-memory `xphere-crm-integration.md` — milestone constraints (single shared Xphere org, no Xphere repo edits, QStash transport, owner-only Contact)

---
*Feature research for: outbound product→CRM lifecycle sync (XmartMenu → Xphere), milestone v2.4*
*Researched: 2026-06-20 · code-re-verified: 2026-06-21*
