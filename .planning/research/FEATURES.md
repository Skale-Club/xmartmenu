# Feature Research

**Domain:** Outbound product→CRM lifecycle sync (XmartMenu tenants mirrored into Xphere CRM)
**Researched:** 2026-06-20
**Milestone:** v2.4 CRM & Integrations — Xphere CRM Sync
**Downstream consumer:** Requirements definition — feature list grouped by category, each marked table-stakes/differentiator/anti-feature, with complexity + XmartMenu code dependencies
**Confidence:** HIGH

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

## Lifecycle Event → CRM Effect Mapping

The heart of the feature. Each event is emitted from an existing XmartMenu choke point, enqueued to
QStash with `external_id = tenants.id`, and produces a deterministic Opportunity move. Every sync
call **upserts Account + Contact first** (re-asserting identity from current DB state) before
touching the Opportunity — so a missed earlier event never leaves the three objects incoherent
(self-healing replay).

| # | Lifecycle event | Source (existing XmartMenu code) | Opportunity stage → | Tags | custom_fields snapshot | Timeline note |
|---|---|---|---|---|---|---|
| 1 | **Signup / onboarding** (tenant + store-admin + entry `tenant_subscriptions` created) | `src/app/api/onboarding/route.ts` — after subscription insert (step 3b) | `Onboarding` | `source:xmartmenu`, `plan:menu` | tenant slug, business_type, plan slug, billing_cycle, created_at | "Tenant onboarded on XmartMenu (plan: menu)" |
| 2 | **Plan activated** (paid checkout completes) | `stripe/webhooks` → `checkout.session.completed` (`metadata.kind==='plan'`) | `Active` / `Won` | `plan:<slug>`, `status:active` | plan slug, MRR, billing_cycle, stripe_customer_id, period_end | "Plan activated: <plan> (<cycle>)" |
| 3 | **Plan changed / upgrade / downgrade** | `stripe/webhooks` → `customer.subscription.updated` (`kind==='plan'`, plan_id differs) | stays `Active`; **amount/MRR updated** | swap `plan:*`; add `upgrade` or `downgrade` | new plan slug, new MRR, prev plan slug, change direction | "Plan upgraded menu→orders" / "downgraded orders→menu" |
| 4 | **Payment past_due** (dunning) | `stripe/webhooks` → `invoice.payment_failed` **and** `customer.subscription.updated` status `past_due`/`unpaid` | `At Risk` | add `status:past_due`; remove `status:active` | status, current_period_end, dunning_since | "Payment failed — subscription past_due" |
| 5 | **Churn / cancellation** | `stripe/webhooks` → `customer.subscription.deleted` (or `.updated` status `canceled`) | `Lost` / `Churned` | add `status:churned`; remove `status:active`/`past_due` | churned_at, last plan slug, cancel_at_period_end | "Subscription cancelled / churned" |
| 6 | **Stripe Connect connected** (payments-tier tenant links account) | Connect OAuth callback route + `stripe/webhooks` → `account.updated` (`charges_enabled`) | stays current; **flag set** | `connect:active` (or `connect:disabled` when `charges_enabled=false`) | stripe_account_id, charges_enabled, payouts_enabled | "Stripe Connect connected (charges enabled)" |
| 7 | **First paid order** (OPTIONAL — differentiator) | `stripe/webhooks` → `payment_intent.succeeded` (first for tenant) | stays current; activation signal | add `activated` (one-time) | first_order_at, first_order_total | "First paid order received — tenant is live" |

### Mapping principles (apply to every event)

- **Account + Contact upsert runs first and is idempotent.** Each sync re-asserts Account
  name/slug + contact email from current DB. A missed event is repaired by the next one.
  ([Salesforce — self-healing replays / upsert-by-ExternalId](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360_integration_patterns_and_practices))
- **Stage moves are explicit, never inferred.** Each event maps to exactly one target stage. The
  pipeline stages (`Onboarding → Active → At Risk → Churned`, plus `Won`/`Lost`) are configured
  **data-only in the Xphere org UI/MCP**, not in repo code (milestone constraint).
- **custom_fields = a snapshot of current truth, not an event log.** Each sync overwrites the
  snapshot with the latest resolved values. Resolve plan + MRR via **`getTenantPlan(tenantId)`**
  (`src/lib/tenant-plan.ts`) — never read raw `plans.monthly_price`, because grandfathered tenants
  carry `override_*` values.
- **Tags are additive + idempotent**; status tags are mutually exclusive (set new, drop stale).
- **Timeline notes are append-only, deduplicated by event id.** Carry the originating Stripe
  `event.id` (or `onboarding:<tenant_id>`) so QStash redelivery / Stripe retries don't double-post.

