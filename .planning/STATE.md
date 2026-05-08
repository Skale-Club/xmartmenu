---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Performance — Active
status: executing
stopped_at: "Completed 14-01-PLAN.md — bundle analysis done, top 5 chunks identified"
last_updated: "2026-05-08T00:27:52Z"
last_activity: 2026-05-08 -- Phase 14 Plan 01 completed
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 3
  completed_plans: 1
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-07)

**Core value:** A restaurant owner can go from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed.
**Current focus:** Phase 14 — instrumentacao

## Current Position

Phase: 14 (instrumentacao) — EXECUTING
Plan: 2 of 3 (Plan 01 complete)
Status: Executing Phase 14
Last activity: 2026-05-08 -- Plan 01 complete — bundle analysis executed, chunk data captured

Progress: [█         ] 33% (v1.4 — 1/3 plans complete)

## Milestone Overview

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 14 | Instrumentacao | PERF-01, PERF-02, FE-03 | Not started |
| 15 | Database Indices | DB-01, DB-02, DB-03 | Not started |
| 16 | Frontend Performance | FE-01, FE-02, FE-04 | Not started |
| 17 | CI Gate | PERF-03 | Not started |

## Performance Metrics

**Velocity (v1.0):**

- Total plans completed: 6
- Average duration: ~25 min
- Total execution time: ~2.5 hours

**By Phase (previous milestones):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Performance | 2 | ~50 min | ~25 min |
| 2. Security | 3 | ~75 min | ~25 min |
| 3. CI/CD | 1 | ~25 min | ~25 min |

