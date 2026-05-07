# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- ✅ **v1.2 AI Onboarding** — Phases 9-11 (shipped 2026-05-07)
- 🔄 **v1.3 Landing Page** — Phases 12-13 (active)

## Completed Milestones

<details>
<summary>✅ v1.0 Foundation (Phases 1-3) — SHIPPED 2026-05-06</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 1 | Performance | 2/2 | ✅ 2026-05-06 |
| 2 | Security | 3/3 | ✅ 2026-05-06 |
| 3 | CI/CD | 1/1 | ✅ 2026-05-06 |

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 Orders (Phases 4-8) — SHIPPED 2026-05-06</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 4 | Schema | 2/2 | ✅ 2026-05-06 |
| 5 | Admin Product Options UI | 3/3 | ✅ 2026-05-06 |
| 6 | Public Menu: Option Selectors + Cart | 3/3 | ✅ 2026-05-06 |
| 7 | Checkout | 2/2 | ✅ 2026-05-06 |
| 8 | Tenant Orders View | 1/1 | ✅ 2026-05-06 |

</details>

<details>
<summary>✅ v1.2 AI Onboarding (Phases 9-11) — SHIPPED 2026-05-07</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 9 | Text Seeding | 3/3 | ✅ 2026-05-06 |
| 10 | Image Seeding | 2/2 | ✅ 2026-05-07 |
| 11 | Menu Photo OCR | 3/3 | ✅ 2026-05-07 |

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

</details>

---

## v1.3 Landing Page — Active

### Phases

- [ ] **Phase 12: Core Landing Page** — Replace root redirect with static marketing page; hero, how-it-works, feature blocks, FAQ, footer, middleware guard, analytics
- [ ] **Phase 13: SEO & Metadata** — sitemap.xml, robots.txt, JSON-LD structured data, OG image under 300 KB, Lighthouse 95+ gate

---

## Phase Details

### Phase 12: Core Landing Page
**Goal**: A visitor landing on xmartmenu.skale.club sees a complete, static marketing page that explains the product, links to a live demo, and drives them to sign up
**Depends on**: Nothing (continues from v1.2; no cross-phase dependency within v1.3)
**Requirements**: LP-01, LP-02, LP-03, LP-04, LP-05
**Implementation notes**:
- `src/app/page.tsx` must export `export const dynamic = 'force-static'` — replaces the existing bare `redirect('/auth/login')` entirely
- `src/lib/supabase/middleware.ts` must bypass `getUser()` for `/` to avoid 50-200ms TTFB penalty (Lighthouse killer)
- `src/lib/marketing/reserved-paths.ts` exports `RESERVED_PATHS` Set shared by middleware and onboarding API — prevents tenant slug squatting on marketing words
- `src/app/layout.tsx` gets `metadataBase`, `display: swap` on Inter font, `<Analytics />` and `<SpeedInsights />` from `/next` subpaths
- Install: `@vercel/analytics@2.0.1`, `@vercel/speed-insights@2.0.0`
- Static OG image as `src/app/opengraph-image.png` (1200x630 JPEG, ≤300 KB) — fast path for this phase
- Anti-patterns: no fake testimonials, no fake metrics, no crossed-out anchor pricing, no auto-play video
- Ordering described as feature-flagged per tenant (not default-on); AI seeding framed as onboarding service (not self-serve)
**Success Criteria** (what must be TRUE):
  1. Visitor navigating to `xmartmenu.skale.club` sees the landing page hero — not a login redirect
  2. Visitor can click "Get started" and reach `/auth/register` with a complete signup flow through to `/dashboard`
  3. Visitor can click a "See live demo" link and reach a real provisioned tenant menu at `/demo` with seeded content (is_active: true, categories, products, images)
  4. Vercel Analytics dashboard shows page-view events firing on first deploy (no silent under-count from wrong import path)
  5. No Supabase `getUser()` call appears in Vercel function logs for requests to `/`; Lighthouse mobile scores 90 or higher
**Plans**: 3 plans
Plans:
- [x] 12-01-PLAN.md — Infrastructure: reserved-paths, middleware bypass, analytics install, root layout update, onboarding guard
- [ ] 12-02-PLAN.md — Landing page: (marketing) route group layout + full page with all 7 sections
- [ ] 12-03-PLAN.md — OG image, legal placeholder pages, human verification checkpoint
**UI hint**: yes

### Phase 13: SEO & Metadata
**Goal**: The landing page is fully discoverable by search engines and social crawlers — sitemap, robots, JSON-LD, and OG image all correct and verified
**Depends on**: Phase 12
**Requirements**: SEO-01, SEO-02, SEO-03, SEO-04
**Implementation notes**:
- `src/app/sitemap.ts` uses `MetadataRoute.Sitemap` listing only `/` — never queries the tenants table
- `src/app/robots.ts` uses `MetadataRoute.Robots` disallowing `/api/`, `/admin/`, `/superadmin/`
- JSON-LD (`Organization` + `SoftwareApplication`) lives in `src/app/page.tsx` only via `<script type="application/ld+json" dangerouslySetInnerHTML>` — never in `layout.tsx`, never via `next/script` (causes RSC hydration duplicates in React 19)
- OG image must be JPEG ≤ 300 KB (WhatsApp silently drops images over 300 KB; Brazilian users share via WhatsApp)
- `metadataBase` set in `src/app/layout.tsx` (may already be set from Phase 12 — verify before re-adding)
- Install: `schema-dts@2.0.0` (devDependency only — zero runtime footprint)
- Anti-pattern: do not use `next/script` for JSON-LD; use inline `dangerouslySetInnerHTML` in a Server Component
**Success Criteria** (what must be TRUE):
  1. `curl https://xmartmenu.skale.club/sitemap.xml` returns XML listing only `/` — no tenant slugs appear
  2. `curl https://xmartmenu.skale.club/robots.txt` shows `Disallow: /api/` and `Disallow: /admin/` and `Disallow: /superadmin/`
  3. Google Rich Results Test passes for the landing page URL with no errors or warnings on `Organization` and `SoftwareApplication` schemas; JSON-LD is absent from `view-source` of any `/{tenantSlug}` or `/auth/*` page
  4. `curl -I https://xmartmenu.skale.club/opengraph-image` shows `Content-Length` below 300000 bytes, and the OG image renders correctly in WhatsApp on a real physical device
**Plans**: TBD
**UI hint**: no

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 12. Core Landing Page | 1/3 | In Progress|  |
| 13. SEO & Metadata | 0/? | Not started | - |
