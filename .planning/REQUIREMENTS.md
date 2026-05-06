# Requirements — v1.2 AI Onboarding (Superadmin Tools)

**Milestone:** v1.2 AI Onboarding
**Created:** 2026-05-06
**Updated:** 2026-05-06 — scope refocused to superadmin-only operation

## Context

xmartmenu is offered as a managed onboarding service. Customers do not generate their own menus with AI. Instead, the platform team (superadmins) uses AI tools to populate a new tenant's menu in seconds, then the tenant edits and refines it through the regular admin UI. The system is English-first; tenants who enable additional languages can have AI generate those translations.

All AI generation writes directly to the database. There is no separate "review screen" — the regular admin UI is the editor. If the AI gets something wrong, the superadmin (or tenant) corrects it in the same admin UI they already use for any manual edit.

## v1.2 Requirements

### Text Seeding (Phase 9)

- [ ] **AI-01**: Superadmin can initiate AI text seeding for any tenant from the superadmin tenant detail page; seeding writes generated content directly to the tenant's `categories` and `products` tables
- [ ] **AI-02**: System generates English menu categories based on the tenant's business type (e.g. `pizzeria` → Pizzas, Drinks, Desserts), respecting existing categories (does not overwrite)
- [ ] **AI-03**: System generates English product name and description for representative items within each generated category, respecting existing products (does not overwrite)
- [ ] **AI-04**: System generates English restaurant copy (suggested name override, tagline, "about" text) for the tenant's profile
- [ ] **AI-05**: When a tenant has additional languages enabled (via existing i18n `translations` field), seeding generates that content in each enabled language and stores it in the same `translations` JSONB
- [ ] **AI-06**: Superadmin sees a "Seed" button next to the "Add category" and "Add product" inputs in the superadmin tenant view; clicking it generates that single item via AI

### Image Seeding (Phase 10)

- [ ] **AI-07**: Superadmin can trigger image seeding for a tenant; system generates a restaurant cover/banner photo via `gpt-image-1-mini`, converts to WebP via the existing Sharp pipeline, and uploads to Supabase Storage as the tenant's cover
- [ ] **AI-08**: For each product without an image, system fetches a stock photo from Pexels or Unsplash, converts to WebP, and uploads directly as the product's `image_url`
- [ ] **AI-09**: Superadmin sees a "Seed image" button on each product row in the superadmin tenant view; clicking it generates an image for that single product

### Menu Photo OCR (Phase 11)

- [ ] **AI-10**: Superadmin can upload a menu photo from the superadmin tenant view; upload goes directly to Supabase Storage (bypasses Vercel 4.5 MB request body limit)
- [ ] **AI-11**: System extracts categories, item names, and prices from the photo via GPT-4.1-mini vision, then writes them directly to the tenant's `categories` and `products` tables
- [ ] **AI-12**: OCR-extracted prices that fail parsing (unrecognized format, missing currency) are saved as `0` with a flag the superadmin can fix in the regular admin UI

### Infrastructure & Safety (cross-cutting, scaffolded in Phase 9)

- [x] **AI-13**: All LLM prompts sanitize tenant-supplied strings (`company_name`, `business_type`, free-form fields) before interpolation to prevent prompt injection
- [ ] **AI-14**: Public menu routes are revalidated via `revalidatePath()` after any AI seeding write commits data (prevents stale ISR cache)
- [x] **AI-15**: `ai_usage` table tracks AI calls per tenant (`tenant_id`, `feature_key`, `date`, `call_count`, `token_count`) for cost attribution; not used as a blocking gate

## Future Requirements (deferred from v1.2)

- Tenant-facing AI features (self-service generation in the tenant admin)
- Review screens before commit (only relevant if AI is exposed to tenants)
- Per-tenant feature flags for AI (only relevant if tenant-facing)
- Daily rate limit enforcement that blocks calls (currently `ai_usage` is informational)
- Handwritten menu OCR (low-quality photo enhancement)
- AI-generated descriptions for existing (non-seeded) products
- Credit balance per tenant (pay-per-use)
- Superadmin dashboard for AI cost attribution per tenant
- Content moderation check on AI-generated images before storage
- Allergen / dietary tag inference from product descriptions

## Out of Scope

- Payment processing — deferred to v1.3 (SEED-003 Stripe Connect)
- Marketing landing page — deferred to v1.3+ (SEED-005)
- Full performance milestone — deferred to SEED-004
- Local OCR libraries (Tesseract.js, pdfjs) — bundle too large for Vercel serverless
- Tenant-initiated AI generation — explicit decision to keep AI as an internal tool
- "Review then commit" UI pattern — superadmin edits in the regular admin UI after generation

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| AI-01 | Phase 9 — Text Seeding | Pending |
| AI-02 | Phase 9 — Text Seeding | Pending |
| AI-03 | Phase 9 — Text Seeding | Pending |
| AI-04 | Phase 9 — Text Seeding | Pending |
| AI-05 | Phase 9 — Text Seeding | Pending |
| AI-06 | Phase 9 — Text Seeding | Pending |
| AI-07 | Phase 10 — Image Seeding | Pending |
| AI-08 | Phase 10 — Image Seeding | Pending |
| AI-09 | Phase 10 — Image Seeding | Pending |
| AI-10 | Phase 11 — Menu Photo OCR | Pending |
| AI-11 | Phase 11 — Menu Photo OCR | Pending |
| AI-12 | Phase 11 — Menu Photo OCR | Pending |
| AI-13 | Phase 9 — Text Seeding (infra scaffold) | ✅ Complete (09-01) |
| AI-14 | Phase 9 — Text Seeding (infra scaffold) | Pending |
| AI-15 | Phase 9 — Text Seeding (infra scaffold) | ✅ Complete (09-01) |
