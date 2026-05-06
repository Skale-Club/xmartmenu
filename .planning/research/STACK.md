# Stack Research

**Domain:** AI-powered tenant onboarding — LLM text seeding, AI image generation, menu photo OCR
**Researched:** 2026-05-06
**Confidence:** HIGH (npm versions verified via registry; pricing from official sources; Vercel constraints from official docs)

## Context

This is a SUBSEQUENT MILESTONE on an existing Next.js 16.2 + Supabase + Vercel app. The existing stack (App Router, TypeScript, Tailwind CSS 4, Supabase RLS, Sharp) is validated and NOT reconsidered here. This document covers ONLY the new AI capabilities needed for v1.2.

---

## Recommended Stack

### Core AI Libraries

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `ai` (Vercel AI SDK) | ^6.0.175 | Unified interface for LLM calls — `generateText` + `Output.object()` for structured extraction | First-party support from Next.js authors; runs cleanly in App Router Route Handlers; handles streaming, retries, type-safe schema output via Zod; no extra infra needed |
| `@ai-sdk/anthropic` | ^3.0.75 | Anthropic provider adapter for the AI SDK | Needed to call Claude models through the AI SDK abstraction; keeps provider-switching cheap |
| `@ai-sdk/openai` | ^3.0.62 | OpenAI provider adapter for the AI SDK | Needed for GPT-4.1-mini OCR (vision) and gpt-image-1-mini image generation through same AI SDK interface |
| `zod` | ^4.4.3 | Runtime schema validation for structured LLM output | Required by AI SDK `Output.object()` for type-safe extraction; already common in Next.js projects; v4 is the current stable series |

### Feature-Specific Notes

**Text Seeding — Claude Haiku 4.5 via `@ai-sdk/anthropic`**

Use `generateText` with `Output.object()` + Zod schema. Model: `claude-haiku-4-5` ($1.00 input / $5.00 output per 1M tokens). A complete seeding payload (business type → 5 categories × 3 items × description + copy) is ~2–3K input tokens, ~1K output tokens — roughly $0.004 per onboarding. Fast enough (< 5s) to fit Vercel's default 10s timeout on Pro with `maxDuration: 30` as safety margin.

**OCR — `gpt-4.1-mini` via `@ai-sdk/openai` (vision)**

Use `generateText` with `Output.object()` + Zod schema and pass the uploaded menu photo as a base64 data URL in the message content. GPT-4.1-mini handles vision + structured extraction well at lower cost than GPT-4.1. Never use Tesseract.js or pdf.js — they don't run on Vercel serverless and add 100+ MB to the bundle.

**Image Generation — OpenAI `gpt-image-1-mini` via raw OpenAI SDK**

The AI SDK does NOT yet have stable image generation support in v6 — call the `openai` SDK directly for `client.images.generate()`. Use `gpt-image-1-mini` at quality `low` or `standard` ($0.005–$0.011 per image). Download the generated image (base64 response), convert to WebP via the existing `validateAndConvertToWebP` helper in `src/lib/upload.ts`, then upload to Supabase Storage bucket `tenant-assets`. This reuses the pattern already established in the upload route.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `openai` | ^6.36.0 | Direct OpenAI SDK — used only for image generation (`client.images.generate`) | Only needed because AI SDK v6 lacks stable image generation; if AI SDK adds it, migrate and drop this |
| `zod` | ^4.4.3 | Schema definitions for structured LLM output and request body validation | All three AI route handlers — define once in `src/lib/ai/schemas.ts`, import where needed |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Environment variables | API key injection | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — add to Vercel project settings + local `.env.local`; never commit |

---

## Installation

```bash
# Core AI packages
npm install ai @ai-sdk/anthropic @ai-sdk/openai zod openai
```

