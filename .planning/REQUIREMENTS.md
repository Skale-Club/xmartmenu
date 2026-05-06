# Requirements — v1.2 AI Onboarding

**Milestone:** v1.2 AI Onboarding
**Created:** 2026-05-06

## v1.2 Requirements

### Text Seeding

- [ ] **AI-01**: Tenant can initiate AI text seeding during onboarding by selecting their business type (pizzaria, hamburgueria, churrascaria, etc.)
- [ ] **AI-02**: System generates PT and EN menu categories based on selected business type (e.g. pizzaria → Pizzas, Bebidas, Sobremesas)
- [ ] **AI-03**: System generates PT and EN product name and description for representative items within each generated category
- [ ] **AI-04**: System generates restaurant copy in PT and EN: suggested name, tagline, and "about" text based on business type
- [ ] **AI-05**: Tenant can review, edit, and selectively delete generated text content in a review screen before any data is written to the database
- [ ] **AI-06**: Text seeding calls are rate-limited per tenant via an `ai_usage` table (daily limit enforced server-side)

### Image Seeding

- [ ] **AI-07**: System generates a restaurant cover/banner photo via `gpt-image-1-mini` conditioned on business type and restaurant name
- [ ] **AI-08**: System suggests per-product stock photos sourced from Pexels or Unsplash based on item name (safer than AI-generated food images)
- [ ] **AI-09**: Tenant can review, approve, or reject each image in a review screen before any upload to Supabase Storage
- [ ] **AI-10**: Image generation is rate-limited per tenant (daily limit shared with `ai_usage` table; each image counts against the quota)

### Menu Photo OCR

- [ ] **AI-11**: Tenant can upload a photo of their physical menu during onboarding; upload goes directly to Supabase Storage (bypasses Vercel's 4.5 MB request body limit)
- [ ] **AI-12**: System extracts categories, item names, and prices from the uploaded photo via GPT-4.1-mini vision, returning structured JSON
- [ ] **AI-13**: Tenant can review, edit, and selectively delete extracted items in a review screen before any data is committed to the database — no auto-commit path exists
- [ ] **AI-14**: Store admin can import a menu via photo from the admin panel at any time (not limited to the onboarding flow)

### Infrastructure & Safety

- [ ] **AI-15**: Each AI feature (text seeding, image seeding, OCR) has an independent feature flag; a tenant can enable any subset without enabling all three
- [ ] **AI-16**: All LLM prompts sanitize tenant-supplied strings (company_name, business_type) before interpolation to prevent prompt injection
- [ ] **AI-17**: Public menu routes are revalidated via `revalidatePath()` after any AI seeding write commits data to the database (prevents stale ISR cache)
- [ ] **AI-18**: `ai_usage` table tracks per-tenant daily AI calls; server-side guard blocks further calls once the daily limit is reached

## Future Requirements (deferred from v1.2)

- Automatic language detection from OCR output (currently caller must specify locale)
- Handwritten menu support (low-quality photo enhancement before OCR)
- AI-generated menu descriptions for existing (non-seeded) products
- Credit balance per tenant (pay-per-use model) — v1.2 uses hard daily cap
- Superadmin dashboard for AI cost attribution per tenant
- Content moderation check on AI-generated images before storage
- Allergen / dietary tag inference from product descriptions

## Out of Scope

- Payment processing — deferred to v1.3 (SEED-003 Stripe Connect)
- Marketing landing page — deferred to v1.3+ (SEED-005)
- Full performance milestone — deferred to SEED-004
- Real-time AI generation progress (WebSocket) — SSE streaming is sufficient for v1.2
- Auto-commit without review — explicitly prohibited by research findings
- Local OCR libraries (Tesseract.js, pdfjs) — bundle too large for Vercel serverless

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| AI-01 | TBD — Text Seeding | Pending |
| AI-02 | TBD — Text Seeding | Pending |
| AI-03 | TBD — Text Seeding | Pending |
| AI-04 | TBD — Text Seeding | Pending |
| AI-05 | TBD — Text Seeding | Pending |
| AI-06 | TBD — Text Seeding | Pending |
| AI-07 | TBD — Image Seeding | Pending |
| AI-08 | TBD — Image Seeding | Pending |
| AI-09 | TBD — Image Seeding | Pending |
| AI-10 | TBD — Image Seeding | Pending |
| AI-11 | TBD — Menu OCR | Pending |
| AI-12 | TBD — Menu OCR | Pending |
| AI-13 | TBD — Menu OCR | Pending |
| AI-14 | TBD — Menu OCR | Pending |
| AI-15 | TBD — Infra | Pending |
| AI-16 | TBD — Infra | Pending |
| AI-17 | TBD — Infra | Pending |
| AI-18 | TBD — Infra | Pending |
