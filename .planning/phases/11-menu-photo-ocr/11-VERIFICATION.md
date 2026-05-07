---
phase: 11-menu-photo-ocr
verified: 2026-05-07T20:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 7/9
  gaps_closed:
    - "File size soft warning missing (D-15) — ocrFile.size > 4 * 1024 * 1024 inline check with 'Large photos may take longer; results may vary.' added at line 797-799 of TenantDetailClient.tsx"
    - "Missing seedLoading and imageSeedLoading cross-disable on OCR button — button now disabled={ocrLoading || !ocrFile || !!imageSeedLoading || seedLoading} at line 791"
    - "Phase 10 regression — imageSeedLoading, imageSeedStatus, selectedProductId, menuProducts state restored (lines 74-77); useEffect for products-list restored (lines 148-158); handleSeedImage() handler restored (lines 246-289); Image Seeding JSX block restored (lines 701-770)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "End-to-end OCR flow with real menu photo"
    expected: "Selecting a JPG/PNG of a printed menu, clicking Upload & Extract, waiting up to 30 seconds, then seeing 'N categories and M products added.' with correct counts matching visible menu items"
    why_human: "Requires live OPENAI_API_KEY, live Supabase Storage bucket tenant-assets, and a real menu photo to verify GPT-4.1-mini extraction quality"
  - test: "Additive write — second upload does not duplicate"
    expected: "Uploading the same menu photo a second time shows 'No new items extracted — all detected items already exist.'"
    why_human: "Requires live DB state with previously extracted data"
  - test: "Price=0 for unreadable prices visible in admin UI"
    expected: "After OCR extracts a menu with a price that was unreadable, the product appears in the tenant admin UI with price 0.00 and the superadmin can edit it to the correct value"
    why_human: "Requires live extraction with a menu that has obscured prices, plus admin UI interaction"
  - test: "4 MB soft warning appears in browser"
    expected: "Selecting a photo file larger than 4 MB causes the amber text 'Large photos may take longer; results may vary.' to appear below the file input before any upload is triggered"
    why_human: "Requires browser interaction to select a file; cannot be verified programmatically"
---

# Phase 11: Menu Photo OCR Verification Report

