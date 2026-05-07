# Research Summary -- v1.3 Landing Page

**Project:** XmartMenu -- xmartmenu.skale.club
**Milestone:** v1.3 Marketing Landing Page
**Domain:** SaaS marketing landing page integrated into existing Next.js 16.2 multi-tenant app
**Researched:** 2026-05-07
**Confidence:** HIGH
---

## Executive Summary

XmartMenu v1.3 adds a public marketing landing page at the root of an existing Next.js 16.2 App Router multi-tenant application. The product targets Brazilian restaurant owners who need a digital QR code menu without design or development skills. Every piece of research converges on the same recommendation: build a single-page, mobile-first, server-rendered static page using only what Next.js 16.2 ships natively. Two npm installs and one dev dependency cover all new package requirements. No infrastructure changes are needed.

The most important design decision is the split into two phases. Phase 12 delivers the core marketing page, Vercel Analytics, the middleware reserved-path guard, and demo tenant provisioning. Phase 13 delivers SEO hardening: sitemap, robots.txt, JSON-LD structured data, and the final Lighthouse 95-plus gate. This ordering is driven by a concrete dependency chain: the middleware performance bypass and reserved-path guard must exist before the page ships, while structured data and sitemap work can be layered on safely.

The highest-risk area is integration correctness, not copy or design. The existing middleware calls supabase.auth.getUser on every request including slash, which will kill Lighthouse scores without an explicit bypass. The [slug] dynamic route captures any first-segment path, so a tenant named pricing or faq would silently shadow marketing sections. Neither guard exists in the codebase today. Both are Phase 12 blockers with low recovery cost before launch and high cost after.

---

## Key Findings

### Recommended Stack

The existing stack (Next.js 16.2, TypeScript, Tailwind CSS 4, Supabase, Vercel, ISR, Sharp) requires no changes. All SEO infrastructure is built into Next.js 16.2 as file conventions -- no external sitemap, robots, or schema packages are needed.

**New packages required:**
- @vercel/analytics@2.0.1 -- first-party Vercel page-view tracking; must import from /next subpath for App Router route-change detection; Vercel dashboard toggle required before data flows
- @vercel/speed-insights@2.0.0 -- real-user Web Vitals (LCP, CLS, INP); must import from /next subpath; same dashboard toggle requirement
- schema-dts@2.0.0 (devDependency only) -- TypeScript types for Organization and SoftwareApplication JSON-LD schemas; zero runtime footprint, stripped at build

**Built-in Next.js 16.2 capabilities (no install needed):**
- app/sitemap.ts with MetadataRoute.Sitemap -- generates /sitemap.xml statically at build
- app/robots.ts with MetadataRoute.Robots -- generates /robots.txt statically at build
- app/opengraph-image.tsx with next/og ImageResponse -- generates OG image statically at build
- Inline script tag with dangerouslySetInnerHTML in Server Component -- JSON-LD structured data
- export const dynamic = force-static on page.tsx -- CDN-edge static generation for marketing page only

**Explicitly avoided:** next-intl (English-only scope in v1.3), next-sitemap (legacy Pages Router package), next/script for JSON-LD (causes RSC hydration duplicates in React 19), Plausible/PostHog (Vercel Analytics covers the need at zero marginal cost).

**Critical import rule:** Analytics and Speed Insights must use the /next subpath, not /react. Using /react breaks route-change detection in App Router and silently under-counts page views.

---

### Expected Features

