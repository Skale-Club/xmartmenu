# Project Research Summary

**Project:** xmartmenu v1.2 - AI-Powered Tenant Onboarding
**Domain:** AI-assisted SaaS onboarding - restaurant/food-service digital menu platform
**Researched:** 2026-05-06
**Confidence:** HIGH

## Executive Summary

xmartmenu v1.2 adds three AI capabilities to an existing, production-hardened Next.js 16.2 + Supabase + Vercel stack: LLM text seeding (generating a starter menu from business type), AI image seeding (cover photo via gpt-image-1-mini, product photos via stock API), and menu photo OCR (extracting items from a photographed physical menu). Research confirms the Vercel AI SDK v6 + OpenAI is the clear choice, no new infrastructure is needed, and the full cost per onboarded tenant runs under $0.09. The existing Sharp/WebP pipeline and Supabase Storage bucket absorb image handling without modification.

The recommended implementation strategy is three sequential phases: text seeding first (validates the LLM integration pattern), image seeding second (depends on product IDs from Phase 1), and OCR third (highest UX complexity, fully independent at the DB level). The review-before-commit pattern is non-negotiable across all three features - the most severe pitfalls (garbage OCR data auto-committed, wrong prices saved, tenant trust destroyed) all stem from skipping the human review gate.

The primary risks are security and cost, not technical complexity. Prompt injection via business name (OWASP LLM Top 10 #1), per-tenant API cost runaway, and tenant data cross-contamination must be addressed in Phase 1 and carried forward. ISR cache staleness after seeding requires revalidatePath calls after every DB write. The Vercel 4.5 MB serverless body limit is a hard constraint that requires the OCR upload to use Supabase Storage direct upload.

---

## Key Findings

### Recommended Stack

The AI layer sits entirely on top of the existing stack with five new npm packages. The Vercel AI SDK v6 (ai, @ai-sdk/anthropic, @ai-sdk/openai) provides a unified interface for all LLM calls using generateText + Output.object() with Zod schema validation, replacing the now-deprecated generateObject. The raw openai SDK is needed only for image generation because AI SDK v6 lacks stable image gen support. Total bundle addition is under 5 MB.

**Core technologies:**
- ai@^6.0.175 (Vercel AI SDK): unified LLM interface - first-party Next.js App Router support, type-safe structured output via Zod, no extra infra
- @ai-sdk/anthropic@^3.0.75: Claude Haiku 4.5 adapter - best instruction-following for Portuguese-language text seeding at ~$0.006/onboarding
- @ai-sdk/openai@^3.0.62: GPT-4.1-mini adapter - vision-capable for OCR; same AI SDK interface
- openai@^6.36.0: direct OpenAI SDK - only needed for client.images.generate() (gpt-image-1-mini)
- zod@^4.4.3: schema validation - required by AI SDK v6; use v4 not v3; clean install, no existing conflict

**Critical version note:** AI SDK v6 uses Zod v4 internally. Do not mix Zod v3 and v4.

**What not to add:** Tesseract.js (250 MB function buster), LangChain/LlamaIndex (overkill for 3 isolated prompt calls), Redis rate limiting (DB-level ai_usage table is sufficient for v1.2).

See .planning/research/STACK.md for full version compatibility matrix and cost model.

---

### Expected Features

**Must have (table stakes):**
- Generate categories + product names/descriptions/prices from business_type + company_name
- Progress/loading indicator for all AI operations (LLM calls take 2-20s; blank UI causes abandonment)
- Review/edit screen before any DB write - mandatory for both text seeding and OCR
- Error handling + retry on every AI route
- Cover/banner image generation (gpt-image-1-mini) - TenantSettings.banner_url is empty by default
- Per-item product photos from stock API (Unsplash/Pexels) - AI food photos are a trust risk; stock photos safer and better-looking
- Photo upload + GPT-4.1-mini vision + structured extraction (menu OCR)
- Mandatory OCR review/edit screen before commit

**Should have (differentiators):**
- Company name injected into generated copy (low effort, high perceived personalization)
- Per-item image swap (try another) in image review grid
- Opt-in toggle per AI feature
- Multi-page OCR support
- Image quality pre-check client-side before OCR upload

**Defer (v2+):**
- Per-item regeneration in text seeding (v1.3)
- Token-by-token streaming for text seeding (deliver only if >4s UX complaint)
- Save as draft for OCR review (state persistence complexity)
- PDF OCR support (separate code path, scope creep)
- AI usage dashboard for superadmin (v1.3)
- Option group / variant seeding (LLM error rate too high)
- Allergen/ingredient generation (legal risk)

**Hard anti-features (never build):**
- Auto-commit OCR or text seed results without review
- Store raw external image URLs (always re-upload to Supabase Storage)
- AI-generated per-item food photos (food accuracy risk; use stock photos)
- Derive tenant_id from request body instead of auth session

See .planning/research/FEATURES.md for full UX flow diagrams per feature.

---

### Architecture Approach

Three independent AI route handlers under src/app/api/ai/ are added as a new Step 5 to the existing 4-step onboarding wizard. The existing /api/onboarding route is left untouched except for one addition: return tenant_id and menu_id so Step 5 can call the AI routes. AI seeding is opt-in, decoupled from tenant creation, and runs only after the tenant scaffold exists.

**Major components:**
1. POST /api/ai/seed-text - LLM generation via Claude Haiku 4.5, bulk insert categories + products, SSE streaming, maxDuration: 60
2. POST /api/ai/seed-images - gpt-image-1-mini generation, Sharp WebP conversion, Supabase Storage upload, SSE per-image progress, maxDuration: 300
3. POST /api/ai/ocr-menu - multipart photo upload, GPT-4.1-mini vision, structured draft returned (no DB write), maxDuration: 60
4. POST /api/ai/ocr-commit - user-reviewed draft to bulk insert, no AI calls, maxDuration: 15
5. AiSeedingPanel (client component) - Step 5 UI: toggles, progress states, review screens, commit triggers
6. src/lib/ai/schemas.ts (new shared module) - Zod schemas for all structured LLM outputs

**Key patterns:**
- SSE streaming for text and image seeding (client sees live progress)
- No DB writes from OCR API route - draft lives in React state until user confirms
- All AI routes use Node.js runtime (not Edge) - Sharp requires Node.js native bindings
- Rate limiting via ai_usage DB table checked before every AI call
- revalidatePath() called after every successful DB write to bust ISR cache
- tenant_id derived from Supabase auth session, never from request body

See .planning/research/ARCHITECTURE.md for full route schemas, SSE implementation pattern, and data flow diagrams.

---

### Critical Pitfalls

1. **Prompt injection via business name** - company_name is user-controlled input; never interpolate raw into system prompt. Inject only into delimited user-content section, enforce 100-char allowlist regex, use Zod schema enforcement. Address in Phase 1. (OWASP LLM Top 10 #1)

2. **LLM cost runaway without per-tenant throttling** - No rate limit means a scripted attacker can exhaust the OpenAI budget overnight. Implement ai_usage table with daily limits checked before every AI call. Create in Phase 1, reuse for all three features.

3. **OCR auto-commit without review** - Price extraction errors are common (e.g. Brazilian format R$12,50 can be parsed as 1250). Two-route pattern (ocr-menu returns draft, ocr-commit writes only after user confirmation) is mandatory.

4. **Vercel 4.5 MB body limit breaks OCR upload** - A modern phone JPEG is 3-8 MB. OCR upload must use Supabase Storage direct upload (signed URL): client uploads file directly to Storage, sends only the storage path to the route handler.

5. **ISR stale cache after seeding** - Call revalidatePath() server-side at the end of every successful AI seeding write. Must be in Phase 1, not added later.

6. **Wrong language generation** - Without explicit language constraint, LLMs default to English for a PT tenant. Read tenant_settings.preferred_language and inject the language requirement as the first system prompt line. Phase 1, affects every generated token.

7. **Tenant data cross-contamination** - Module-level caches in Vercel serverless are shared across tenant requests. Never cache LLM responses in module-level variables. Always derive tenant_id from auth session.

See .planning/research/PITFALLS.md for full pitfall set (13 critical), technical debt patterns, security mistakes checklist, and recovery strategies.

---

## Implications for Roadmap

Based on combined research, three phases are strongly indicated. Ordering is driven by hard dependencies (image seeding needs product IDs from text seeding), risk (OCR has highest UX complexity), and shared infrastructure (ai_usage table and prompt injection mitigations built in Phase 1 are reused in Phases 2 and 3).

### Phase 1: LLM Text Seeding + Onboarding Step 5 Scaffold

**Rationale:** Lowest-risk path to validate the AI SDK integration and OpenAI connectivity. Establishes the SSE streaming pattern, ai_usage rate limiting table, prompt injection mitigations, and revalidatePath convention that all subsequent phases reuse. The review/edit UI built here is the template for OCR.

**Delivers:**
- Step 5 AI panel in src/app/onboarding/page.tsx with feature toggle UI
- POST /api/ai/seed-text with Claude Haiku 4.5 via AI SDK, SSE streaming
- Bulk insert of AI-generated categories + products to existing DB tables
- ai_usage Supabase table with RLS + per-tenant daily call limits
- Prompt injection mitigations (length/allowlist validation on company_name)
- Language-aware generation (preferred_language from tenant_settings)
- revalidatePath after DB writes
- Feature flag: NEXT_PUBLIC_AI_ONBOARDING_ENABLED
- Minimal change to /api/onboarding: add tenant_id + menu_id to response

**Avoids pitfalls:** Prompt injection, cost runaway, wrong language generation, ISR stale cache, tenant data cross-contamination

**Research flag:** Standard patterns - no additional research-phase needed.

---

### Phase 2: AI Image Seeding

**Rationale:** Depends on product IDs from Phase 1. Introduces image generation pipeline, Sharp WebP conversion of AI output, and async SSE-per-image progress. Image costs are meaningful ($0.011/image) so rate limiting from Phase 1 must extend to images. Hybrid approach: gpt-image-1-mini for cover/banner, Pexels/Unsplash for per-item photos.

**Delivers:**
- POST /api/ai/seed-images with gpt-image-1-mini for cover + Pexels/Unsplash for per-item photos
- Sharp WebP conversion of all AI-generated images before Supabase Storage write
- SSE progress events per image
- Rate limiting extended to cover images (ai_usage extension)
- Image review grid UI: thumbnail + approve/swap/skip per item
- Content moderation check (OpenAI Moderation API, free) before storage write
- Food-photography prompt anchoring + negative prompt

**Avoids pitfalls:** Synchronous image generation blocking UX, Sharp WebP pipeline bypass, inappropriate images, unlimited image generation cost

**Research flag:** Confirm Pexels/Unsplash attribution requirements before shipping. Verify gpt-image-1-mini availability (DALL-E 3 deprecated May 12 2026).

---

### Phase 3: Menu Photo OCR

**Rationale:** Fully independent at the DB level but benefits from prompt engineering patterns and ai_usage infra from earlier phases. Highest UX complexity. The Vercel 4.5 MB limit mandates direct-to-Storage upload architecture from day one.

**Delivers:**
- POST /api/ai/ocr-menu with GPT-4.1-mini vision, returns structured draft (no DB write)
- POST /api/ai/ocr-commit for user-reviewed draft to bulk insert
- Supabase Storage direct upload pattern (signed URL) to bypass 4.5 MB limit
- Client-side image resize to max 2048px before upload
- OcrReviewPanel component: editable table by category, inline editing, delete/add row
- Locale-aware price parsing (Brazilian comma-decimal format normalized to period-decimal, validated against strict regex)
- Low-quality photo detection with user warning
- OCR confidence scoring; low-confidence items flagged in review UI
- Entry point from both onboarding Step 5 and Admin panel

**Avoids pitfalls:** OCR auto-commit without review (two-route separation is architectural), Vercel 4.5 MB limit, price misparse, low-quality photo silent failure

**Research flag:** Standard vision extraction patterns. Define price parsing test matrix during planning.

---

### Phase Ordering Rationale

- Phase 1 before Phase 2: Image seeding needs product IDs from text seeding; ai_usage table is prerequisite for image cost control
- Phase 1 before Phase 3: Review screen UI pattern from Phase 1 is the template for OCR; ai_usage infra is reused
- Phase 2 before Phase 3: Storage upload patterns from Phase 2 inform OCR upload architecture (soft dependency)
- Phase 3 last: Highest complexity, most novel code path, independent at DB level

### Research Flags

Phases needing attention during planning:
- **Phase 2:** Confirm Pexels/Unsplash attribution requirements. Verify gpt-image-1-mini availability and pricing.
- **Phase 3:** Define price parsing test matrix for locale edge cases (Brazilian comma-decimal, European formats, integers, free items).

Phases with standard patterns (no research-phase needed):
- **Phase 1:** Vercel AI SDK + OpenAI Chat Completions + Structured Outputs is thoroughly documented.
- **Phase 3 (upload):** Supabase Storage direct upload with signed URLs is officially documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm versions verified via registry; Vercel constraints from official docs; AI SDK v6 compatibility confirmed |
| Features (text seeding, OCR) | HIGH | Patterns verified with multiple production examples and official OpenAI docs |
| Features (image seeding) | MEDIUM | Hybrid AI-cover + stock-products approach well-reasoned; Pexels/Unsplash attribution TBD |
| Architecture | HIGH | Based on direct codebase inspection + official Vercel Fluid Compute docs (Feb 2026) |
| Pitfalls | HIGH | OWASP LLM Top 10 sourced; Vercel limits from official docs; injection surface identified via codebase read |

**Overall confidence:** HIGH

### Gaps to Address

- **Pexels/Unsplash attribution:** Both APIs are free and production-ready but attribution requirements for programmatic re-hosting need confirmation before Phase 2 ships.
- **DALL-E 3 deprecation (May 12 2026):** STACK.md migrates to gpt-image-1-mini - confirm this model is available in the project OpenAI tier before Phase 2 begins.
- **Streaming vs. single-call for text seeding:** Resolve during Phase 1 planning - single call first, upgrade to SSE if >4s becomes a UX complaint.
- **ai_usage table schema:** Define (tenant_id, feature_key, date, call_count, token_count) during Phase 1 planning to cover all three features without a future migration.
- **Vercel plan (free vs Pro):** Confirm the Vercel plan before committing to route timeout values and cold start mitigation strategy.

---

## Sources

### Primary (HIGH confidence)
- npm registry - ai@6.0.175, @ai-sdk/anthropic@3.0.75, @ai-sdk/openai@3.0.62, openai@6.36.0, zod@4.4.3 verified via npm view
- Vercel Functions Limits (official docs) - 250 MB bundle, 4.5 MB body, 900s max on Pro
- Vercel Fluid Compute duration limits - verified 2026-02-27
- Existing codebase - src/app/api/onboarding/route.ts, src/lib/upload.ts, src/app/api/superadmin/tenants/[id]/upload/route.ts
- OWASP LLM Top 10 for 2025 - Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/

### Secondary (MEDIUM confidence)
- Vercel AI SDK Migration Guide 6.0 - generateObject deprecated, replaced by generateText + Output.object()
- Anthropic API Pricing 2026 - Haiku 4.5: $1 input / $5 output per 1M tokens
- OpenAI Image Pricing - gpt-image-1-mini standard approx $0.011/image; DALL-E 3 deprecated May 12 2026
- Restaurant menu OCR pipeline (production) - https://medium.com/@zafarobad/from-fuzzy-photos-to-perfect-data-building-an-ai-powered-ocr-system-for-restaurant-menus-bb575b16db59
- AI food photo generation risk (MenuCapture) - https://www.menucapture.com/ai-food-photography
- OpenAI API Budget Limits Per-Tenant - https://runcycles.io/blog/openai-api-budget-limits-per-user-per-run-per-tenant
- Multi-Tenant AI Leakage - https://layerxsecurity.com/generative-ai/multi-tenant-ai-leakage/

### Tertiary (LOW confidence)
- Generate then review UX pattern as table stakes - standard SaaS AI pattern per research; no single authoritative UX study found
- Image quality pre-check (canvas analysis) - described as best practice; no canonical implementation found; may be over-engineering for v1

---
*Research completed: 2026-05-06*
*Ready for roadmap: yes*