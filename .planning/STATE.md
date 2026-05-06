---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: AI Onboarding
status: Roadmap ready, awaiting plan-phase
stopped_at: Phase 9 context gathered — ready to plan
last_updated: "2026-05-06T20:25:05.919Z"
last_activity: 2026-05-06 — Roadmap created for v1.2
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** A restaurant owner can go from zero to a live, shareable digital menu in under 10 minutes — no design skills, no developer needed.
**Current focus:** v1.2 AI Onboarding — Phase 9: Text Seeding

## Current Position

Phase: 9 — Text Seeding (not started)
Plan: —
Status: Roadmap ready, awaiting plan-phase
Last activity: 2026-05-06 — Roadmap created for v1.2

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% (v1.2)

## Performance Metrics

**Velocity (v1.0):**

- Total plans completed: 6
- Average duration: ~25 min
- Total execution time: ~2.5 hours

**By Phase (v1.0):**

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

### Pending Todos

- Confirm Pexels/Unsplash attribution requirements before Phase 10 ships
- Verify gpt-image-1-mini availability on project's OpenAI tier before Phase 10 begins (DALL-E 3 deprecated May 12 2026)
- Define price parsing test matrix for locale edge cases (Brazilian comma-decimal, integers, free items) during Phase 11 planning

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-05-06T20:25:05.895Z
Stopped at: Phase 9 context gathered — ready to plan
Resume file: .planning/phases/09-text-seeding/09-CONTEXT.md