*Updated after each plan completion*
| Phase 04 P01 | 1 | 1 tasks | 1 files |
| Phase 04 P02 | 8min | 1 tasks | 3 files |
| Phase 05 P01 | 1min | 2 tasks | 2 files |
| Phase 05 P02 | 3min | 1 tasks | 1 files |
| Phase 05 P03 | 8min | 2 tasks | 1 files |
| Phase 06 P01 | 8min | 1 tasks | 1 files |
| Phase 06-public-menu-option-selectors-cart P02 | 326 | 2 tasks | 1 files |
| Phase 06 P03 | 306 | 2 tasks | 1 files |
| Phase 07 P01 | 4min | 1 tasks | 1 files |
| Phase 07 P02 | 277s | 2 tasks | 1 files |
| Phase 08-tenant-orders-view P01 | 138 | 1 tasks | 1 files |
| Phase 09-text-seeding P01 | 15min | 2 tasks | 4 files |
| Phase 09-text-seeding P09-02 | 25min | 2 tasks | 2 files |
| Phase 09-text-seeding P09-03 | 20min | 2 tasks | 4 files |
| Phase 11-menu-photo-ocr P11-01 | 15min | 3 tasks | 5 files |
| Phase 11-menu-photo-ocr P11-02 | 386 | 2 tasks | 3 files |
| Phase 11-menu-photo-ocr P03 | 0min | 1 tasks | 0 files |
| Phase 12-core-landing-page P12-01 | 4min | 3 tasks | 7 files |
| Phase 12-core-landing-page P12-02 | 8min | 2 tasks | 3 files |
| Phase 12-core-landing-page P12-03 | 5min | 2 tasks | 3 files |
| Phase 13-seo-metadata P13-01 | 204 | 2 tasks | 4 files |
| Phase 13-seo-metadata P13-02 | ~15min | 1 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- In-memory cart (no localStorage) — matches skleanings pattern, avoids state-sync complexity
- Option groups for product variants — pizza sizes + half-and-half require structured groups, not flat addons
- CartContext must use 'use client' boundary — Next.js App Router constraint
- half_and_half price rule: max(half1.base_price, half2.base_price) — Brazilian convention
- [Phase 04]: Migration 021 does not touch orders_public_insert — already fixed in 020 with orders_enabled gate
- [Phase 04]: base_price nullable on product_options to distinguish absolute option price from additive price_modifier
- [Phase 04]: Status UPDATE rows before DROP+ADD CONSTRAINT to avoid CHECK constraint violation on existing data
- [Phase 04]: Order.status union uses kitchen workflow language: pending/preparing/ready/done/cancelled (not confirmed/completed)
- [Phase 04]: base_price vs price_modifier: base_price is absolute option price (nullable), price_modifier is additive delta (non-nullable)
- [Phase 05]: Edit button navigates to /admin/menu/products/[id] instead of opening modal (modal kept for future quick-edit use per D-03)
- [Phase 05]: GroupWithOptions interface exported from [id]/page.tsx for ProductDetailClient (Plan 02) to import
- [Phase 05 P03]: OptionGroupForm/OptionForm declared before export default in same file — no separate files needed
- [Phase 05 P03]: isAbsolutePrice = type==='single' || type==='half_and_half' drives price field label and min constraint
- [Phase 05 P03]: price_modifier input has NO min attr to allow negative values (Pitfall 5 from RESEARCH.md)
- [Phase 06-public-menu-option-selectors-cart]: buildCartKey sorts entries alphabetically to ensure stable composite cart keys
- [Phase 06-public-menu-option-selectors-cart]: CartItem extended with selectedOptions, unitPrice, cartKey for per-option-combination cart slots
- [Phase 06]: ProductModal owns selectedOptions building — onAddToCart callback receives (opts, unitPrice) so ProductModal can access group/option state in scope
- [Phase 07]: selected_options typed as Record<string, unknown> to match DB column type; || null fallback for backward compatibility
- [Phase 07-02]: Snapshot cart into confirmedCart before clearing to display ordered items in confirmation view
- [Phase 07-02]: orderId && orderSuccess double-guard switches CartModal between confirmation and cart-form views
- [Phase 08-01]: All changes confined to OrdersClient.tsx — Items column, selected_options display, and Notes modal section added additively without removing existing code
- [v1.2 Roadmap]: AI SDK v6 uses Zod v4 internally — do not mix Zod v3 and v4
- [v1.2 Roadmap]: ai_usage table schema planned as (tenant_id, feature_key, date, call_count, token_count) to cover all three AI features without future migration
- [v1.2 Roadmap]: All AI routes must use Node.js runtime (not Edge) — Sharp requires native Node.js bindings
- [v1.2 Roadmap]: OCR two-route pattern is architectural: ocr-menu returns draft (no DB write), ocr-commit writes only after user confirmation
- [v1.2 Roadmap]: Phase 10 (Image Seeding) depends on Phase 9 product IDs; Phase 11 (OCR) depends on Phase 9 infra but is DB-independent
- [v1.2 Roadmap]: tenant_id must always be derived from Supabase auth session, never from request body
- [Phase 09-01]: sanitizeForPrompt strips `{}<>\n\r` and backticks before any user value enters a prompt — OWASP LLM Top 10 #1
- [Phase 09-01]: ai_usage UNIQUE(tenant_id, feature_key, date) enables upsert cost accumulation without extra SELECT
- [Phase 09-01]: Migration 022 applied via Supabase SQL editor (local Docker not available)
- [Phase 09-text-seeding]: Single seed route with type field in POST body handles all 6 seed types without proliferating routes
- [Phase 09-text-seeding]: Zod v4 z.record requires two args: z.record(z.string(), z.any()) — single-arg form not valid in Zod v4
- [Phase 09-text-seeding]: TranslationsSchema kept flat as z.record(z.string(), z.any()) to avoid Gemini structured output validation failures with deeply nested schemas (Pitfall 3)
- [Phase 09-text-seeding]: categories-list endpoint created at /api/superadmin/tenants/[id]/menus/[menuId]/categories-list — no existing superadmin route covered per-menu category listing
- [Phase 09-text-seeding]: AI Tools section placed outside tab system, always visible below Tabs block per UI-SPEC Layout Specification
- [Phase 11-menu-photo-ocr]: @ai-sdk/openai@^3 installed at major 3 to match @ai-sdk/google and remain compatible with ai@6.x
- [Phase 11-menu-photo-ocr]: OcrMenuSchema price: z.number() (not .positive()) — 0 valid for unreadable prices (D-12)
- [Phase 11-menu-photo-ocr]: ocr-upload-token route accepts ?filename= query param for correct storage path extension (Pitfall 7)
- [Phase 11-menu-photo-ocr]: generateObject with messages array (not prompt string) used for GPT-4.1-mini vision — image base64 data URL passed as content part
- [Phase 11-menu-photo-ocr]: Image downloaded from Supabase Storage then converted to base64 — avoids passing raw storage URL to OpenAI (storage may not be publicly accessible)
- [Phase 11-menu-photo-ocr]: Wave 2 agent pre-completed 11-03 scope during 11-02 execution — OCR UI shipped in commit 58869bd alongside the ocr-menu route
- [v1.3 Roadmap]: page.tsx must export `dynamic = 'force-static'` — CDN-edge delivery, replaces redirect entirely
- [v1.3 Roadmap]: Supabase getUser() bypass in middleware.ts required for `/` — without it Lighthouse mobile drops to 85-88
- [v1.3 Roadmap]: RESERVED_PATHS Set must be enforced in both middleware (blocks access) and onboarding API (blocks registration) — dual enforcement is defense in depth
- [v1.3 Roadmap]: JSON-LD must use inline dangerouslySetInnerHTML in page.tsx only — next/script causes RSC hydration duplicates in React 19
- [v1.3 Roadmap]: sitemap.ts lists only `/` — never queries tenants table (prevents tenant roster exposure)
- [v1.3 Roadmap]: OG image must be JPEG ≤ 300 KB — WhatsApp silently drops images over 300 KB; Brazilian restaurateurs share via WhatsApp
- [v1.3 Roadmap]: Analytics/SpeedInsights must import from /next subpath — /react breaks route-change detection in App Router
- [v1.3 Roadmap]: No fake testimonials, fake metrics, or crossed-out anchor pricing — FTC enforcement risk and anti-pattern
- [v1.3 Roadmap]: Ordering copy must describe feature-flag behavior (not default-on); AI seeding copy must describe onboarding service (not self-serve tenant tool)
- [v1.3 Roadmap]: demo tenant must exist with is_active: true, default menu, seeded categories/products/images before Phase 12 ships
- [v1.3 Roadmap]: metadataBase absence in layout.tsx confirmed in live codebase — must be added in Phase 12
- [Phase 12-01]: BLOCKED_TENANT_SLUGS inline in middleware.ts (not imported from reserved-paths.ts) — Edge Runtime keeps imports minimal
- [Phase 12-01]: Marketing bypass uses NextResponse.next() unconditionally for '/' — no session refresh on static marketing routes (D-26)
- [Phase 12-01]: Analytics components in root layout (not marketing layout) — broader coverage across all routes (D-03)
- [Phase 12-core-landing-page]: Camera icon used as Instagram proxy in (marketing)/page.tsx — lucide-react@1.7.0 does not export Instagram; aria-label preserved
- [Phase 12-core-landing-page]: Analytics/SpeedInsights not added to (marketing)/layout.tsx — already in root layout.tsx per D-03 to avoid script duplication
- [Phase 12-core-landing-page]: OG image uses flat dark CSS ImageResponse with no fetch() — keeps PNG under 100 KB (WhatsApp 300 KB gate, Pitfall 3)
- [Phase 12-core-landing-page]: Legal pages (/privacy, /terms) outside (marketing) route group as named routes — inherit root lang=pt-BR, acceptable for placeholders (D-21)
- [Phase 13-seo-metadata]: sitemap.ts lists only / — no DB queries to prevent tenant roster exposure as public XML
- [Phase 13-seo-metadata]: JSON-LD injected via dangerouslySetInnerHTML in page.tsx only (not layout.tsx) — prevents leaking to tenant pages
- [Phase 13-seo-metadata]: schema-dts installed as devDependency — zero runtime footprint, types stripped at build
- [Phase 13-02]: opengraph-image.tsx must be in src/app/ root, not route-group subdirectory — file convention only injects og:image meta when co-located with the route segment it applies to
- [Phase 13-02]: OG image measured at 33421 bytes (32.6 KB) — 9x under 300 KB WhatsApp limit
- [v1.4 Roadmap]: Phase 14 (Instrumentacao) is a hard prerequisite gate — no optimization work starts before baselines are recorded
- [v1.4 Roadmap]: Vercel Speed Insights already installed (v1.3); Phase 14 is about reading/interpreting data, not installing tooling
- [v1.4 Roadmap]: All DB analysis runs via Supabase SQL editor — no local Docker available
- [v1.4 Roadmap]: Phase 17 CI Gate depends on Phase 16 achieving >= 90 so threshold is meaningful, not aspirational
- [Phase 14-01]: Turbopack incompatible with @next/bundle-analyzer — must use ANALYZE=true npm run build --webpack
- [Phase 14-01]: Bundle analyzer generates client.html, edge.html, nodejs.html (not server.html as originally documented)
- [Phase 14-01]: Top 5 client chunks: 3794 (216KB, App Router runtime), 4bd1b696 (195KB, react-dom), framework (185KB, React+scheduler), 5536 (170KB, unnamed shared — lazy candidate), main (128KB, hydration bootstrap); total non-deferrable baseline ~819KB

### Pending Todos

- Provision demo tenant (slug=demo, is_active: true, default menu, v1.2 AI-seeded content) before Phase 12 ships
- Obtain or create 1200x630 JPEG OG image asset <= 300 KB before Phase 12 build begins
- Confirm ordering feature-flag default state (orders_enabled default) before finalizing Feature Block 2 and FAQ copy
- Confirm whether tenant data export exists before finalizing FAQ question on data ownership
- Coordinate Privacy Policy and Terms of Service documents (Termly/iubenda) — hard launch prerequisite, out of engineering scope

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-05-08T00:08:39.042Z
Stopped at: Phase 14 context gathered
