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
- ✅ **v2.2 Restaurant Growth Platform** — Phases 36-43 (shipped 2026-05-19)

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

<details>
<summary>✅ v2.1 Custom Domains (Phase 35) — SHIPPED 2026-05-10</summary>

SEED-010: Custom domain routing per tenant

| # | Phase | Plans | Status |
|---|---|---|---|
| 35 | Custom Domain Infrastructure | 1/1 | ✅ 2026-05-10 |

Key accomplishments:
- Migration 029: `custom_domain TEXT + custom_domain_verified BOOLEAN` on `tenants` table
- Middleware hostname-based tenant resolution via `resolveTenantSlugFromHost()` with 60s cache
- Admin UI: custom domain section in Store Settings with save, verify DNS, CNAME instructions
- DNS verification endpoint via `dns.lookup()` comparing custom domain IP to platform IP
- Rewrite-based routing: custom domain requests proxy to `/${tenantSlug}${pathname}`

</details>

---

## Phases

- [x] **Phase 35: Custom Domain Infrastructure** — DB migration + middleware hostname routing + admin UI + DNS instructions
- [x] **Phase 36: English Conversion** — Migrate all operator-facing UI text from Portuguese to English across admin, superadmin, onboarding, KDS, settings, and error messages (completed 2026-05-19)
- [x] **Phase 37: Color Theming** — DB migration + server-side CSS injection + admin color picker + smart defaults for new tenants (completed 2026-05-19)
- [x] **Phase 38: Order Types — Admin & Schema** — DB migration for order type flags and config + admin settings UI (dine-in/pick-up/delivery toggles + fee/time fields) (completed 2026-05-19)
- [x] **Phase 39: Order Types — Customer & Operational** — Customer order type selector + delivery address field + fee in cart total + KDS fulfillment badges + orders filter
- [x] **Phase 40: Multi-Location — Schema & Admin CRUD** — DB migration for branches table + admin branch management UI (create/edit/deactivate)
- [x] **Phase 41: Multi-Location — Routing, QR Codes & Menu Toggle** — Slug-based branch routing + root branch picker + per-branch QR codes + shared/independent menu toggle + KDS/orders branch filter
- [x] **Phase 42: SEO — Platform & Per-Tenant** — Dynamic metadata, OG image per tenant, LocalBusiness + MenuItem JSON-LD, canonical URLs, per-domain robots.txt, tenant sitemap
- [x] **Phase 43: SEO — Per-Branch Local SEO** — Per-branch LocalBusiness JSON-LD with branchOf link (depends on Phase 41 branch routing)
- [ ] **Phase 44: Zero Hardcoded Values** — Migration 045 (cta_color/seo_title/seo_description) + landing page CMS wiring + marketing generateMetadata + superadmin app_name + public menu footerBrand

---

## Phase Details

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

**Plans**: Complete

**UI hint**: yes

---

### Phase 36: English Conversion

**Goal:** All operator-facing UI surfaces display in English — admin panel, superadmin panel, onboarding, KDS, settings, and validation messages

**Depends on:** Phase 35

**Requirements:** ENGL-01, ENGL-02, ENGL-03, ENGL-04, ENGL-05, ENGL-06

**Success Criteria** (what must be TRUE):

1. Admin panel navigation, buttons, headings, and form labels are readable in English by a non-Portuguese speaker
2. Superadmin panel table headers, action buttons, and modal titles are in English
3. Onboarding wizard step titles, instructions, and CTAs guide a new restaurant owner through setup in English
4. KDS status labels, filter chips, and time labels are in English so a kitchen operator can use the display without Portuguese knowledge
5. All error and validation messages (form errors, API failures) displayed in admin UI are in English

**Plans**: 2 plans

Plans:
- [x] 36-01-PLAN.md — Convert Custom Domain section (StoreClient) + superadmin error strings (TenantsClient, SettingsClient) + admin layout comments to English
- [ ] 36-02-PLAN.md — Full grep verification scan across all 17 operator-facing files; confirm KDS, onboarding, sidebar unchanged

**UI hint**: yes

---

### Phase 37: Color Theming

**Goal:** Tenants can personalize their public menu with custom brand colors that are applied server-side with no flash of unstyled content

**Depends on:** Phase 36

**Requirements:** THEME-01, THEME-02, THEME-03, THEME-04