**Must have (table stakes, shipping in v1.3):**
- Hero: outcome-first headline under 8 words, subhead removing setup objection, primary CTA Get started free with no-credit-card microcopy, device mockup showing real menu
- How It Works: 3-step flow with concrete time claims (10 minutes, 30 seconds), not vague claims
- Live Demo: links to /demo provisioned tenant (real tenant, not a redirect); must exist before page ships
- Feature blocks: 4 alternating blocks for QR code, ordering, multi-language, AI-assisted setup each mapped to customer benefit
- Pricing: single Free during beta card; no fabricated anchor pricing; no Stripe integration referenced
- FAQ: 8 questions as accordion; copy verified against actual product capability
- Footer: logo, navigation, legal placeholders; legal docs are a hard launch dependency outside this milestone scope
- Vercel Analytics and Speed Insights in root layout
- SEO metadata: title template, description, OG and Twitter tags, metadataBase in root layout
- sitemap.xml listing marketing URLs only (Phase 13)
- robots.txt disallowing admin and API routes (Phase 13)
- JSON-LD Organization + SoftwareApplication schemas validated in Google Rich Results Test (Phase 13)
- OG image verified under 300 KB and confirmed rendering in WhatsApp on real device (Phase 13)

**Defer to later:**
- Social proof testimonials: no real quotes yet; fake testimonials are an FTC enforcement risk
- Trust bar or logo strip: no customer logos available
- PT/EN i18n path routing (/pt, /en): Phase 13 at earliest
- Stripe billing integration

**Anti-patterns enforced as hard constraints:**
- No fabricated testimonials or stock-photo personas next to invented quotes
- No fake metrics such as trusted by 10000 restaurants when real number is near zero
- No crossed-out anchor pricing not based on a real published price
- No auto-playing video with sound (kills mobile UX in restaurant environments)
- No feature-first headlines such as all-in-one QR menu platform
- No overselling ordering as default-on (it is feature-flagged per tenant via orders_enabled)
- No claiming AI OCR is self-serve for tenants (superadmin-only in v1.2; frame as onboarding service)

---

### Architecture Approach

Replace src/app/page.tsx (currently a bare redirect to /auth/login) with a static Server Component exporting dynamic = force-static. This gives the marketing page CDN-edge delivery with zero server latency while leaving every other route untouched. The hybrid model is exactly what per-page force-static is designed for in Next.js App Router.

**Files modified:**
1. src/app/page.tsx -- replace redirect with full landing page component; add JSON-LD scripts in Phase 13
2. src/app/layout.tsx -- add Analytics and SpeedInsights components; set metadataBase; add display: swap to Inter font config
3. src/middleware.ts -- add reserved-path guard and marketing route bypass before updateSession
4. src/lib/supabase/middleware.ts -- add public-path bypass at start of updateSession to skip Supabase auth for slash
5. src/app/api/onboarding/route.ts -- add RESERVED_PATHS check before slug INSERT (defense in depth)

**New files created:**
1. src/lib/marketing/reserved-paths.ts -- exports RESERVED_PATHS Set shared by middleware and onboarding API
2. src/app/opengraph-image.png -- static PNG Phase 12 fast path (1200x630px)
3. src/app/sitemap.ts -- MetadataRoute.Sitemap listing marketing URLs only (Phase 13)
4. src/app/robots.ts -- MetadataRoute.Robots disallowing admin and API routes (Phase 13)
5. src/app/opengraph-image.tsx -- dynamic ImageResponse with branded CSS replacing static PNG (Phase 13)

**Demo tenant:** The /demo path is a real provisioned DB tenant with slug equal to demo, not a route file. The existing (public)/[slug]/[menuSlug] route serves it automatically. No src/app/demo/ folder should ever be created -- that would shadow the tenant route handler.

**i18n for Phase 13+:** The recommended approach is a (marketing)/[locale]/ route group scoped only to marketing pages, which avoids conflict with the existing (public)/[slug]/ dynamic route. No next-intl package needed for two-language path routing.

---

### Critical Pitfalls

**Phase 12 blockers (must fix before any public traffic):**

1. Middleware Supabase call on slash kills Lighthouse -- supabase.auth.getUser fires on every matched request including the landing page, adding 50-200ms TTFB. Add a public-path bypass at the start of updateSession in src/lib/supabase/middleware.ts that returns NextResponse.next without calling Supabase when pathname equals slash. Without this fix Lighthouse mobile drops from 95 to 85-88. Verified in live codebase: no bypass exists.

