---
phase: 11-menu-photo-ocr
plan: 01
subsystem: api
tags: [openai, ocr, supabase-storage, ai-sdk, zod]

requires:
  - phase: 09-text-seeding
    provides: "ai_usage table, sanitizeForPrompt, schemas.ts pattern, assertSuperadmin() guard"

provides:
  - "@ai-sdk/openai@^3.0.62 installed (gpt-4.1-mini provider)"
  - "OcrMenuSchema + OcrMenuResult exported from src/lib/ai/schemas.ts"
  - "GET /api/superadmin/tenants/[id]/ocr-upload-token — returns { uploadUrl, storagePath }"
  - "OPENAI_API_KEY documented in .env.example"

affects: [11-menu-photo-ocr plan 02, 11-menu-photo-ocr plan 03]

tech-stack:
  added:
    - "@ai-sdk/openai@^3.0.62"
  patterns:
    - "Signed upload URL pattern: GET endpoint returns { uploadUrl, storagePath } for direct browser-to-Storage PUT (bypasses Vercel 4.5 MB body limit)"
    - "OCR schema design: price z.number() allows 0 for failed parsing (D-12); description nullable/optional (D-06)"

key-files:
  created:
    - "src/app/api/superadmin/tenants/[id]/ocr-upload-token/route.ts"
  modified:
    - "src/lib/ai/schemas.ts"
    - ".env.example"
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "@ai-sdk/openai@^3 installed (major matches @ai-sdk/google@^3; peer-compatible with ai@6.x)"
  - "OcrMenuSchema price uses z.number() not z.number().positive() — price 0 valid for unreadable prices (D-12)"
  - "ocr-upload-token accepts optional ?filename= query param to preserve file extension in storage path (Pitfall 7 mitigation)"
  - "No runtime='nodejs' on upload-token route — no native Node APIs needed for signed URL generation"

patterns-established:
  - "Pattern: Two-step upload (GET signed URL + PUT directly to Supabase Storage) for bypassing Vercel 4.5 MB limit"

requirements-completed: [AI-10]

duration: 15min
completed: 2026-05-07
---

# Phase 11 Plan 01: Menu Photo OCR Infrastructure Summary

**@ai-sdk/openai provider installed, OcrMenuSchema exported from schemas.ts, and signed upload URL route live — foundation for GPT-4.1-mini menu photo OCR**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T11:42:00Z
- **Completed:** 2026-05-07T11:57:47Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Installed `@ai-sdk/openai@^3.0.62` — aligns with `@ai-sdk/google@3.0.67` major version; peer-compatible with `ai@6.0.175`
- Added `OcrMenuSchema` and `OcrMenuResult` to `src/lib/ai/schemas.ts` — correct shape with `price: z.number()` (0 allowed) and `description: z.string().nullable().optional()`
- Created `GET /api/superadmin/tenants/[id]/ocr-upload-token` — returns `{ uploadUrl, storagePath }` for direct browser-to-Storage upload bypassing Vercel 4.5 MB body limit

## Task Commits

1. **Task 1: Install @ai-sdk/openai and document OPENAI_API_KEY** - `7bb16a5` (chore)
2. **Task 2: Add OcrMenuSchema to src/lib/ai/schemas.ts** - `8a23467` (feat)
3. **Task 3: Create GET ocr-upload-token route** - `640ad18` (feat)

## Files Created/Modified

- `package.json` — added `"@ai-sdk/openai": "^3.0.62"` to dependencies
- `package-lock.json` — updated with @ai-sdk/openai and its transitive deps
- `.env.example` — added `OPENAI_API_KEY=your-openai-api-key-here` in AI section
- `src/lib/ai/schemas.ts` — appended `OcrMenuSchema` and `OcrMenuResult` (existing schemas untouched)
- `src/app/api/superadmin/tenants/[id]/ocr-upload-token/route.ts` — new GET route

## OcrMenuSchema Shape (for Plan 02 reference)

```typescript
export const OcrMenuSchema = z.object({
  categories: z.array(z.object({
    name: z.string(),
    products: z.array(z.object({
      name: z.string(),
      price: z.number(),                            // 0 = unreadable price (D-12)
      description: z.string().nullable().optional(), // null when not visible (D-06)
    })),
  })),
})
export type OcrMenuResult = z.infer<typeof OcrMenuSchema>
```

## ocr-upload-token Route Response Shape (for Plan 03 reference)

```typescript
// GET /api/superadmin/tenants/[id]/ocr-upload-token?filename=menu.jpg
// Response:
{ uploadUrl: string, storagePath: string }
// uploadUrl = Supabase signed URL for PUT upload (valid 2 hours)
// storagePath = "{tenantId}/ocr/{timestamp}.{ext}"
```

## Decisions Made

- `@ai-sdk/openai@^3` pinned at major 3 to match `@ai-sdk/google@3` and remain compatible with `ai@6.x`
- `price: z.number()` (not `.positive()` or `.min(0)`) — price 0 must pass schema for failed parsing (D-12)
- `description: z.string().nullable().optional()` — null when GPT cannot see description text (D-06)
- Upload-token route accepts `?filename=` query param to extract correct extension for storage path (Pitfall 7)
- No `export const runtime = 'nodejs'` on the upload-token route — signed URL generation is pure HTTP, no native Node APIs needed

## Deviations from Plan

None — plan executed exactly as written.

## User Setup Required

`OPENAI_API_KEY` must be added to `.env.local`:
```bash
OPENAI_API_KEY=sk-...your-openai-key...
```
Get key from: OpenAI Dashboard → API keys → Create new secret key.

## Next Phase Readiness

- Plan 02 can import `OcrMenuSchema` and `OcrMenuResult` from `src/lib/ai/schemas.ts`
- Plan 02 can use `openai('gpt-4.1-mini')` from `@ai-sdk/openai`
- Plan 03 can call `GET /api/superadmin/tenants/[id]/ocr-upload-token` for the signed upload URL
- Blocker for runtime: `OPENAI_API_KEY` must be set in `.env.local` before Plans 02/03 can be tested end-to-end

## Known Stubs

None — this plan only installs infrastructure (package, schema, route). No UI or data rendering involved.

---
*Phase: 11-menu-photo-ocr*
*Completed: 2026-05-07*
