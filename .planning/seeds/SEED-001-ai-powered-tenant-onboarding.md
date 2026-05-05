---
id: SEED-001
status: dormant
planted: 2026-05-05
planted_during: pre-GSD (no .planning/STATE.md yet)
trigger_when: tenant onboarding flow is stable and we want to reduce friction for new restaurants
scope: large
---

# SEED-001: AI-powered tenant onboarding (text, images, menu-photo)

## Why This Matters

Onboarding a new restaurant is the highest-friction moment in the product. A tenant
owner today has to sit down and manually type categories, items, descriptions, and
prices, plus source photos — easily an hour or more of work before they can see
anything live. Most never finish.

The opportunity: collapse that hour into minutes. Once the user picks a business
type during onboarding, we know enough to seed nearly the entire tenant for them.
Three independent paths, each as a separate toggle so the user opts in to what
they trust:

1. **Text seeding** — generate categories, item descriptions, marketing copy via LLM,
   conditioned on the chosen business type
2. **Image seeding** — generate hero/cover images and per-item photos via image model
3. **Menu photo OCR** — user takes a photo of their existing physical menu; OCR + LLM
   parse it into structured menu items with categories and prices, then seed in one shot

Each toggle independent so a cautious user can do text-only and a power user can do all
three. The menu-photo path is the killer feature — most restaurants already have a
printed menu and would otherwise type the same content twice.

## When to Surface

**Trigger:** tenant onboarding flow is stable and we want to reduce friction for new restaurants

This seed should be presented during `/gsd:new-milestone` when the milestone scope
matches any of these conditions:
- Onboarding/UX improvement milestones
- Growth or activation-focused milestones (reducing time-to-first-menu)
- AI/LLM feature milestones
- Mobile-first or camera-input feature work

## Scope Estimate

**Large** — full milestone. Three independent feature paths, each non-trivial:
LLM prompt design + cost controls, image model integration + storage, OCR pipeline
+ structured extraction + review UI. Plan as 3 phases, ship behind feature flags
per toggle so each can be turned on independently.

## Breadcrumbs

Related code in current codebase:
- [src/app/onboarding/page.tsx](src/app/onboarding/page.tsx) — current onboarding entry point, where business-type selection should branch
- [src/lib/get-effective-tenant.ts](src/lib/get-effective-tenant.ts) — tenant resolution, will need to write seeded data here
- [src/app/api/superadmin/tenants/route.ts](src/app/api/superadmin/tenants/route.ts) — tenant creation API, likely target for seeded payload
- [src/lib/get-active-menu.ts](src/lib/get-active-menu.ts) — menu data shape that the seeders need to populate
- [supabase/migrations/](supabase/migrations/) — recent migrations c5e6dc3 and 740bf88 added tenant scaffolding and test data; this seed builds directly on top

## Notes

- Earlier groundwork already shipped: commits `c5e6dc3` (rename + schema sync) and
  `740bf88` (seed scripts + test data) prove the data pipeline works end-to-end.
  The AI seeders just need to produce the same shape as those manual seed scripts.
- The menu-photo flow probably needs a review/edit screen before commit — OCR will
  miss things and prices will be wrong. Don't auto-commit blindly.
- Cost control matters: image generation is expensive. Consider rate-limiting per
  tenant or charging it against a credit balance.
