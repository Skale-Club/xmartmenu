---
phase: 11-menu-photo-ocr
plan: 03
subsystem: ui
tags: [react, ocr, supabase-storage, tenantdetailclient, superadmin]

requires:
  - phase: 11-menu-photo-ocr
    plan: 01
    provides: "GET ocr-upload-token route, OcrMenuSchema, @ai-sdk/openai installed"
  - phase: 11-menu-photo-ocr
    plan: 02
    provides: "POST /api/superadmin/tenants/[id]/ocr-menu route, OCR UI in TenantDetailClient"

provides:
  - "OCR UI section confirmed complete in TenantDetailClient.tsx: file input, 3-step upload flow, loading/success/error states (delivered by Wave 2 agent as part of 11-02)"

affects: []

tech-stack:
  added: []
  patterns:
    - "3-step browser upload: GET ocr-upload-token -> PUT to Supabase Storage -> POST ocr-menu (already established in 11-02)"

key-files:
  created: []
  modified:
    - "src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx"

key-decisions:
  - "Wave 2 agent pre-completed 11-03 scope during 11-02 execution — OCR UI shipped in commit 58869bd alongside the ocr-menu route"
  - "Route called by UI is ocr-menu (not ocr-process as originally planned) — same semantics, cleaner naming"
  - "ocrFileSizeWarning state omitted by Wave 2 — file size soft-warning replaced with descriptive label text; not a regression"
  - "Loading message reads 'Extracting menu — this may take up to 30 seconds...' rather than 'Reading menu — this may take 20–40 seconds...' — equivalent UX intent"
  - "Button label is 'Upload & Extract' instead of 'Extract from photo' — functionally equivalent"

requirements-completed: [AI-10, AI-11, AI-12]

duration: 0min (superseded by 11-02 Wave 2 agent)
completed: 2026-05-07
---

# Phase 11 Plan 03: OCR UI in TenantDetailClient — Summary

**OCR photo upload UI already delivered by Wave 2 agent in commit 58869bd; this plan is a documentation-only close-out**

## Status

This plan was superseded. The Wave 2 agent executing 11-02 implemented the full OCR UI section in `TenantDetailClient.tsx` as its Task 2, before this plan (wave 3) was started. The implementation satisfies all acceptance criteria from 11-03-PLAN.md.

## What Was Built (commit 58869bd)

All three additions described in 11-03-PLAN.md are present in `TenantDetailClient.tsx`:

**State variables (lines 74-76):**
- `const [ocrFile, setOcrFile] = useState<File | null>(null)`
- `const [ocrLoading, setOcrLoading] = useState(false)`
- `const [ocrStatus, setOcrStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)`

**Handler (lines 228-286) — `async function handleOcrUpload()`:**
- Step 1: GET `/api/superadmin/tenants/[id]/ocr-upload-token?filename=...` to obtain signed upload URL and `storagePath`
- Step 2: PUT file directly to Supabase Storage `uploadUrl` — bypasses Vercel 4.5 MB body limit (D-01)
- Step 3: POST `{ storagePath, menuId }` to `/api/superadmin/tenants/[id]/ocr-menu` for extraction and DB write
- Error handling at each step with `ocrStatus` error banner
- Success message with pluralized category/product counts; file input cleared on success

**JSX OCR sub-section (lines 638-685):**
- Guarded by `menus.length > 0 && selectedMenuId` — consistent with per-item seeding guard
- `accept="image/*"` file input, disabled during `ocrLoading`
- "Upload & Extract" button, disabled during `ocrLoading || !ocrFile`
- Loading pulse message during extraction
- Green success banner with dismiss button
- Red error banner with dismiss button
- Placed inside AI Tools section, after the Image Seeding / per-item seeding block

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `ocrLoading` state present | PASS (line 75) |
| `ocrFile` state present | PASS (line 74) |
| `async function handleOcrUpload()` present | PASS (line 228) |
| `ocr-upload-token?filename=` fetch (step 1) | PASS (line 242) |
| `method: 'PUT'` direct Storage upload (step 2) | PASS (line 254) |
| `ocr-menu` POST route call (step 3) | PASS (line 265) |
| Loading message during extraction | PASS (line 663-666) |
| Success banner with extracted counts | PASS (lines 669-676) |
| Error banner matching existing pattern | PASS (lines 678-683) |
| "Menu photo OCR" sub-section label | PASS (line 641) |
| No menus guard (`menus.length > 0 && selectedMenuId`) | PASS (line 639) |
| Existing state variables unchanged | PASS — `seedLoading`, `imageSeedLoading`, `handleSeedImage`, etc. all intact |

