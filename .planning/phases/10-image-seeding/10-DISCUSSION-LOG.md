# Phase 10: Image Seeding — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 10-image-seeding
**Areas discussed:** Image source/provider, Per-product handling, Call pattern, Per-product UI placement, Cover prompt + overwrite

---

## Image source / provider (intervention)

| Option | Description | Selected |
|--------|-------------|----------|
| Stock photo source (Pexels / Unsplash / both) | Original gray area Claude presented per REQ AI-08 | |
| (User intervened) — No stock images | User: "ja falei que nao vamos usar stock images" | ✓ |

**User's choice:** No stock photos. All generation via AI.
**Notes:** Decision was not previously captured in any planning artifact (verified via session transcript and git search). Treated as a new directive. Supersedes REQ AI-08 stock-photo language and ROADMAP.md Phase 10 goal — both updated in this phase.

---

## Per-product handling (intervention)

| Option | Description | Selected |
|--------|-------------|----------|
| All AI (gpt-image-1-mini) | Cover + per-product via gpt-image-1-mini | |
| Cover only — drop per-product | Phase 10 ships only cover; per-product manual | |
| Cover via AI + per-product manual | Cover via gpt-image-1-mini, per-product manual file upload | |
| (User intervened) — Nano Banana 2 for everything | "a geracao vai ser pelo nano banana 2" | ✓ |

**User's choice:** All generation via Nano Banana 2 (Gemini 3 Pro Image), both cover AND per-product.
**Notes:** Replaces gpt-image-1-mini entirely. Reuses the existing `GOOGLE_GENERATIVE_AI_API_KEY` from Phase 9. Single-vendor stack for v1.2 text + image (Phase 11 OCR remains the only OpenAI dependency).

---

## Call pattern (sync vs async)

| Option | Description | Selected |
|--------|-------------|----------|
| Sync, sequential (Recommended) | maxDuration=300, sequential per-product loop | ✓ |
| Sync per-product, parallel | Promise.all with concurrency cap | |
| Async job pattern | ai_image_jobs table + polling/Realtime | |

**User's choice:** Sync, sequential.
**Notes:** Matches Phase 9 pattern. Vercel Pro `maxDuration=300` covers worst-case bulk seeds. Async job pattern preserved as a deferred fallback.

---

## Per-product UI placement

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Phase 9 selector pattern (Recommended) | Category + product selector + 'Seed image' button in AI Tools | ✓ |
| Add a products list section | New tab/section listing all products with per-row buttons | |
| Defer per-row — only bulk | Phase 10 ships only bulk seeding | |

**User's choice:** Mirror Phase 9 selector pattern.
**Notes:** Avoids a separate Products tab build. AI-09's "per row" wording satisfied via per-product targeting through the dropdown.

---

## Cover image prompt + overwrite

| Option | Description | Selected |
|--------|-------------|----------|
| business_type + name, additive (Recommended) | Minimal prompt, skip if banner_url exists | ✓ |
| + style hint, overwrite | Hardcoded photographic style, replace existing | |
| + seeded copy context, additive | Include AI-generated tagline/about as prompt context | |

**User's choice:** business_type + name, additive.
**Notes:** Matches Phase 9 D-08 sanitization scope and D-07 additive-only philosophy. Consistent with project-wide preference for "no surprise overwrites."

---

## Claude's Discretion

- Exact Nano Banana 2 model ID (`gemini-3-pro-image` vs preview variants) — researcher confirms at planning time.
- Cover aspect ratio (~3:1 per BrandingClient) and product image dimensions (square default).
- Whether to fold into the existing `/seed` route (new `type` values) or build a sibling `/seed-image` route.
- Sequential bulk loop concurrency cap.
- Per-product progress reporting shape in the response payload.

## Deferred Ideas

- Async job pattern (`ai_image_jobs` + polling)
- Regenerate controls for re-seeding existing images
- Image moderation / content safety
- Daily image generation cost cap (rate-limit gating)
- Style controls / per-tenant prompt customization
- Aspect-ratio selector in the UI
