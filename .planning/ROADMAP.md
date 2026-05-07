# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- 🚧 **v1.2 AI Onboarding** — Phases 9-11 (in progress)

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

---

## 🚧 v1.2 AI Onboarding (In Progress)

**Milestone Goal:** Give superadmins AI-powered tools to populate a new tenant's menu in seconds — text, images, and OCR from a physical menu photo. Tenants see a fully populated menu and edit it through the regular admin UI.

## Phases

- [x] **Phase 9: Text Seeding** — Superadmin can seed a tenant's categories, products, and restaurant copy via LLM from the superadmin panel; also adds per-item "Seed" buttons for individual categories/products (completed 2026-05-06)
- [ ] **Phase 10: Image Seeding** — Superadmin can generate a tenant cover photo and per-product stock photos; uploads go directly to Supabase Storage via the existing Sharp/WebP pipeline
- [ ] **Phase 11: Menu Photo OCR** — Superadmin can upload a photo of a tenant's physical menu; GPT-4.1-mini extracts categories, items, and prices and writes them directly to the tenant's tables

## Phase Details

### Phase 9: Text Seeding
**Goal**: Superadmin can trigger AI text seeding for any tenant from the superadmin panel — generating English categories, products, restaurant copy, and optional translations — with prompt injection mitigations and ai_usage cost tracking in place from day one
**Depends on**: Phase 8 (v1.1 complete)
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-13, AI-14, AI-15
**Success Criteria** (what must be TRUE):
  1. Superadmin opens a tenant detail page and triggers AI text seeding; a loading state is shown during the LLM call (2–20s)
  2. Generated English categories and products appear in the tenant's admin immediately after seeding — tenant can edit them in the regular admin UI
  3. If the tenant has additional languages enabled, seeding also populates the `translations` JSONB for each generated item
  4. Superadmin can click a "Seed" button next to the "Add category" and "Add product" inputs to generate a single item via AI
  5. All LLM prompts sanitize tenant-supplied strings before interpolation; public menu routes are revalidated after seeding writes
**Plans**: 3 plans
Plans:
- [x] 09-01-PLAN.md — AI infrastructure: migration 022, sanitize utility, npm packages, TypeScript types
- [x] 09-02-PLAN.md — Seed API route: all 6 seed types, Gemini calls, additive DB writes, ai_usage logging, revalidatePath
- [x] 09-03-PLAN.md — UI extension: page.tsx prop expansion + TenantDetailClient AI Tools section
**UI hint**: yes

### Phase 10: Image Seeding
**Goal**: Superadmin can trigger image seeding for a tenant — generating a cover/banner photo and per-product photos via **Nano Banana 2 (Gemini 3 Pro Image)** — all uploaded directly to Supabase Storage as WebP
**Depends on**: Phase 9
**Requirements**: AI-07, AI-08, AI-09
**Success Criteria** (what must be TRUE):
  1. Superadmin triggers cover seeding; a Nano Banana 2-generated banner is uploaded as the tenant's `tenant_settings.banner_url` (additive — skipped if already set)
  2. Each product without an image gets a Nano Banana 2-generated photo uploaded as its `image_url` (additive — never overwrites)
  3. Superadmin can target a single product via the AI Tools selector and seed just that product's image
**Plans**: 2 plans
Plans:
- [x] 10-01-PLAN.md — Image seed backend: convertBufferToWebP utility + seed-image route (cover, bulk products, single product)
- [ ] 10-02-PLAN.md — Image seed UI: Seed cover, Seed product images, and Seed image controls in AI Tools section
**UI hint**: yes

### Phase 11: Menu Photo OCR
**Goal**: Superadmin can upload a photo of a tenant's physical menu; the system extracts structured categories, items, and prices via GPT-4.1-mini vision and writes them directly to the tenant's tables
**Depends on**: Phase 9
**Requirements**: AI-10, AI-11, AI-12
**Success Criteria** (what must be TRUE):
  1. Superadmin uploads a menu photo from the tenant detail page; upload goes directly to Supabase Storage (bypasses Vercel 4.5 MB body limit)
  2. Extracted categories and products appear in the tenant's tables immediately; prices that fail parsing are saved as `0`
  3. Superadmin can verify and fix any extraction errors using the regular admin UI
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Performance | v1.0 | 2/2 | Complete | 2026-05-06 |
| 2. Security | v1.0 | 3/3 | Complete | 2026-05-06 |
| 3. CI/CD | v1.0 | 1/1 | Complete | 2026-05-06 |
| 4. Schema | v1.1 | 2/2 | Complete | 2026-05-06 |
| 5. Admin Product Options UI | v1.1 | 3/3 | Complete | 2026-05-06 |
| 6. Public Menu: Option Selectors + Cart | v1.1 | 3/3 | Complete | 2026-05-06 |
| 7. Checkout | v1.1 | 2/2 | Complete | 2026-05-06 |
| 8. Tenant Orders View | v1.1 | 1/1 | Complete | 2026-05-06 |
| 9. Text Seeding | v1.2 | 3/3 | Complete   | 2026-05-06 |
| 10. Image Seeding | v1.2 | 1/2 | In Progress|  |
| 11. Menu Photo OCR | v1.2 | 0/? | Not started | - |
