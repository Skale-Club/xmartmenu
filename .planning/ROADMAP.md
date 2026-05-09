# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- ✅ **v1.2 AI Onboarding** — Phases 9-11 (shipped 2026-05-07)
- ✅ **v1.3 Landing Page** — Phases 12-13 (shipped 2026-05-07)
- ✅ **v1.4 Performance** — Phases 14-17 (shipped 2026-05-08)
- ✅ **v1.5 Image Optimization** — Phases 18-20 (shipped 2026-05-08)
- ✅ **v1.6 Operations** — Phases 21-22 (shipped 2026-05-08)
- ✅ **v1.7 Customization** — Phases 23-25 (shipped 2026-05-08)
- ✅ **v1.8 KDS+** — Phases 26-27 (shipped 2026-05-08)
- ✅ **v1.9 Performance Gaps** — Phases 28-29 (shipped 2026-05-08)
- 🚧 **v2.0 Monetization** — SEED-009 (in progress)

## Current Milestone: v2.0 Monetization

SEED-009: Plans, Pricing & Stripe Connect Monetization

### Phase Overview

| # | Phase | Description | Status |
|---|---|---|---|
 | 30 | Schema + Planos Base | Migration plans/tenant_subscriptions/stripe_connections tables, seed 3 plans, types, getTenantPlan helper | ✅ 2026-05-09 |
| 31 | Superadmin Plan Management | /superadmin/plans CRUD, tenant subscription override UI | ⏳ Pending |
| 32 | Stripe Connect OAuth | OAuth flow, connect/disconnect endpoints, tenant UI | ⏳ Pending |
| 33 | Payment Intent + Webhook | Stripe payment processing, webhook handlers, idempotency | ⏳ Pending |
| 34 | Tenant Subscription UI | Tenant-facing subscription panel, upgrade flow | ⏳ Pending |

### Key Requirements (from SEED-009)

- MON-01: Plans table with monthly/annual pricing, transaction fee
- MON-02: Tenant subscriptions with billing cycle and override support
- MON-03: Stripe Connect integration for tenant payments
- MON-04: Feature gating based on plan type (menu/orders/payments)
- MON-05: Webhook handlers with idempotency

## Completed Milestones

<details>
<summary>✅ v1.0 Foundation (Phases 1-3) — SHIPPED 2026-05-06</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 Orders (Phases 4-8) — SHIPPED 2026-05-06</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.2 AI Onboarding (Phases 9-11) — SHIPPED 2026-05-07</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.3 Landing Page (Phases 12-13) — SHIPPED 2026-05-07</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.4 Performance (Phases 14-17) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.5 Image Optimization (Phases 18-20) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.6 Operations (Phases 21-22) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.7 Customization (Phases 23-25) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.8 KDS+ (Phases 26-27) — SHIPPED 2026-05-08</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 26 | Schema + Settings | 1/1 | ✅ 2026-05-08 |
| 27 | Filter Chips + Sound | 1/1 | ✅ 2026-05-08 |

See `.planning/milestones/v1.8-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.9 Performance Gaps (Phases 28-29) — SHIPPED 2026-05-08</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 28 | DB + CDN | 1/1 | ✅ 2026-05-08 |
| 29 | MenuPage Decomposition | 1/1 | ✅ 2026-05-08 |

See `.planning/milestones/v1.9-ROADMAP.md` for full details.

</details>
