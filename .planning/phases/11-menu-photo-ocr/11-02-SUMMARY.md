---
phase: 11-menu-photo-ocr
plan: 02
subsystem: api, ui
tags: [openai, gpt-4.1-mini, vision, ocr, supabase-storage, ai-sdk, react]

requires:
  - phase: 11-menu-photo-ocr
    plan: 01
    provides: "@ai-sdk/openai installed, OcrMenuSchema + OcrMenuResult, GET ocr-upload-token route"
  - phase: 09-text-seeding
    provides: "ai_usage table, assertSuperadmin(), createServiceClient(), revalidatePath pattern"

provides:
  - "POST /api/superadmin/tenants/[id]/ocr-menu — GPT-4.1-mini vision extracts categories+products from menu photo, writes to DB"
  - "OCR photo upload UI in TenantDetailClient — file input + 3-step upload flow (token -> PUT Storage -> POST ocr-menu)"

affects: [11-menu-photo-ocr plan 03 (if any), Phase 10 image seeding (independent)]

tech-stack:
  added: []
  patterns:
    - "GPT-4.1-mini vision via generateObject with image content parts (base64 data URL)"
    - "3-step browser upload: GET signed URL -> PUT to Supabase Storage -> POST processing route"
    - "Additive DB write with existing-name deduplication (same as seed route pattern)"

key-files:
  created:
    - "src/app/api/superadmin/tenants/[id]/ocr-menu/route.ts"
    - ".planning/phases/11-menu-photo-ocr/11-02-PLAN.md"
  modified:
    - "src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx"

key-decisions:
  - "Image downloaded from Supabase Storage as Blob then converted to base64 data URL for AI SDK vision (not streaming)"
  - "generateObject messages array used (not prompt string) to attach image content part alongside text instruction"
  - "price ?? 0 in product insert — OcrMenuSchema already forces z.number() so 0 passes schema for unreadable prices (AI-12)"
  - "OCR UI section shown only when selectedMenuId is truthy — consistent with per-item seeding guard"
  - "createServiceClient() called synchronously (it is not async) — consistent with existing patterns"

requirements-completed: [AI-11, AI-12]

duration: ~7min
completed: 2026-05-07
---

# Phase 11 Plan 02: OCR Menu Route + UI Integration Summary

**GPT-4.1-mini vision extracts categories and products from a menu photo and writes them directly to the tenant's DB; OCR upload UI added to superadmin tenant detail page**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-07T12:06:21Z
- **Completed:** 2026-05-07T12:13:01Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 1 plan created, 1 modified)

## Accomplishments

- Created `POST /api/superadmin/tenants/[id]/ocr-menu` route:
  - Downloads uploaded image from Supabase Storage by `storagePath`
  - Converts `Blob` to base64 data URL and passes as vision content part to `generateObject`
  - Uses `openai('gpt-4.1-mini')` with `OcrMenuSchema` for structured extraction
  - Additive DB write — skips categories and products that already exist by name
  - `price ?? 0` ensures unreadable prices are saved as 0 (AI-12, D-12)
  - Logs `ai_usage` with `feature_key='ocr_menu'` (non-blocking)
  - Calls `revalidatePath` for tenant/menu slugs after write
  - `runtime='nodejs'`, `maxDuration=60`
- Extended `TenantDetailClient.tsx` with OCR photo upload section:
  - New state: `ocrFile`, `ocrLoading`, `ocrStatus`
  - `handleOcrUpload`: 3-step flow — GET token → PUT to Supabase Storage → POST `ocr-menu`
  - File input (`accept="image/*"`) + "Upload & Extract" button
  - Loading pulse message, success/error banners consistent with seed status pattern
  - Section visible only when a menu is selected

## Task Commits

1. **Task 1: POST ocr-menu route** - `855d593` (feat)
2. **Task 2: OCR upload UI in TenantDetailClient** - `58869bd` (feat)

## Files Created/Modified

- `src/app/api/superadmin/tenants/[id]/ocr-menu/route.ts` — new POST route (AI-11, AI-12)
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — added OCR photo upload section (AI-10 UI, AI-11)
- `.planning/phases/11-menu-photo-ocr/11-02-PLAN.md` — plan documentation

## OCR Route Contract (for reference)

```
POST /api/superadmin/tenants/[id]/ocr-menu
Body: { storagePath: string, menuId: string }
Response: { success: true, categoriesCreated: number, productsCreated: number, tokensUsed: number }
Errors: 400 (missing fields), 401 (unauthorized), 404 (menu not found), 500 (download/vision/insert error)
```

## Decisions Made

- `generateObject` called with `messages` array (not `prompt` string) to attach image content part
- Image downloaded from Supabase Storage and converted to base64 data URL — avoids passing raw storage URL to OpenAI (storage may not be publicly accessible)
- `createServiceClient()` is synchronous — called without `await` (consistent with existing routes)
- OCR UI section guarded by `menus.length > 0 && selectedMenuId` — same condition as per-item seeding section

## Deviations from Plan

**[Rule 3 - Blocking] npm install required in worktree**
- **Found during:** Task 1 TypeScript check
- **Issue:** `@ai-sdk/openai` was in `package.json` (merged from worktree-agent-ad09b12d03d09755c) but not installed in `node_modules` of this worktree
- **Fix:** Ran `npm install` to install missing packages
- **Impact:** TypeScript error resolved, `tsc --noEmit` now passes clean

## Known Stubs

None — both the API route and UI are fully wired. The OCR route writes real data to the DB. The UI calls real endpoints. No placeholder or hardcoded empty values flow to rendering.

## Self-Check

- [x] `src/app/api/superadmin/tenants/[id]/ocr-menu/route.ts` — FOUND
- [x] Commit `855d593` — FOUND
- [x] Commit `58869bd` — FOUND
- [x] TypeScript `tsc --noEmit` — clean (no errors)

## Self-Check: PASSED

---
*Phase: 11-menu-photo-ocr*
*Completed: 2026-05-07*