No dev-only AI packages needed — all are runtime dependencies.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `ai` (Vercel AI SDK v6) | `@anthropic-ai/sdk` directly | Use raw SDK only if you need fine-grained streaming control or experimental Anthropic features not exposed by the AI SDK adapter |
| Claude Haiku 4.5 for text seeding | GPT-4.1-mini | GPT-4.1-mini is cheaper per token (faster at trivial tasks), but Haiku's instruction-following quality is better for Portuguese-language seeding contexts; switch if cost becomes critical |
| GPT-4.1-mini for OCR | Claude Haiku 4.5 vision | Both support vision; GPT-4.1-mini has slightly better OCR accuracy on printed menus per benchmarks. If you want single-vendor billing, Haiku 4.5 can substitute. |
| `gpt-image-1-mini` for image gen | Stable Diffusion via Replicate | Replicate adds cold-start latency (4–10s), a third service dependency, and per-second pricing; gpt-image-1-mini is simpler, billed per image, and already available through existing OpenAI credentials |
| Supabase Storage for generated images | Cloudinary / imgix | Cloudinary adds DX complexity and a fourth external service. Supabase Storage already stores product images; AI-generated images should go there too for RLS consistency and zero new infra |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `tesseract.js` | 15+ MB WASM bundle; hits Vercel's 250 MB function limit fast; slow (5–30s) for real photos; no LLM reasoning | GPT-4.1-mini vision — single API call, returns structured JSON, handles messy handwritten menus |
| `pdf-lib` / `pdfjs-dist` | Menu PDFs are rare; adds >40 MB to bundle; out of scope for photo-based flow | Restrict accepted inputs to JPEG/PNG/WebP photos only |
| LangChain / LlamaIndex | Heavyweight orchestration framework (400+ KB); designed for multi-step agent pipelines, RAG, and embeddings; complete overkill for 3 isolated prompt calls | AI SDK `generateText` + `Output.object()` is all that's needed |
| `@anthropic-ai/claude-agent-sdk` | Agent SDK is for autonomous multi-step agents — wrong abstraction for a deterministic seeding function | Direct AI SDK call |
| Separate AI microservice / Lambda | Adds infra complexity, cold start, auth surface area | Vercel Route Handlers with `maxDuration: 60` are sufficient for all three AI paths |
| Redis / `@upstash/ratelimit` for MVP | Adds an external service dependency, $12/mo minimum, and ops overhead | Use simple DB-level rate limiting: record `ai_seeding_used_at` on the tenant row; check before calling API; upgrade to Redis only if abuse is detected post-launch |
| Streaming responses to the client | Adds complexity to the review UI; menu seeding payloads are small (<1K tokens out, <3s); streaming buys nothing | Single `generateText` call with `await`, return full JSON |

---

## Vercel Serverless Constraints

All three AI route handlers will operate within these limits:

| Concern | Limit | Mitigation |
|---------|-------|------------|
| Function timeout (default) | 10s (Pro plan) | Set `export const maxDuration = 60` in each AI route handler — Vercel Pro supports up to 900s |
| Request body size | 4.5 MB | Menu photo upload should be validated client-side to < 4 MB before POSTing; existing `MAX_FILE_SIZE = 5MB` in `src/lib/upload.ts` needs to be lowered to 4 MB for OCR route |
| Bundle size | 250 MB unzipped | `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` + `openai` + `zod` together are < 5 MB total; well within limits |
| Cold start | 0.5–2s | Acceptable for async onboarding flows; not real-time |
| Memory | 1 GB (Pro) | Image generation pipeline (fetch + base64 + Sharp convert + Supabase upload) peaks at ~50–100 MB; safe |

---

## Cost Model Per Feature

### Text Seeding (Claude Haiku 4.5)

- Input: ~2,500 tokens (system prompt + business type context)
- Output: ~800 tokens (categories + items + descriptions)
- Cost: ~$0.002 input + $0.004 output = **~$0.006 per onboarding**
- At 100 new tenants/month: **~$0.60/month**
- Rate limit: 1 seeding call per tenant (gate by `onboarding_ai_text_used` flag on tenant row)

### OCR (GPT-4.1-mini vision)

- Input: ~1,000 tokens text + image token cost (~300 tokens for a 512×512 crop)
- Output: ~500 tokens structured JSON
- Cost: approximately **$0.003–$0.006 per scan**
- User-initiated, not automatic — natural rate limiting
- Rate limit: 3 OCR attempts per tenant per day (DB timestamp check)