**Phase Goal:** Superadmin can upload a photo of a tenant's physical menu; the system extracts structured categories, items, and prices via GPT-4.1-mini vision and writes them directly to the tenant's tables
**Verified:** 2026-05-07T20:00:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (previous score 7/9, now 9/9)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | @ai-sdk/openai@^3 is installed and listed in package.json dependencies | VERIFIED | `@ai-sdk/openai@3.0.62`; package.json line 15 |
| 2 | OcrMenuSchema is exported from src/lib/ai/schemas.ts with correct shape (categories array, products with price: z.number(), description nullable) | VERIFIED | schemas.ts lines 54–63: exact schema present; `price: z.number()`; `description: z.string().nullable().optional()` |
| 3 | GET /api/superadmin/tenants/{id}/ocr-upload-token returns { uploadUrl, storagePath } for authenticated superadmins | VERIFIED | route.ts: assertSuperadmin() guard; createSignedUploadUrl(storagePath); returns `{ uploadUrl: data.signedUrl, storagePath: data.path }` |
| 4 | OPENAI_API_KEY is documented in .env.example | VERIFIED | `.env.example` line 15: `OPENAI_API_KEY=your-openai-api-key-here` |
| 5 | POST /api/superadmin/tenants/{id}/ocr-menu downloads the image, calls GPT-4.1-mini vision via generateObject, writes extracted categories+products to DB, logs ai_usage, returns { success, categoriesCreated, productsCreated, tokensUsed } | VERIFIED | route.ts: runtime='nodejs', maxDuration=60; generateObject with openai('gpt-4.1-mini') and OcrMenuSchema; categories insert; products insert; ai_usage upsert; correct return shape |
| 6 | OCR-extracted prices that fail parsing are saved as 0 (AI-12) | VERIFIED | route.ts: `price: p.price ?? 0` — OcrMenuSchema forces `z.number()` so 0 passes schema for unreadable prices |
| 7 | Superadmin sees an 'OCR' sub-section in the AI Tools section below the per-item seeding block | VERIFIED | TenantDetailClient.tsx lines 772–823: OCR section present inside AI Tools div, after image seeding block, guarded by `menus.length > 0 && selectedMenuId` |
| 8 | If the selected file exceeds 4 MB, a warning is shown: 'Large photos may take longer; results may vary.' | VERIFIED | TenantDetailClient.tsx line 797-799: `{ocrFile && ocrFile.size > 4 * 1024 * 1024 && (<p className="text-xs text-amber-600 mt-1">Large photos may take longer; results may vary.</p>)}` — inline check on ocrFile state, no separate warning state needed |
| 9 | The 'Extract from photo' button is disabled while any other seed operation is in progress (ocrLoading, seedLoading, imageSeedLoading) | VERIFIED | TenantDetailClient.tsx line 791: `disabled={ocrLoading \|\| !ocrFile \|\| !!imageSeedLoading \|\| seedLoading}` — all four conditions present |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/ai/schemas.ts` | OcrMenuSchema + OcrMenuResult type exports | VERIFIED | Lines 54–65: OcrMenuSchema and OcrMenuResult both present and correctly typed; all pre-existing schemas untouched |
| `src/app/api/superadmin/tenants/[id]/ocr-upload-token/route.ts` | GET route returning signed Supabase Storage upload URL | VERIFIED | 44-line file; exports GET; assertSuperadmin() guard; createSignedUploadUrl(storagePath); returns { uploadUrl, storagePath } |
| `src/app/api/superadmin/tenants/[id]/ocr-menu/route.ts` | POST route for GPT-4.1-mini vision extraction and DB write | VERIFIED | runtime='nodejs'; maxDuration=60; generateObject with openai('gpt-4.1-mini'); categories + products DB inserts; ai_usage log; revalidatePath |
| `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` | OCR sub-section with file input, 3-step upload handler, loading/success/error states, size warning, full mutual exclusion | VERIFIED | handleOcrUpload 3-step flow; OCR JSX with inline size check; button disabled on ocrLoading, !ocrFile, imageSeedLoading, seedLoading; Image Seeding Phase 10 UI restored alongside OCR section |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ocr-upload-token/route.ts` | `supabase.storage.from('tenant-assets').createSignedUploadUrl` | createServiceClient() | WIRED | `service.storage.from('tenant-assets').createSignedUploadUrl(storagePath)` |
| `ocr-menu/route.ts` | `OcrMenuSchema` from src/lib/ai/schemas.ts | import OcrMenuSchema | WIRED | `import { OcrMenuSchema } from '@/lib/ai/schemas'`; used in generateObject call |
| `ocr-menu/route.ts` | `openai('gpt-4.1-mini')` from @ai-sdk/openai | generateObject | WIRED | `import { openai } from '@ai-sdk/openai'`; `model: openai('gpt-4.1-mini')` |
| `ocr-menu/route.ts` | categories table | service.from('categories').insert() | WIRED | `.from('categories').insert(catsToInsert).select('id, name')` |
| `ocr-menu/route.ts` | products table | service.from('products').insert() | WIRED | `.from('products').insert(prodsToInsert).select('id')` |
| `TenantDetailClient.tsx handleOcrUpload` | `GET /api/superadmin/tenants/{id}/ocr-upload-token` | fetch step 1 | WIRED | `fetch(.../ocr-upload-token?filename=${encodeURIComponent(ocrFile.name)})` |
| `TenantDetailClient.tsx handleOcrUpload` | Supabase Storage signedUrl | fetch PUT step 2 | WIRED | `fetch(uploadUrl, { method: 'PUT', body: ocrFile, ... })` |
| `TenantDetailClient.tsx handleOcrUpload` | `POST /api/superadmin/tenants/{id}/ocr-menu` | fetch step 3 | WIRED | `fetch(.../ocr-menu, { method: 'POST', body: JSON.stringify({ storagePath, menuId }) })` |

