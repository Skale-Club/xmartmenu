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
- ✅ **v2.0 Monetization** — Phases 30-34 (shipped 2026-05-09)
- ✅ **v2.1 Custom Domains** — Phase 35 (shipped 2026-05-10)
- 🚧 **v2.2 Restaurant Growth Platform** — Phases 36+ (in progress — Phase 36 English Conversion complete 2026-05-19)

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

<details>
<summary>✅ v2.0 Monetization (Phases 30-34) — SHIPPED 2026-05-09</summary>

SEED-009: Plans, Pricing & Stripe Connect Monetization

| # | Phase | Plans | Status |
|---|---|---|---|
| 30 | Schema + Planos Base | 1/1 | ✅ 2026-05-09 |
| 31 | Superadmin Plan Management | 1/1 | ✅ 2026-05-09 |
| 32 | Stripe Connect OAuth | 1/1 | ✅ 2026-05-09 |
| 33 | Payment Intent + Webhook | 1/1 | ✅ 2026-05-09 |
| 34 | Tenant Subscription UI | 1/1 | ✅ 2026-05-09 |

Key Requirements:
- MON-01: Plans table with monthly/annual pricing, transaction fee
- MON-02: Tenant subscriptions with billing cycle and override support
- MON-03: Stripe Connect integration for tenant payments
- MON-04: Feature gating based on plan type (menu/orders/payments)
- MON-05: Webhook handlers with idempotency

</details>

---

## Phases

- [x] **Phase 35: Custom Domain Infrastructure** — DB migration + middleware hostname routing + admin UI + DNS instructions (shipped 2026-05-10, commit 6781d06)
- [x] **Phase 36: English Conversion** — All 17 operator-facing files converted to English; ENGL-01 through ENGL-06 certified (shipped 2026-05-19, Plans 01+02)

---

## Phase Details

### Phase 36: English Conversion

**Goal:** Convert all operator-facing UI text from Portuguese to English across admin panel, superadmin panel, KDS, onboarding wizard, settings pages, and API error messages.

**Depends on:** Phase 35

**Requirements:** ENGL-01, ENGL-02, ENGL-03, ENGL-04, ENGL-05, ENGL-06

**Status:** Shipped 2026-05-19

**Plans:**
| # | Plan | Description | Status |
|---|------|-------------|--------|
| 01 | Admin Settings + Superadmin Panel | 15 Custom Domain strings + 7 error strings/comments | 2/2 ✅ |
| 02 | Verification Scan | Full grep scan confirms zero Portuguese strings | 2/2 ✅ |

---

### Phase 35: Custom Domain Infrastructure

**Goal:** Allow tenants to use their own custom domain (e.g., `sitedocliente.com`) instead of platform subdomain (`xmartmenu.skale.club/nomedocliente`)

**Depends on:** Phase 34 (previous milestone complete)

**Requirements:** DOM-01.1, DOM-01.2, DOM-01.3, DOM-01.4, DOM-01.5, DOM-01.6

**Success Criteria** (what must be TRUE):

1. Tenant can enter a custom domain in admin settings and save it to database
2. Middleware resolves tenant by `host` header when it matches a registered custom_domain
3. Customers accessing `customdomain.com` see the tenant's menu without requiring slug prefix in URL
4. Admin UI displays CNAME instructions telling tenant to point their domain to the platform
5. System validates custom domain resolves to platform before allowing activation

**Plans**: TBD

**UI hint**: yes