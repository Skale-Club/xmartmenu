# v2.4 Requirements — CRM & Integrations (Xphere CRM Sync)

**Goal:** Mirror every XmartMenu tenant into the dedicated Xphere CRM org (`e375f031-4d9a-42b1-9f3c-ade805650442`) as Account + Contact + Opportunity, tracking the full subscription lifecycle. One-way outbound only; XmartMenu DB stays the source of truth.

**Scope decided (2026-06-20):** P1 MVP core + upgrade/downgrade tags (#3) + Stripe Connect flag (#6). Backfill dry-run, sync health dashboard, and first-paid-order (#7) are deferred to Future.

**Hard constraint:** Do NOT modify the Xphere repo. `/api/v1/sync`, the `external_id` indexes, and the `sync:write` scope are built by the separate Xtimator effort. We build against the documented contract and configure pipeline stages + the API key data-only in the Xphere org. All code in English.

---

## In Scope

### Foundation — Schema & Transport (FND)

- [x] **FND-01**: The `tenants` table has columns `xphere_account_id`, `xphere_contact_id`, `xphere_opportunity_id` (text, nullable), `xphere_synced_at` (timestamptz), and `xphere_sync_error` (text) recording per-tenant CRM sync state (`external_id = tenants.id`).
- [ ] **FND-02**: `src/lib/xphere/` exposes (a) shared `types.ts` matching the documented `/api/v1/sync` contract, (b) a pure `mapping.ts` that turns a tenant + store-admin profile + subscription + reason into a request payload (`source='xmartmenu'`), and (c) a `client.ts` that POSTs to the Xphere endpoint with the API key and org id — the mapping is unit-testable offline with no network.
- [ ] **FND-03**: A QStash producer (`src/lib/xphere/queue.ts`) enqueues a thin `{ tenantId, reason }` message and is fail-open and non-blocking — when QStash/Xphere env is unset or the CRM is down, producing is a silent no-op that never blocks onboarding or a Stripe webhook response.
- [ ] **FND-04**: The worker route `POST /api/internal/xphere-sync` verifies the QStash signature against the raw request body (current + next signing keys), and only then re-reads live tenant + profile + subscription via the service-role client and calls Xphere.
- [ ] **FND-05**: The worker writes back `xphere_account_id`/`xphere_contact_id`/`xphere_opportunity_id` + `xphere_synced_at` on success and `xphere_sync_error` on failure (clearing it on the next success).
- [ ] **FND-06**: The sync is idempotent — re-delivery and retries upsert by `external_id = tenants.id` and never create duplicate Accounts/Contacts/Opportunities. Transient failures (5xx/429/network) return non-2xx so QStash retries; permanent failures (unknown pipeline stage, missing tenant) are routed to the DLQ (`489` + non-retryable) rather than retried forever.

### Lifecycle Sync (LIF)

- [ ] **LIF-01**: When a tenant finishes onboarding, the CRM has an Account + Contact (store-admin owner) + Opportunity in the `Onboarding` stage, enqueued after the subscription insert without blocking the onboarding response. *(event #1)*
- [ ] **LIF-02**: When a paid plan is activated (`checkout.session.completed`, `kind=plan`), the Opportunity moves to `Active`/`Won` with MRR resolved via `getTenantPlan()` (honoring `override_*`/grandfathering). *(event #2)*
- [ ] **LIF-03**: When a plan changes (`customer.subscription.updated`, plan differs), the Opportunity MRR is updated and an `upgrade` or `downgrade` direction tag is applied. *(event #3)*
- [ ] **LIF-04**: When payment goes past_due (`invoice.payment_failed` / status `past_due`), the Opportunity moves to `At Risk` and the status tag updates (`status:past_due`, drop `status:active`). *(event #4)*
- [ ] **LIF-05**: When a subscription is cancelled/churned (`customer.subscription.deleted` / status `canceled`), the Opportunity moves to `Lost`/`Churned` and the status tag updates. *(event #5)*
- [ ] **LIF-06**: When a payments-tier tenant connects or disables Stripe Connect (OAuth callback + `account.updated`), the CRM record reflects `connect:active` / `connect:disabled` with `charges_enabled`. *(event #6)*
- [ ] **LIF-07**: Each lifecycle transition appends a human-readable timeline note to the CRM contact, deduplicated by the originating event id (Stripe `event.id` or `onboarding:<tenant_id>`), so QStash redelivery and Stripe retries never double-post.

### Backfill (BKF)

- [ ] **BKF-01**: A superadmin-only route enqueues a full-sync for every existing tenant, throttled/rate-aware, and idempotent — safe to re-run without creating duplicates.

### Observability & Ops (OBS)

- [ ] **OBS-01**: The superadmin tenant detail surfaces the tenant's sync state (`xphere_synced_at`, `xphere_sync_error`) and provides a one-click manual re-sync that re-enqueues a full-sync for that tenant.
- [ ] **OBS-02**: Secrets (`XPHERE_API_KEY`, `QSTASH_TOKEN`, signing keys) are read only from server env — never `NEXT_PUBLIC`, never committed (gitleaks-safe) — and producing can be disabled via an env kill switch with no code change.

---

## Future Requirements (Deferred)

- First paid order activation signal (#7) — needs first-order detection (`tenants.first_paid_order_at` or a count query).
- Backfill dry-run / report mode — preview counts + per-tenant intended action before firing.
- Superadmin sync health dashboard — aggregate synced / errored / never-synced counts.
- Templated / richer timeline notes — polish once stages + tags are stable.

## Out of Scope (Explicit Exclusions)

- **Two-way / bidirectional sync** — CRM is a downstream mirror; XmartMenu DB is the single source of truth. No write path from CRM into the app.
- **Per-tenant CRM orgs** — all tenants are Accounts in the single shared XmartMenu Xphere org.
- **Synchronous/inline sync inside webhooks** — always enqueue to QStash and return 200 immediately.
- **Per-order / per-revenue-line syncing** — aggregate revenue stays in Stripe/analytics.
- **Modifying the Xphere repo** — `/api/v1/sync`, `external_id` migration/indexes, `sync:write` scope are the Xtimator effort's responsibility; pipeline stages are configured data-only in the Xphere org.
- **Caching CRM data back in XmartMenu** — store only CRM ids + sync metadata, never mirrored Opportunity fields.
- **Custom retry/queue implementation** — QStash owns retries/backoff/DLQ.
- **Per-staff-member Contacts** — Contact = store-admin (owner) only.

---

## Dependencies / Open Items (confirm before/at integration test)

- Exact `/api/v1/sync` request/response shape + idempotency-key header convention (owned by Xtimator) — isolate in `types.ts`/`client.ts`; confirm before finalizing `mapping.ts` tests.
- Live deployment target for the public QStash callback URL (Vercel vs the Coolify standalone container at `xmartmenu.skale.club`).
- Pipeline stages (`Onboarding → Active → At Risk → Churned`, plus `Won`/`Lost`) configured data-only in the Xphere org before live sync; worker errors clearly if a stage name is missing.
- Marketing-consent/opt-out and internal/test-tenant filtering before PII flows to the CRM.
- No test runner currently in `package.json` — a phase may introduce `vitest` for `mapping.ts` pure-function tests, or use `tsx` scripts per existing `scripts/` convention.

---

## Traceability

Every v2.4 requirement maps to exactly one phase. 100% coverage (16/16).

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 50 — Schema & Contract | Complete |
| FND-02 | Phase 50 — Schema & Contract | Pending |
| FND-04 | Phase 51 — Worker + Client | Pending |
| FND-05 | Phase 51 — Worker + Client | Pending |
| FND-06 | Phase 51 — Worker + Client | Pending |
| FND-03 | Phase 52 — Producer Hooks | Pending |
| LIF-01 | Phase 52 — Producer Hooks | Pending |
| LIF-02 | Phase 52 — Producer Hooks | Pending |
| LIF-03 | Phase 52 — Producer Hooks | Pending |
| LIF-04 | Phase 52 — Producer Hooks | Pending |
| LIF-05 | Phase 52 — Producer Hooks | Pending |
| LIF-06 | Phase 52 — Producer Hooks | Pending |
| LIF-07 | Phase 52 — Producer Hooks | Pending |
| BKF-01 | Phase 53 — Backfill | Pending |
| OBS-01 | Phase 54 — Observability & Ops | Pending |
| OBS-02 | Phase 54 — Observability & Ops | Pending |

**Phase 55 (Live Conformance Test)** carries no new requirement — it verifies FND/LIF/BKF/OBS against the real Xtimator-owned `/api/v1/sync` endpoint and is BLOCKED on that external dependency.

### Coverage Summary

| Phase | Requirements | Count |
|-------|--------------|-------|
| 50 — Schema & Contract | FND-01, FND-02 | 2 |
| 51 — Worker + Client | FND-04, FND-05, FND-06 | 3 |
| 52 — Producer Hooks | FND-03, LIF-01..07 | 8 |
| 53 — Backfill | BKF-01 | 1 |
| 54 — Observability & Ops | OBS-01, OBS-02 | 2 |
| 55 — Live Conformance (deferred) | (verification only) | 0 |
| **Total** | | **16/16** |