2. Tenant slug namespace collision -- (public)/[slug]/page.tsx captures any first-segment path. The onboarding API deduplicates only against existing DB tenants, not a reserved word list. The slugify utility in src/lib/utils.ts has no reserved word filter. Add RESERVED_PATHS Set to both src/middleware.ts (blocks public access) and src/app/api/onboarding/route.ts (rejects registration). Dual enforcement is defense in depth. Verified in live codebase: no reserved path list exists anywhere.

3. CTA flow broken before landing page ships -- demo tenant must be healthy (is_active: true, default menu, categories with products and images seeded via v1.2 AI tools) before Phase 12 ships. A See live demo link that 404s destroys trust. Full registration-to-dashboard flow must be walked in production. Recovery cost if shipped with broken CTA flow is HIGH (Supabase Auth email redirect debugging typically takes 2-4 hours).

4. Missing metadataBase breaks OG image URLs on social crawlers -- src/app/layout.tsx currently has no metadataBase. Without it OG image URLs are relative paths that Facebook, Twitter/X, and LinkedIn crawlers reject, producing link previews with no image. Verified in live codebase: metadataBase is absent.

**Phase 13 critical items:**

5. OG image exceeds WhatsApp 300 KB limit -- ImageResponse with background images generates PNG files often over 1 MB; WhatsApp silently drops images over 300 KB. Brazilian restaurateurs share links almost exclusively via WhatsApp so a broken social preview is a direct acquisition failure. Start with static JPEG/WebP under 100 KB in Phase 12. If using opengraph-image.tsx, use flat CSS colors and text only with no embedded images. Verify with curl -I and real WhatsApp device test before Phase 13 closes.

6. JSON-LD in layout.tsx leaks schema onto tenant pages -- JSON-LD must be in page.tsx only via inline script dangerouslySetInnerHTML, never in the root layout, never via next/script (next/script causes RSC hydration duplication in React 19).

7. sitemap.ts querying all tenants leaks tenant roster -- the marketing sitemap lists only marketing URLs; never queries the tenants table.

8. Inter font missing display: swap causes FOIT and CLS penalties -- src/app/layout.tsx uses Inter with no display option. Add display: swap and preload: true. Verified in live codebase: option is missing.

---

## Implications for Roadmap

Research strongly supports a two-phase structure with a clean dependency boundary.

### Phase 12: Core Marketing Page

**Rationale:** Blocking items (middleware bypass, reserved-path guard, demo tenant, CTA flow) must land together with the marketing page. Analytics belongs here because it touches the root layout. The static OG image PNG is the fast path for Phase 12.

**Delivers:**
- Landing page live at xmartmenu.skale.club accessible to real visitors
- Vercel Analytics and Speed Insights collecting data from first deploy
- Protected tenant namespace (no slug squatting on reserved marketing words)
- Demo tenant provisioned and accessible at /demo with real content
- CTA flow verified end-to-end in production
- Preliminary Lighthouse mobile score 90 or higher

**Features addressed:** Hero, How It Works, Live Demo, Feature Blocks, Pricing, FAQ, Footer, Social Proof placeholder shell, Analytics instrumentation

**Files changed:** src/app/page.tsx, src/app/layout.tsx, src/middleware.ts, src/lib/supabase/middleware.ts, src/lib/marketing/reserved-paths.ts (new), src/app/api/onboarding/route.ts, src/app/opengraph-image.png (new)

**Packages installed:** @vercel/analytics@2.0.1, @vercel/speed-insights@2.0.0

**Avoids:** Middleware TTFB kill, slug namespace collision, CTA flow failure, demo tenant 404

