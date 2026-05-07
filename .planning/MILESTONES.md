# Milestones

## v1.3 Landing Page (Shipped: 2026-05-07)

**Phases completed:** 2 phases, 5 plans, 10 tasks

**Key accomplishments:**

- Reserved-path guard + middleware marketing bypass + Vercel Analytics + root layout SEO metadata — all Phase 12 prerequisites wired.
- Full static marketing landing page with 7 sections (nav, hero, how-it-works, features, FAQ, footer CTA, footer) — Server Components only, force-static, zero client JS.
- OG image (ImageResponse, flat CSS, WhatsApp-safe) + placeholder /privacy and /terms pages — Phase 12 complete.
- One-liner:
- OG image file moved to root app level — og:image meta tag correctly injected at 33.4 KB (32.6 KB), 9x under the 300 KB WhatsApp limit; all four SEO checks verified and human-approved.

---

## v1.2 AI Onboarding (Shipped: 2026-05-07)

**Phases completed:** 3 phases, 8 plans, 14 tasks

**Key accomplishments:**

- Created the core seed API route (POST /api/superadmin/tenants/{id}/seed) handling all 6 AI text seeding operations with Gemini 2.5 Flash, additive-only DB writes, non-blocking usage logging, and ISR cache invalidation.
- AI Tools section added to superadmin tenant detail page — bulk seed buttons (Seed menu/categories/products/copy) plus per-item Seed category and Seed product with live category selector, all wired to the seed API from Plan 02
- Nano Banana 2 (gemini-3.1-flash-image-preview) image generation backend — cover banner and per-product WebP photos via generateImage(), Sharp conversion, and Supabase Storage upload — with additive guards and ai_usage tracking.
- TenantDetailClient extended with Seed cover, Seed product images, and single-product Seed image controls inside the existing AI Tools section — calling the seed-image route with per-button loading states, slow-operation warnings, and success/error banners.
- OCR photo upload UI already delivered by Wave 2 agent in commit 58869bd; this plan is a documentation-only close-out

---

## v1.0 Foundation (Shipped: 2026-05-06)

**Phases completed:** 3 phases, 6 plans, 2 tasks

**Key accomplishments:**

- 1. [Rule 1 - Bug] Removed erroneous `await` before synchronous createServiceClient()
- browserslist added to package.json targeting modern browsers to reduce polyfill bundle from 109 KB to ~60-80 KB; PERF-02 confirmed — public routes import only supabase/server

---