Note: The 11-03-PLAN key-link specified `ocr-process` as the step 3 route name. The actual route is `ocr-menu`. The UI correctly calls the route that exists. The plan spec diverged from the finalized implementation name before the route was created. Functionally correct; no remediation needed.

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ocr-menu/route.ts` | `ocrResult` (extracted categories/products) | generateObject with GPT-4.1-mini vision and OcrMenuSchema | Yes — live AI call against image downloaded from Supabase Storage | FLOWING |
| `ocr-menu/route.ts` | `existingCatNames` (deduplication set) | Supabase query: `.from('categories').select('name, id').eq('tenant_id').eq('menu_id')` | Yes — real DB query | FLOWING |
| `ocr-menu/route.ts` | `insertedCats` | Supabase insert: `.from('categories').insert(catsToInsert).select('id, name')` | Yes — real DB write | FLOWING |
| `ocr-menu/route.ts` | `productsCreated` counter | Supabase insert: `.from('products').insert(prodsToInsert).select('id')` | Yes — real DB write | FLOWING |
| `TenantDetailClient.tsx` | `ocrStatus.message` (success display) | `ocrData.categoriesCreated` and `ocrData.productsCreated` from POST ocr-menu response | Yes — API response with real DB-write counts | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for AI vision calls (require live OPENAI_API_KEY) and Supabase Storage operations (require live bucket). Routed to human verification.

TypeScript compilation check (runnable without external services):

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Zero TS errors across all phase files | npx tsc --noEmit | No output (0 errors) | PASS |
| ocr-menu route exports POST, runtime, maxDuration | Read route.ts | All three present | PASS |
| OcrMenuSchema contains price: z.number() not z.number().positive() | Read schemas.ts | `price: z.number()` confirmed | PASS |
| @ai-sdk/openai is at major version 3 | npm list @ai-sdk/openai | `@ai-sdk/openai@3.0.62` | PASS |
| OCR button disabled includes seedLoading and imageSeedLoading | Read TenantDetailClient.tsx line 791 | `disabled={ocrLoading \|\| !ocrFile \|\| !!imageSeedLoading \|\| seedLoading}` | PASS |
| Inline size check present at line 797 | Read TenantDetailClient.tsx line 797 | `ocrFile.size > 4 * 1024 * 1024` with amber warning text | PASS |
| imageSeedLoading state declared | Read TenantDetailClient.tsx line 74 | `const [imageSeedLoading, setImageSeedLoading] = useState<string \| null>(null)` | PASS |
| handleSeedImage handler present | Read TenantDetailClient.tsx lines 246-289 | Full handler with all three types: image_cover, image_products, image_single_product | PASS |
| Image Seeding JSX block present | Read TenantDetailClient.tsx lines 701-770 | Full block with Seed cover, Seed product images, single-product selector | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AI-10 | 11-01-PLAN, 11-02-PLAN (Task 2), 11-03-PLAN | Superadmin uploads menu photo directly to Supabase Storage, bypassing Vercel 4.5 MB body limit | SATISFIED | Two-step upload: GET ocr-upload-token returns signed URL; UI PUTs file directly to Supabase Storage (not through Vercel route body) |
| AI-11 | 11-02-PLAN (Task 1) | GPT-4.1-mini vision extracts categories, item names, and prices; writes to tenant's categories and products tables | SATISFIED | ocr-menu/route.ts: generateObject with openai('gpt-4.1-mini') and OcrMenuSchema; DB inserts for categories and products |
| AI-12 | 11-02-PLAN (Task 1) | OCR prices that fail parsing are saved as 0; superadmin can fix in admin UI | SATISFIED | route.ts: `price: p.price ?? 0`; OcrMenuSchema forces `z.number()` so 0 passes schema. Extracted items visible in regular admin UI where price can be edited |

No orphaned requirements: AI-10, AI-11, AI-12 all appear in plan frontmatter across plans 11-01, 11-02, 11-03 and are addressed by implemented code. All three are marked Complete in REQUIREMENTS.md.

---

### Anti-Patterns Found

No blockers or warnings. All previously flagged anti-patterns have been resolved:

| File | Line | Pattern | Severity | Resolution |
|------|------|---------|----------|------------|
| `TenantDetailClient.tsx` | 791 | OCR button disabled condition | RESOLVED | Now: `disabled={ocrLoading \|\| !ocrFile \|\| !!imageSeedLoading \|\| seedLoading}` |
| `TenantDetailClient.tsx` | 797-799 | File size warning | RESOLVED | Inline `ocrFile.size > 4 * 1024 * 1024` check with amber warning text |
| `TenantDetailClient.tsx` | 73-77 | Phase 10 image seeding state | RESOLVED | imageSeedLoading, imageSeedStatus, selectedProductId, menuProducts all restored |

---

### Cross-Phase Regression: Resolved

The Phase 10 image seeding UI regression (introduced by merge commit 2b2d296) has been fully remediated. The following were restored to TenantDetailClient.tsx:

- State variables: `imageSeedLoading` (line 74), `imageSeedStatus` (line 75), `selectedProductId` (line 76), `menuProducts` (line 77)
- useEffect: products-list fetch by category for single-product image seed (lines 148-158)
- Handler: `handleSeedImage()` with all three types — image_cover, image_products, image_single_product (lines 246-289)
- JSX: "Image seeding" sub-section with Seed cover, Seed product images buttons and single-product selector (lines 701-770)

The Image Seeding block now appears between the Per-item seeding block and the OCR photo upload block, in the correct order. Phase 10 requirements AI-07, AI-08, AI-09 are restored to the UI.

---

### Human Verification Required

#### 1. End-to-End OCR Flow with Real Menu Photo

**Test:** With OPENAI_API_KEY set in .env.local and Supabase tenant-assets bucket configured, navigate to superadmin `/tenants/{id}`, scroll to AI Tools, select a menu, choose a JPG/PNG of a printed menu card, click "Upload & Extract", wait up to 30 seconds.
**Expected:** Success banner shows "OCR complete. N categories and M products added." with counts matching the categories and items visible in the photo.
**Why human:** Requires live OpenAI API key, live Supabase Storage, and a real menu photo to verify GPT-4.1-mini extraction quality.

#### 2. Additive Write — Second Upload Does Not Duplicate

**Test:** Upload the same menu photo a second time to the same tenant+menu.
**Expected:** Success banner shows "No new items extracted — all detected items already exist."
**Why human:** Requires live DB state with previously extracted data.

#### 3. Price=0 for Unreadable Prices Is Visible and Editable in Admin UI

**Test:** Upload a menu photo where some prices are obscured or in non-numeric format. Check extracted products in the tenant's admin dashboard.
**Expected:** Products with unreadable prices appear with price 0.00; the superadmin can click to edit and set the correct price.
**Why human:** Requires a menu photo with unreadable prices and admin UI interaction to verify editability.

#### 4. 4 MB Soft Warning Appears in Browser

**Test:** Navigate to superadmin `/tenants/{id}`, scroll to AI Tools > Menu photo OCR, click the file input and select an image file larger than 4 MB.
**Expected:** The amber text "Large photos may take longer; results may vary." appears below the file input immediately upon file selection, before any upload button is clicked.
**Why human:** Requires browser interaction to select a large file; the inline conditional renders based on ocrFile state which is only populated by a real file picker event.

---

### Gaps Summary

All gaps resolved. Phase 11 fully achieves its goal: the superadmin can upload a photo of a tenant's physical menu and GPT-4.1-mini vision extracts structured categories and products that are written directly to the tenant's tables. The three-step upload flow (signed URL + direct PUT to Supabase Storage + POST processing route) is fully wired. AI-10, AI-11, and AI-12 requirements are all satisfied. The two previously missing UX requirements (D-15 size warning; mutual exclusion with other seed operations) are now implemented. The Phase 10 image seeding UI regression is fully restored.

---

_Verified: 2026-05-07T20:00:00Z_
_Verifier: Claude (gsd-verifier)_