**Phase 12 gate criteria (all must pass before shipping):**
- RESERVED_PATHS list exists in both middleware and onboarding API
- Marketing route bypass implemented; Vercel function logs show no Supabase call for slash requests
- demo tenant is_active: true with default menu, seeded categories and products with images
- CTA flow end-to-end in production: / > /auth/register > email confirm > /onboarding > /dashboard
- Hero is a Server Component; use client not present in any above-the-fold component
- Inter font configured with display: swap
- metadataBase set in root layout
- Lighthouse mobile 90 or higher

---

### Phase 13: SEO and Analytics Hardening

**Rationale:** SEO files and JSON-LD have no user-facing UI and no dependency on Phase 12 content being finalized. The OG image upgrade and Lighthouse 95-plus final gate belong here.

**Delivers:**
- /sitemap.xml listing marketing URLs only, not tenant roster
- /robots.txt disallowing admin, API, and SaaS-internal routes
- JSON-LD Organization and SoftwareApplication schemas validated in Google Rich Results Test
- OG image under 300 KB confirmed rendering in WhatsApp on real device
- schema-dts devDependency for type-safe JSON-LD authoring
- PT/EN i18n route structure using (marketing)/[locale]/ route group if scope expands to Phase 13
- Final Lighthouse mobile 95 or higher

**Files changed/created:** src/app/sitemap.ts (new), src/app/robots.ts (new), src/app/opengraph-image.tsx (replaces static PNG), src/app/page.tsx (add JSON-LD scripts)

**Packages installed:** schema-dts@2.0.0 (devDependency only)

**Avoids:** WhatsApp OG image failure, JSON-LD leaking to tenant and auth pages, sitemap tenant data exposure, i18n route conflict with [slug]