**Success Criteria** (what must be TRUE):

1. Tenant admin can open branding settings, pick primary and secondary colors via a color picker, save them, and see the values persisted on next load
2. Public menu page loads with the tenant's brand colors already applied — no color flash on initial render
3. All interactive elements on the public menu (buttons, category pills, cart badge, modal headers) visually reflect the tenant's chosen colors
4. A new tenant who has never touched theming settings sees a sensible default color palette (not white/black defaults) when their menu page first loads

**Plans**: 2 plans

Plans:
- [x] 37-01-PLAN.md — color-utils.ts luminance util + globals.css --accent vars + server-side CSS injection in both public page.tsx routes + BrandingClient preset chips
- [x] 37-02-PLAN.md — MenuPage/CartModal hardcoded color audit + onboarding API smart default palette

**UI hint**: yes

---

### Phase 38: Order Types — Admin & Schema

**Goal:** Restaurants can independently enable or disable dine-in, pick-up, and delivery modes, and configure the associated pick-up time and delivery fee

**Depends on:** Phase 37

**Requirements:** ORD-01, ORD-02, ORD-03

**Success Criteria** (what must be TRUE):

1. Admin settings page shows three independent toggles for dine-in, pick-up, and delivery — saving is blocked when all three are deactivated
2. When pick-up is toggled on, admin can set an estimated pick-up time in minutes; the value is saved and reloaded on next visit
3. When delivery is toggled on, admin can set a delivery fee amount; the value is saved and reloaded on next visit
4. DB migration is applied — new columns or table storing order type flags and configuration are present in the schema

**Plans**: 2 plans

Plans:
- [x] 38-01-PLAN.md — Migration 034 (5 columns on tenant_settings with IF NOT EXISTS guards) + apply-migration-034.mjs runner + TenantSettings TypeScript interface update
- [ ] 38-02-PLAN.md — StoreClient.tsx "Order Types" section (3 toggles + conditional ETA/fee fields + all-off validation)

**UI hint**: yes

---

### Phase 39: Order Types — Customer & Operational

**Goal:** Customers see and interact with the order type selector at checkout, and kitchen staff can see fulfillment type on every order card and filter by it

**Depends on:** Phase 38

**Requirements:** ORD-04, ORD-05, ORD-06, ORD-07

**Success Criteria** (what must be TRUE):

1. Customer sees an order type selector only when two or more modes are active; when only dine-in is active the selector is hidden
2. Selecting delivery reveals a required address field and adds the configured delivery fee to the visible cart total
3. Every order record in the database stores its order type and delivery address; KDS cards display a fulfillment badge indicating the type
4. Admin orders view includes a filter control that narrows the list to a specific order type

**Plans**: 3 plans

Plans:
- [x] 39-01-PLAN.md — Migration 035 (order_type + delivery_address on orders) + API POST update + Order interface update
- [x] 39-02-PLAN.md — CartModal order type chips + delivery address input + fee display; MenuPage state + POST body
- [x] 39-03-PLAN.md — OrderCard fulfillment badge + OrdersClient order type filter row

**UI hint**: yes

---

### Phase 40: Multi-Location — Schema & Admin CRUD

**Goal:** Tenants can create and manage multiple branch locations, each with its own name, address, contact details, operating hours, and URL slug

**Depends on:** Phase 39

**Requirements:** LOC-01, LOC-02

**Success Criteria** (what must be TRUE):

1. Admin can navigate to a branches section, create a new branch with name, address, city, phone, hours, and slug — the branch is saved and listed
2. Admin can edit any branch detail and deactivate a branch; deactivated branches no longer appear in public routing
3. A tenant with a single branch has no observable change to their public-facing URL — the menu continues to serve at the root URL
4. DB migration is applied — `locations` table (or equivalent) exists in the schema with RLS isolation per tenant

**Plans**: TBD

**UI hint**: yes

---

### Phase 41: Multi-Location — Routing, QR Codes & Menu Toggle

**Goal:** Multi-location tenants have per-branch URLs and QR codes; customers landing on the root domain see a branch picker; admins can choose shared vs. independent menus per branch

**Depends on:** Phase 40

**Requirements:** LOC-03, LOC-04, LOC-05, LOC-06

**Success Criteria** (what must be TRUE):