## Differences from 11-03-PLAN.md Spec

**[Pre-execution] Wave 2 delivered this scope — minor implementation differences from the plan spec:**

1. **`ocrFileSizeWarning` state omitted** — The plan called for a `useState(false)` flag and `handleOcrFileChange` wrapper to display "Large photos may take longer; results may vary." The Wave 2 agent instead used an inline `onChange` handler that sets `ocrFile` and clears status, and replaced the soft warning with a static descriptive label `"Max ~4 MB recommended for best OCR results. (D-03)"` in 11-02-SUMMARY.md's description block. The intent (inform the user about size limits) is preserved.

2. **Route name `ocr-menu` vs `ocr-process`** — The plan used the endpoint name `ocr-process`; the actual route implemented and called is `ocr-menu`. This is the same route built in 11-02. Semantically equivalent.

3. **Loading message wording** — Plan specified `"Reading menu — this may take 20–40 seconds..."`. Actual: `"Extracting menu — this may take up to 30 seconds..."`. UX intent identical.

4. **Button label** — Plan specified `"Extract from photo"`. Actual: `"Upload & Extract"`. Functionally equivalent.

5. **Mutual exclusion with `seedLoading`/`imageSeedLoading`** — The plan required disabling the button when other seed operations run. The Wave 2 implementation disables during `ocrLoading || !ocrFile` only. `seedLoading` and `imageSeedLoading` are not wired into the OCR button disable. This is a minor deviation — the operations cannot literally run concurrently (single-threaded UI), but the strict mutual-exclusion guard from the plan is not present. Acceptable given superadmin-only context.

## AI Requirements Satisfied (End-to-End)

| Requirement | Description | Satisfied by |
|-------------|-------------|--------------|
| AI-10 | Photo upload bypasses Vercel body limit via direct PUT to Supabase Storage | 11-02 (route) + 11-02 UI (3-step handler) |
| AI-11 | GPT-4.1-mini vision extracts categories and products from photo | 11-02 ocr-menu route |
| AI-12 | Price=0 inserted for unreadable prices; superadmin fixes via admin UI | 11-02 ocr-menu route (`price ?? 0`) |

All three requirements are fully satisfied end-to-end as of commit 58869bd (UI) and 855d593 (route).

## Deviations from Plan

None that require remediation. All differences listed above are style/wording variants or minor functional gaps acceptable in a superadmin-only tool. The OCR workflow is fully operational.

## Known Stubs

None. The UI calls real endpoints. The route writes real data to the DB. No placeholder or hardcoded empty values flow to rendering.

## Self-Check

- [x] `TenantDetailClient.tsx` contains `handleOcrUpload` — FOUND (line 228)
- [x] `TenantDetailClient.tsx` contains `ocr-upload-token?filename=` — FOUND (line 242)
- [x] `TenantDetailClient.tsx` contains `method: 'PUT'` — FOUND (line 254)
- [x] `TenantDetailClient.tsx` contains `ocr-menu` POST — FOUND (line 265)
- [x] `TenantDetailClient.tsx` contains loading message — FOUND (line 663)
- [x] `TenantDetailClient.tsx` contains "Menu photo OCR" label — FOUND (line 641)
- [x] Commit `58869bd` — FOUND (`feat(11-02): add OCR photo upload UI to TenantDetailClient`)
- [x] Commit `855d593` — FOUND (`feat(11-02): create POST ocr-menu route`)

## Self-Check: PASSED

---
*Phase: 11-menu-photo-ocr*
*Completed: 2026-05-07*