### Image Generation (gpt-image-1-mini, standard quality)

- Cover photo: 1 image × $0.011 = **$0.011**
- Per-item photos: opt-in, user selects which items; cap at 5 per session
- Max per onboarding: 6 images × $0.011 = **$0.066**
- At 100 tenants using image gen (50% adoption): **~$3.30/month**
- Rate limit: `ai_images_generated_count` column on tenant row, hard cap at 10 lifetime free images

### Total per fully-loaded onboarding (all 3 features)

**~$0.07 per tenant** at current pricing. Add 30% margin for retries/failures: ~$0.09. Negligible until hundreds of daily sign-ups.

---

## Integration Points with Existing Code

| Existing File | How AI Features Attach |
|---------------|------------------------|
| `src/app/api/onboarding/route.ts` | Text seeding call added as opt-in step after tenant+menu creation; seeds categories/products in same transaction-like flow |
| `src/lib/upload.ts` | `validateAndConvertToWebP()` reused as-is to convert AI-generated images before Supabase upload |
| `src/app/api/superadmin/tenants/[id]/upload/route.ts` | Pattern reference for Supabase Storage upload; AI image upload will mirror this in a new `/api/onboarding/ai-images` route |
| `src/lib/get-active-menu.ts` | Defines the menu data shape the text seeder must populate (categories, products, descriptions) |
| Supabase `tenant-assets` bucket | AI-generated images stored here under `{tenantId}/ai-cover.webp` and `{tenantId}/products/{productId}.webp` |

New AI route handlers to create:

- `src/app/api/onboarding/seed-text/route.ts` — accepts `{ business_type, tenant_id, menu_id }`, calls Claude, writes categories + products
- `src/app/api/onboarding/seed-images/route.ts` — accepts `{ tenant_id, product_ids[], style_hint }`, calls gpt-image-1-mini, stores to Supabase
- `src/app/api/onboarding/ocr/route.ts` — accepts `multipart/form-data` with photo, calls GPT-4.1-mini vision, returns structured item list for review UI

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `ai@^6.0.175` | `next@16.2.2`, `react@19.2.4` | AI SDK v6 is built for Next.js App Router; fully compatible with React 19 |
| `zod@^4.4.3` | `ai@^6.0.175` | AI SDK v6 uses Zod v4 internally; use v4, not v3 — the two coexist on npm but AI SDK v6 ships its own zod peer |
| `@ai-sdk/anthropic@^3.0.75` | `ai@^6.0.175` | AI SDK provider packages are versioned independently; major version 3.x is the current generation for AI SDK v6 |
| `openai@^6.36.0` | Node.js 18+ | Vercel runs Node.js 20 by default; fully compatible |

**Note on Zod v3 vs v4:** The existing project does not currently use Zod. Adding `zod@^4.4.3` is a clean install with no conflict. If any future dependency pins Zod v3, use npm overrides to deduplicate.

---

## Sources

- npm registry — `ai@6.0.175`, `@ai-sdk/anthropic@3.0.75`, `@ai-sdk/openai@3.0.62`, `openai@6.36.0`, `zod@4.4.3` — versions verified via `npm view` (HIGH confidence)
- [Vercel AI SDK Migration Guide 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) — `generateObject` deprecated, replaced by `generateText` + `Output.object()` (MEDIUM confidence — from search results)
- [Anthropic API Pricing 2026](https://platform.claude.com/docs/en/about-claude/pricing) — Haiku 4.5 $1/$5 per 1M tokens (MEDIUM confidence — from search results cross-referenced)
- [OpenAI Image Pricing](https://openai.com/api/pricing/) — gpt-image-1-mini standard ~$0.011/image; DALL-E 3 deprecated May 12 2026 (MEDIUM confidence — from search results)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — 250 MB bundle, 4.5 MB body, 900s max duration on Pro (HIGH confidence — official docs)
- [Vercel Serverless Function Timeout](https://vercel.com/docs/functions/configuring-functions/duration) — default 10s, configurable via `maxDuration` export (HIGH confidence — official docs)

---

*Stack research for: AI-powered tenant onboarding (xmartmenu v1.2)*
*Researched: 2026-05-06*