1. A multi-location tenant's root URL shows a branch picker listing active branches — not a menu; clicking a branch navigates to `restaurantsite.com/[branch-slug]/`
2. Each branch URL (`/[branch-slug]/`) renders the correct menu for that branch
3. Admin can download or display a QR code specific to each branch, pointing to that branch's URL
4. Admin can toggle shared-menu vs. independent-menu mode per branch; default is shared
5. KDS and admin orders view can be filtered by branch; each order record stores its location_id

**Plans**: TBD

**UI hint**: yes

---

### Phase 42: SEO — Platform & Per-Tenant

**Goal:** Each tenant's public menu pages are fully discoverable by search engines with correct metadata, structured data, canonical URLs, and sitemaps

**Depends on:** Phase 37 (colors needed for OG image brand rendering)

**Requirements:** SEO-01, SEO-02, SEO-03, SEO-04, SEO-05, SEO-06, SEO-07

**Success Criteria** (what must be TRUE):

1. A search engine crawling a tenant menu page receives a `<title>` and `<meta description>` derived from the tenant name and description — not generic platform defaults
2. The OG image for a tenant's page includes the tenant logo and brand colors — sharing the link on social or WhatsApp renders the branded card
3. A structured-data validator (e.g., Google Rich Results Test) confirms valid `LocalBusiness` JSON-LD with name, address, phone, hours, and cuisine type
4. Active menu items appear in `MenuItem` JSON-LD on the page, making them eligible for recipe/menu rich results
5. Platform-slug URLs include a canonical pointing to the custom domain when one is active; the platform slug returns a disallow in robots.txt when a custom domain is configured
6. Fetching `/{tenantSlug}/sitemap.xml` returns a valid sitemap listing all indexable URLs for that tenant

**Plans**: TBD

**UI hint**: no

---

### Phase 43: SEO — Per-Branch Local SEO

**Goal:** Each active branch has its own local business structured data linked back to the parent tenant, enabling branch-level search discoverability

**Depends on:** Phase 41 (branch routing must exist before per-branch SEO can reference branch URLs)

**Requirements:** SEO-08

**Success Criteria** (what must be TRUE):

1. A branch menu page (`/[branch-slug]/`) includes `LocalBusiness` JSON-LD with the branch name, address, phone, and hours — distinct from the parent tenant's JSON-LD
2. The branch `LocalBusiness` JSON-LD contains a `branchOf` property linking to the parent tenant's `LocalBusiness` entity
3. A structured-data validator confirms the branch JSON-LD is valid and the `branchOf` relation resolves to the correct parent

**Plans**: TBD

**UI hint**: no

---

### Phase 44: Zero Hardcoded Values — tornar tudo configurável via painel do superadmin e painel do tenant

**Goal:** Every user-facing string and configurable value is driven by platform_settings (superadmin-controlled) or tenant_settings (tenant-controlled) — no hardcoded brand names, SEO tags, or landing content in source code

**Requirements:** CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06

**Depends on:** Phase 43

**Plans:** 1/3 plans executed

Plans:
- [ ] 44-01-PLAN.md — Migration 045 (cta_color + seo_title + seo_description columns) + PATCH API allowed list + footerBrand wiring in both public pages
- [x] 44-02-PLAN.md — Landing page CMS data wiring: HowItWorks, FeatureBlocks, FooterCTABand, Footer, Nav all read from platformLanding prop
- [ ] 44-03-PLAN.md — Marketing generateMetadata() from DB (seo_title, seo_description, app_name) + superadmin sidebar app_name

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 35. Custom Domain Infrastructure | 1/1 | Done | 2026-05-10 |
| 36. English Conversion | 1/2 | Complete    | 2026-05-19 |
| 37. Color Theming | 2/2 | Complete    | 2026-05-19 |
| 38. Order Types — Admin & Schema | 2/2 | Complete    | 2026-05-19 |
| 39. Order Types — Customer & Operational | 3/3 | Complete    | 2026-05-19 |
| 40. Multi-Location — Schema & Admin CRUD | 1/1 | Complete    | 2026-05-19 |
| 41. Multi-Location — Routing, QR Codes & Menu Toggle | 0/? | Not started | - |
| 42. SEO — Platform & Per-Tenant | 0/? | Not started | - |
| 43. SEO — Per-Branch Local SEO | 0/? | Not started | - |
| 44. Zero Hardcoded Values | 1/3 | In Progress|  |