---

## Feature Landscape

For an internal CRM-mirror integration, "users" = the **superadmin / RevOps operator** who lives in
Xphere and the **engineer** who owns reliability.

### Table Stakes (Users Expect These)

Non-negotiable for the integration to be trustworthy. Missing any of these = an incomplete or
untrustworthy mirror.

| Feature | Why Expected | Complexity | Dependencies / Notes |
|---------|--------------|------------|----------------------|
| **Transport spine** — `src/lib/xphere/` (client+mapping+types) + QStash producer + `/api/internal/xphere-sync` worker | Nothing syncs without it; everything depends on it | MEDIUM | New code. Worker must verify QStash signing keys, be idempotent, write `xphere_*` columns. |
| **`tenants` migration** — `xphere_account_id`, `xphere_contact_id`, `xphere_opportunity_id`, `xphere_synced_at`, `xphere_sync_error` | Per-tenant sync state must be queryable | LOW | New columns; `external_id = tenants.id` already exists as PK. |
| **Onboarding sync (event #1)** → Account+Contact+Opportunity (Onboarding stage) | Every tenant must exist in CRM from day 1; missing tenants = blind RevOps | MEDIUM | Hook in `onboarding/route.ts` **after step 3b** subscription insert. Enqueue, do NOT block the 201. |
| **Plan activated (event #2)** → Active/Won + MRR | Revenue is the whole point of mirroring subscriptions | MEDIUM | `checkout.session.completed` branch; resolve MRR via `getTenantPlan`. |
| **Past_due (event #4)** → At Risk + tag | Dunning visibility is core lifecycle; hiding it hides churn risk | LOW | Reuse existing `invoice.payment_failed` + `past_due` branches. |
| **Churn (event #5)** → Lost/Churned + tag | Closing the cancellation loop is expected of any lifecycle sync | LOW | `customer.subscription.deleted` / status `canceled` branch. |
| **Idempotent upsert by `external_id`** | Replays/retries must never duplicate Accounts/Opportunities | LOW (contract handles it) | Producer's only job: always send `external_id`. |
| **One-time backfill** of existing tenants (superadmin route) | Existing tenants must populate the pipeline, not just new signups | MEDIUM | Iterates `tenants`, enqueues a `full-sync` per tenant. Idempotent → safe to re-run. |
| **Error surfacing (`xphere_sync_error`)** | A silent failed sync is worse than none — operator must know | LOW–MEDIUM | Worker writes last error on failure, clears on success. Surface in superadmin tenant detail. |
| **Manual re-sync (single tenant)** | Operator needs one-click retry after an error, no code | LOW | Superadmin button → enqueue `full-sync` for that tenant. |
| **Async / non-blocking delivery** | A CRM outage must never break onboarding or Stripe webhook 200s | MEDIUM | QStash decouples; producers only enqueue. Critical: never `await` the CRM call inline. |
| **Retry with backoff** | Transient CRM/network failures must self-recover | LOW (QStash handles it) | QStash retries on non-2xx from the worker; keep the worker idempotent. |

### Differentiators (Competitive Advantage)

Make the mirror genuinely useful for RevOps rather than just "data present."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Plan upgrade/downgrade direction tag (event #3) | Spot expansion vs contraction without reading raw plan history | LOW | Compare prev vs new `plan_id` in `subscription.updated`; emit `upgrade`/`downgrade`. |
| Stripe Connect connected flag (event #6) | Marks payments-tier activation — strong product-qualified signal | MEDIUM | Connect callback + `account.updated`; `connect:active`/`connect:disabled`. |
| MRR snapshot in custom_fields | Opportunity amount reflects real revenue incl. grandfathered overrides | LOW | Resolve via `getTenantPlan` (applies overrides). |
| Timeline notes per transition | Human-readable history in CRM ("upgraded menu→orders on X") | LOW | Append-only, deduped by Stripe `event.id`. |
| Backfill dry-run / report mode | Operator previews what backfill would change before firing for all tenants | MEDIUM | Count + per-tenant intended action, no enqueue. Reduces backfill anxiety. |
| Superadmin sync dashboard (synced / errored / never-synced counts) | At-a-glance health of the whole mirror | MEDIUM | Aggregate `xphere_synced_at` / `xphere_sync_error` across `tenants`. |
| First paid order activation signal (event #7) | "Tenant is truly live" CSM trigger milestone | MEDIUM | `payment_intent.succeeded` + first-order detection (e.g. `tenants.first_paid_order_at`). |

### Anti-Features (Commonly Requested, Often Problematic)

Explicit do-not-build list — hard constraints for the roadmap.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Two-way / bidirectional sync** (CRM edits flow back to XmartMenu) | "Keep both systems in sync" sounds complete | Conflict resolution, loop prevention, RLS/security surface, a write path INTO the app DB from outside — huge scope + real data-integrity risk | **One-way outbound only.** XmartMenu DB stays source of truth; CRM is a downstream mirror. |
| **Per-tenant CRM orgs** (one Xphere org per restaurant) | Feels "isolated" per customer | Org/provisioning explosion, API-key sprawl, defeats RevOps (can't see the book of business in one place) | **Single shared XmartMenu Xphere org** (`e375f031-…`); tenants are Accounts within it. |
| **Synchronous/inline sync in the webhook** | "Instant" CRM updates | Couples Stripe/onboarding success to CRM uptime; a CRM 500 makes Stripe retry forever or breaks onboarding | **Enqueue to QStash**, return 200 immediately. Eventual consistency is fine for a CRM. |
| **Syncing every order / per-order revenue line** | "Full revenue picture in CRM" | High volume, noisy timeline, turns CRM into an order log | **First paid order only** (optional). Aggregate revenue stays in Stripe/analytics. |
| **Modifying the Xphere repo** (custom endpoints/schema) | Convenient to "just add a field" | Out of scope — `/api/v1/sync`, `external_id`, `sync:write` owned by the separate Xtimator effort | **Build against the documented contract.** Pipeline stages configured data-only in Xphere UI/MCP. |
| **Caching CRM data back in XmartMenu** (Opportunity fields stored locally) | "Show CRM status in admin" | Duplicates source of truth, goes stale, invites the two-way temptation | Store only **CRM ids + sync metadata** (`xphere_*_id`, `synced_at`, `sync_error`). |
| **Custom retry/queue implementation** | "We control retries" | Reinvents QStash; adds cron, DLQ, backoff to maintain | **Use QStash** retries + signing-key verification on the worker. |
| **Per-staff-member Contacts** | "Sync everyone" | store-staff are read-only operational users, not buying contacts; noise in CRM | **Contact = store-admin (owner) only.** |

---

## Feature Dependencies

```
Transport spine (src/lib/xphere/ + QStash producer + /api/internal/xphere-sync worker)
    └──requires──> tenants migration (xphere_* columns)
    └──requires──> Xphere /api/v1/sync contract + XPHERE_API_KEY + XPHERE_ORG_ID
    └──requires──> QSTASH_TOKEN + signing keys

Onboarding hook (event #1) ──requires──> transport spine
Stripe lifecycle hooks (#2–#6) ──requires──> transport spine
    └──requires──> stripe/webhooks/route.ts (existing choke point; add enqueue per branch)
    └──requires──> getTenantPlan() for MRR/plan resolution (src/lib/tenant-plan.ts)

Backfill route (superadmin) ──requires──> transport spine (reuses full-sync event shape)
    └──enhances──> observability (populates xphere_synced_at across all tenants)

Observability (sync status / error / re-sync) ──requires──> xphere_* columns
    └──enhances──> Manual re-sync (re-enqueues full-sync for one tenant)

Two-way sync ──conflicts──> one-way source-of-truth model (DO NOT BUILD)
Per-tenant CRM orgs ──conflicts──> single shared Xphere org (DO NOT BUILD)
```

### Dependency Notes

- **Build the transport spine first.** All hooks are thin: resolve `tenant_id` → enqueue. The
  `src/lib/xphere/` client + mapping + types + QStash producer + `/api/internal/xphere-sync` worker
  must exist before wiring any lifecycle event.
- **Stripe hooks slot into the existing `switch`.** `stripe/webhooks/route.ts` already branches on
  `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`,
  and `account.updated` with `metadata.kind==='plan'` gating. Add an **enqueue** call at the end of
  each relevant branch **after the DB update succeeds** — the CRM only learns about state the app has
  already committed. Do NOT enqueue before the `tenant_subscriptions` update; do NOT enqueue inside
  the failure path (where the handler returns 500 for Stripe retry).
- **MRR/plan must be resolved, not read raw.** `getTenantPlan()` applies `override_*` and
  grandfathering; raw `plans.monthly_price` would misstate revenue for custom-priced tenants.
- **Onboarding hook fires after step 3b** (the `tenant_subscriptions` insert), so Account + Contact +
  Opportunity are all derivable in one call. The resume path (tenant exists, menu missing) and the
  `already_configured` early-return are both safe to enqueue again because of `external_id`.
- **Connect is a second producer**, not only the webhook: the OAuth callback confirms the link;
  `account.updated` keeps `charges_enabled` fresh. Both enqueue the same connect-flag event.

---

## MVP Definition

### Launch With (v1) — P1

- [ ] Transport spine — `src/lib/xphere/` + QStash producer + signature-verified, idempotent worker
- [ ] `tenants` migration — `xphere_account_id/contact_id/opportunity_id/synced_at/sync_error`
- [ ] Event #1 Onboarding → Account+Contact+Opportunity (Onboarding stage)
- [ ] Event #2 Plan activated → Active/Won + MRR snapshot
- [ ] Event #4 Past_due → At Risk
- [ ] Event #5 Churn → Lost/Churned
- [ ] One-time backfill route (superadmin), idempotent re-runnable
- [ ] Observability v1 — `xphere_sync_error` surfaced in superadmin tenant detail + manual re-sync button

### Add After Validation (v1.x) — P2

- [ ] Event #3 Plan upgrade/downgrade direction tags
- [ ] Event #6 Stripe Connect connected flag
- [ ] Backfill dry-run / report mode
- [ ] Superadmin sync health dashboard (synced/errored/never-synced counts)

### Future Consideration (v2+) — P3

- [ ] Event #7 First paid order activation signal (needs first-order detection)
- [ ] Templated / richer timeline notes — polish once stages + tags are stable

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Transport spine (xphere lib + QStash worker) | HIGH | MEDIUM | P1 |
| `tenants` xphere_* migration | HIGH | LOW | P1 |
| Event #1 Onboarding sync | HIGH | MEDIUM | P1 |
| Event #2 Plan activated + MRR | HIGH | MEDIUM | P1 |
| Event #4 Past_due → At Risk | HIGH | LOW | P1 |
| Event #5 Churn → Churned | HIGH | LOW | P1 |
| One-time backfill route | HIGH | MEDIUM | P1 |
| Error surfacing + manual re-sync | HIGH | LOW | P1 |
| Event #3 upgrade/downgrade tags | MEDIUM | LOW | P2 |
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
| Idempotency | Record dedup by property | Upsert on `ExternalId` (idempotent record writes) | Upsert on `external_id = tenants.id` |
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
| Lifecycle event set + stage mapping | HIGH | Standard SaaS lifecycle (HubSpot/Salesforce) + XmartMenu's existing Stripe branches verified in code |
| One-way + idempotent-upsert + backfill pattern | HIGH | Salesforce integration patterns + idempotent-pipeline literature; mapping already decided |
| Async via queue (non-blocking) as table stakes | HIGH | Direct read of `stripe/webhooks/route.ts` (500-on-failure retry contract makes inline sync unsafe) |
| Anti-features (two-way, per-tenant orgs) | HIGH | Explicit milestone constraints in PROJECT.md + integration best practice |
| Observability scope (status/error/re-sync) | MEDIUM–HIGH | Standard for internal integrations; exact superadmin UI surface depends on existing admin patterns |

---

## Sources

- [HubSpot — Use contact and company lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages) — lifecycle stage model (Onboarding/Active/At-Risk/Churned)
- [HubSpot — Automatically set and sync record lifecycle stages](https://knowledge.hubspot.com/object-settings/manage-how-lifecycle-stages-sync-between-objects) — event-driven stage propagation
- [Salesforce — Data 360 integration patterns](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360_integration_patterns_and_practices) — upsert by ExternalId, self-healing replays, webhook-live + scheduled-backfill
- [Salesforce — Idempotent record writes](https://help.salesforce.com/s/articleView?id=release-notes.rn_api_idempotent_records.htm&language=en_US&release=240&type=5) — prevent duplication on replay
- [Backfilling historical data with idempotent pipelines (ml4devs)](https://www.ml4devs.com/what-is/backfilling-data/) — re-runnable backfill (MERGE/UPSERT by business key)
- [Data pipeline design patterns: idempotency, DLQ, CDC (dataskew.io, 2026)](https://dataskew.io/blog/data-pipeline-design-patterns/) — idempotency + retry patterns
- [SaaS onboarding CRM playbook 2026 (digitalapplied.com)](https://www.digitalapplied.com/blog/saas-customer-onboarding-email-sequence-2026-crm-playbook) — event-driven over calendar-driven
- [Best SaaS CRM 2026 (ustechautomations.com)](https://ustechautomations.com/resources/blog/best-saas-crm-2026) — subscription lifecycle stages + billing integration
- XmartMenu existing code (verified choke points + plan resolution): `src/app/api/stripe/webhooks/route.ts`, `src/app/api/onboarding/route.ts`, `src/lib/tenant-plan.ts`
- `.planning/PROJECT.md` — milestone constraints (single shared Xphere org, no Xphere repo edits, QStash transport)

---
*Feature research for: outbound product→CRM lifecycle sync (XmartMenu → Xphere), milestone v2.4*
*Researched: 2026-06-20*