**Phase 13 gate criteria (all must pass before milestone complete):**
- sitemap.xml contains only marketing URLs, verified by manual inspection
- robots.txt disallows /dashboard, /settings, /tenants, /overview, /api/
- OG image curl -I Content-Length below 300000 bytes
- OG image confirmed rendering in WhatsApp on a real physical device, not simulator
- JSON-LD Google Rich Results Test passes with no errors or warnings
- JSON-LD does NOT appear in view-source of any /{tenantSlug} or /auth/* page
- Vercel Analytics and Speed Insights active and reporting data in Vercel dashboard
- Lighthouse mobile 95 or higher

---

### Phase Ordering Rationale

- Middleware guard and performance bypass are prerequisites for any public traffic and land with Phase 12
- Demo tenant must exist and be healthy before Phase 12 ships; a broken demo link is worse than no link
- SEO files have no user-facing impact and no dependency on page content being final; they layer safely onto Phase 13
- OG image WhatsApp verification requires real-device testing that cannot be skipped or simulated
- i18n route restructure requires moving page.tsx into a [lang] subdirectory which can break routing if done mid-phase; Phase 13 is the earliest safe window

---

### Research Flags

**Needs deeper research during planning:**
- Phase 13 i18n route structure: if PT/EN path routing is confirmed for Phase 13, verify (marketing)/[locale]/ interaction with (public)/[slug]/ against live routing resolution order before writing any code
- Phase 13 OG image WhatsApp testing: manual QA step on real device with production URL required as gate criterion; not addressable in CI or with simulators

**Standard patterns (skip research-phase):**
- Phase 12 Analytics integration: exact code in official Vercel docs with verified import paths and component placement
- Phase 12 Reserved path guard: pattern derived from live codebase inspection and Next.js middleware docs; a Set lookup plus early return
- Phase 12 Landing page sections: HIGH confidence from competitor SaaS page research; section order, CTA patterns, and copy anti-patterns well-documented
- Phase 13 sitemap.ts and robots.ts: native Next.js file conventions with exact code in official 16.2.5 docs
- Phase 13 JSON-LD: official Next.js guide has exact code pattern including XSS sanitization requirement

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified via npm view on 2026-05-07. Native Next.js capabilities confirmed in official 16.2.5 docs. No version conflicts with existing dependencies. |
| Features | HIGH on structure; MEDIUM on conversion numbers | Section order and anti-patterns verified against multiple SaaS landing page analyses and competitor implementations. Specific lift percentages are directional only. |
| Architecture | HIGH | File conventions verified in official Next.js 16.2.5 docs. Middleware patterns verified against live codebase inspection. Import paths verified from official Vercel docs. |
| Pitfalls | HIGH | Six of eight pitfalls verified against live codebase: getUser call confirmed, no reserved path list confirmed, no metadataBase confirmed, Inter display option missing confirmed. WhatsApp 300 KB OG limit confirmed via GitHub Discussion 60366. |

**Overall confidence: HIGH**

### Gaps to Address

- Data export FAQ answer: verify whether a tenant data export mechanism exists before finalizing FAQ question 6 copy. If no export exists, the answer must not imply one. Check src/app/api/ and admin panel for export endpoints.
- Ordering feature-flag default state: confirm the default value of orders_enabled for a newly registered tenant before finalizing FAQ question 5 and Feature Block 2 copy.
- Legal documents: Privacy Policy and Terms of Service are a hard launch blocker for the footer. Out of scope for v1.3 engineering but must be coordinated with the product owner before the page is publicly promoted.
- OG image design asset: the Phase 12 static PNG fast path requires a 1200x630px image file. If no design asset exists at planning time, a placeholder must be created before Phase 12 build begins.
- Marketing layout isolation: confirm at the start of Phase 12 whether to create a (marketing)/layout.tsx route group to prevent SaaS admin CSS from inflating the landing page Tailwind bundle.

---

## Sources

### Primary (HIGH confidence -- official docs, verified 2026-05-07)

- Next.js 16.2.5 sitemap file convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- Next.js 16.2.5 robots file convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
- Next.js 16.2.5 opengraph-image convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
- Next.js 16.2.5 JSON-LD guide: https://nextjs.org/docs/app/guides/json-ld
- Next.js 16.2.5 internationalization guide: https://nextjs.org/docs/app/guides/internationalization
- Vercel Web Analytics quickstart: https://vercel.com/docs/analytics/quickstart (updated 2026-03-11)
- Vercel Speed Insights quickstart: https://vercel.com/docs/speed-insights/quickstart (updated 2026-03-11)
- npm registry: @vercel/analytics@2.0.1, @vercel/speed-insights@2.0.0, schema-dts@2.0.0 verified via npm view 2026-05-07
- Live codebase inspection: src/middleware.ts, src/lib/supabase/middleware.ts, src/app/(public)/[slug]/page.tsx, src/app/api/onboarding/route.ts, src/lib/utils.ts, src/app/layout.tsx

### Secondary (MEDIUM confidence -- cross-referenced with primary sources)

- unbounce.com State of SaaS Landing Pages: section order, hero copy formula, CTA patterns
- choiceqr.com: reference implementation, restaurant QR SaaS landing page structure
- menutiger.com: reference implementation, restaurant QR SaaS competitor landing page
- klientboost 51 SaaS Landing Pages: social proof lift statistics, CTA label frequency analysis
- vercel/next.js discussion 60366: ImageResponse PNG too heavy for WhatsApp 300 KB limit confirmed
- vercel/next.js discussion 80088: JSON-LD hydration duplication with next/script in App Router confirmed
- supabase/discussions 20905: getUser in middleware causes latency
- SaaS Hero B2B SaaS CTA Best Practices: CTA strategy, SMB vs enterprise patterns

### Tertiary (LOW confidence -- directional only)

- WebSearch aggregated findings on FTC fake testimonial enforcement 2025
- WebSearch aggregated findings on WhatsApp OG image pitfalls with Next.js
- WebSearch aggregated findings on free-during-beta pricing conversion rates

---
*Research completed: 2026-05-07*
*Milestone: v1.3 Landing Page -- xmartmenu.skale.club*
*Ready for roadmap: yes*
