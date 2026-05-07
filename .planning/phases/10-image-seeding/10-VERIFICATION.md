---
phase: 10-image-seeding
verified: 2026-05-07T14:30:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
human_verification:
  - test: "Seed cover — end-to-end Gemini call"
    expected: "Clicking Seed cover calls Gemini, returns WebP, stores {tenant_id}/banner.webp in tenant-assets bucket, writes tenant_settings.banner_url, and shows success banner"
    why_human: "Requires live Gemini API key and Supabase Storage; cannot verify without running the dev server against real credentials"
  - test: "Additive guard — second Seed cover returns skipped"
    expected: "Clicking Seed cover again on a tenant that already has banner_url set returns the banner message immediately without calling Gemini"
    why_human: "Requires live DB state"
  - test: "Seed product images — bulk loop and partial success"
    expected: "All products with image_url IS NULL receive a 1:1 WebP image; products that already have image_url are silently skipped; ai_usage is incremented per Gemini call"
    why_human: "Requires live Gemini API and DB with products"
  - test: "Single-product Seed image via product selector"
    expected: "Selecting a category, then a product from the dropdown, then clicking Seed image generates and writes exactly one image to products.image_url for that product"
    why_human: "Requires live Gemini API and UI interaction"
---

# Phase 10: Image Seeding Verification Report

**Phase Goal:** Superadmin can trigger image seeding for a tenant — generating a cover/banner photo and per-product photos via Nano Banana 2 (Gemini 3 Pro Image) — all uploaded directly to Supabase Storage as WebP
**Verified:** 2026-05-07T14:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /seed-image with type=image_cover generates Gemini image, converts to WebP, uploads to tenant-assets as {tenant_id}/banner.webp, updates tenant_settings.banner_url | VERIFIED | route.ts lines 70–149: generateImage() call, Buffer.from(base64), convertBufferToWebP(), storage.from('tenant-assets').upload(), tenant_settings.upsert({banner_url}) |
| 2 | POST /seed-image with type=image_products generates WebP images for all products where image_url IS NULL, writes product.image_url for each | VERIFIED | route.ts lines 152–257: .is('image_url', null) filter, loop over products, convertBufferToWebP(), .update({ image_url: publicUrl }) per product |
| 3 | POST /seed-image with type=image_single_product generates a WebP image for one product by productId, writes products.image_url only if image_url IS NULL | VERIFIED | route.ts lines 260–345: productId guard, .select('image_url'), skip if set, generateImage(), .update({ image_url: publicUrl }) |
| 4 | Cover seeding is additive: if banner_url already set, returns {success: true, skipped: true} without calling Gemini | VERIFIED | route.ts lines 71–80: .select('banner_url'), if(settings?.banner_url) return {success:true, skipped:true} before any generateImage() call |
| 5 | Per-product seeding is additive: products with existing image_url are silently skipped | VERIFIED | image_products uses .is('image_url', null) on fetch (never fetches existing-image products); image_single_product checks product.image_url and returns skipped if set |
| 6 | ai_usage is upserted after every Gemini call with feature_key='image_cover' or 'image_product' | VERIFIED | route.ts lines 131–138 (cover), 218–228 (per-product loop), 327–334 (single); feature_key: 'image_cover' and 'image_product' respectively |
| 7 | revalidatePath() is called after every successful write | VERIFIED | route.ts lines 143–146 (cover), 245–247 (bulk products), 339–341 (single product); revalidatePath called for tenant.slug and menu.slug paths |
| 8 | Route uses export const runtime = 'nodejs' and export const maxDuration = 300 | VERIFIED | route.ts lines 11–14: `export const runtime = 'nodejs'` and `export const maxDuration = 300` |

**Score:** 8/8 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/upload.ts` | Exports convertBufferToWebP(input: Buffer): Promise<Buffer> | VERIFIED | Lines 35–37: function exists, uses sharp(input).webp({ quality: 85 }).toBuffer(); existing validateAndConvertToWebP untouched; no duplicate import sharp |
| `src/app/api/superadmin/tenants/[id]/seed-image/route.ts` | POST handler for image_cover, image_products, image_single_product | VERIFIED | 349-line file; all three types implemented with full pipeline; exports POST, runtime, maxDuration |
| `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` | Image seeding UI inside AI Tools section | VERIFIED | Lines 73–77: state variables; lines 241–294: handleSeedImage(); lines 646–723: Image seeding JSX sub-section |
| `src/app/api/superadmin/tenants/[id]/menus/[menuId]/products-list/route.ts` | Products-list endpoint for single-product selector | VERIFIED | 31-line file; GET handler filters by categoryId, returns { products: [{id, name}] }; DB query is real (not static) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| seed-image/route.ts | google.image('gemini-3.1-flash-image-preview') | generateImage() from 'ai' | WIRED | Line 3: `import { generateImage } from 'ai'`; line 88/178/284: `generateImage({ model: google.image('gemini-3.1-flash-image-preview'), ... })` |
| seed-image/route.ts | src/lib/upload.ts | convertBufferToWebP() | WIRED | Line 8: `import { convertBufferToWebP } from '@/lib/upload'`; called at lines 97, 187, 291 |
| seed-image/route.ts | supabase storage tenant-assets bucket | service.storage.from('tenant-assets').upload() | WIRED | Lines 101–107, 191–197, 296–302: .from('tenant-assets').upload() with upsert:true, contentType:'image/webp' |
| seed-image/route.ts | tenant_settings.banner_url | service.from('tenant_settings').upsert() | WIRED | Line 116–117: .upsert({ tenant_id: tenantId, banner_url: publicUrl }, { onConflict: 'tenant_id' }) |
| seed-image/route.ts | products.image_url | service.from('products').update() | WIRED | Lines 209–213, 310–313: .update({ image_url: publicUrl }).eq('id', ...).eq('tenant_id', ...) — singular column confirmed, not image_urls |
| TenantDetailClient.tsx handleSeedImage() | /api/superadmin/tenants/{id}/seed-image | fetch POST with body | WIRED | Line 267: `fetch('/api/superadmin/tenants/${tenant.id}/seed-image', { method: 'POST', ... })` |
| Product selector | menuProducts state | fetch products-list?categoryId= | WIRED | Lines 143–153: useEffect watches selectedCategoryId, fetches products-list endpoint, sets menuProducts; selector renders menuProducts at lines 694–696 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| seed-image/route.ts | products (for bulk) | Supabase query: .from('products').select().is('image_url', null) | Yes — DB query with IS NULL filter | FLOWING |
| seed-image/route.ts | product.image_url (single) | Supabase query: .from('products').select('image_url').eq('id', productId) | Yes — DB query | FLOWING |
| seed-image/route.ts | settings.banner_url (additive guard) | Supabase query: .from('tenant_settings').select('banner_url') | Yes — DB query | FLOWING |
| products-list/route.ts | products | Supabase query: .from('products').select('id, name').eq('category_id', categoryId) | Yes — filtered DB query | FLOWING |
| TenantDetailClient.tsx | menuProducts | Fetch /products-list?categoryId= → JSON.products | Yes — real DB-backed endpoint | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for Gemini API calls and Supabase Storage operations (require live external services). The following checks are routed to human verification.

TypeScript compilation check (runnable without external services):

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Zero TS errors across all phase files | npx tsc --noEmit | No output (0 errors) | PASS |
| products-list route exports GET with real query | Read route.ts | DB query present, returns { products: data ?? [] } | PASS |
| image_urls (forbidden column) not used as update target | grep image_urls route.ts | Only in comment on line 207 (not as update key) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AI-07 | 10-01-PLAN, 10-02-PLAN | Superadmin triggers cover/banner photo generation via Nano Banana 2, converts to WebP, uploads to Supabase Storage | SATISFIED | route.ts image_cover branch: generateImage() with google.image('gemini-3.1-flash-image-preview'), convertBufferToWebP(), storage upload with contentType:'image/webp', tenant_settings.banner_url written |
| AI-08 | 10-01-PLAN, 10-02-PLAN | Per-product photo generation for products without image_url, converts to WebP, uploads as image_url | SATISFIED | route.ts image_products branch: .is('image_url', null) filter, loop with generateImage(), convertBufferToWebP(), products.image_url updated per product |
| AI-09 | 10-01-PLAN, 10-02-PLAN | Per-product Seed image control in superadmin UI; generates image for one product; never overwrites existing image_url | SATISFIED | TenantDetailClient product selector wired via products-list endpoint; handleSeedImage('image_single_product') posts productId; route checks product.image_url and skips if set |

No orphaned requirements: all three AI-07, AI-08, AI-09 appear in both plan frontmatter and are addressed by implemented code.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| seed-image/route.ts | 207 | Comment mentions image_urls | Info | Not a stub — comment documents the avoided mistake; update target is image_url (correct) |
| TenantDetailClient.tsx | 390, 394, 510 | `placeholder=` attribute | Info | HTML input placeholder text for user-facing form fields — not code stubs |

No blocker anti-patterns found. No TODO, FIXME, return null, return [], or hardcoded empty data patterns in phase-specific code paths.

---

### Implementation Note: Plan Deviation (products-list endpoint)

The 10-02-PLAN originally proposed reusing the `categories-list` endpoint to populate `menuProducts` by filtering from the categories response. The actual implementation instead creates a dedicated `/products-list?categoryId=` route (`src/app/api/superadmin/tenants/[id]/menus/[menuId]/products-list/route.ts`), which is a cleaner approach. The TenantDetailClient useEffect calls this correct endpoint at line 146. This deviation improves the implementation without violating any requirement or truth.

---

### Human Verification Required

#### 1. Seed Cover — End-to-End Gemini Pipeline

**Test:** On the superadmin tenant detail page for a tenant with no banner_url set, click "Seed cover" in the Image seeding sub-section of AI Tools.
**Expected:** Loading state "Generating cover photo — this may take up to 30 seconds..." appears; after 15–30s a green success banner shows "Cover image generated and uploaded."; Supabase Storage tenant-assets bucket contains `{tenant_id}/banner.webp`; `tenant_settings.banner_url` is set to a public URL.
**Why human:** Requires live GOOGLE_GENERATIVE_AI_API_KEY and Supabase Storage credentials.

#### 2. Additive Guard — Second Seed Cover

**Test:** Click "Seed cover" again on the same tenant (banner_url already set from test 1).
**Expected:** Response is immediate (no Gemini call); success banner shows "Banner already set. Clear it in Branding settings to re-seed."
**Why human:** Requires live DB state from test 1.

#### 3. Seed Product Images — Bulk

**Test:** Click "Seed product images" for a menu that has at least one product with image_url IS NULL.
**Expected:** Loading message "Generating images — this may take several minutes. Keep this tab open." appears; after completion, success banner shows "{N} product image(s) generated and uploaded."; each processed product has image_url set in DB; ai_usage records incremented.
**Why human:** Requires live Gemini API and DB with unseeded products.

#### 4. Single-Product Seed Image via Selector

**Test:** Select a category in the per-item seeding block; the product selector in the Image seeding block populates with products from that category; select one product; click "Seed image".
**Expected:** "Generating..." appears on the button; after completion, green success banner "Product image generated and uploaded."; `products.image_url` is set (not `image_urls`).
**Why human:** Requires UI interaction, live Gemini API, and DB.

---

### Gaps Summary

No gaps found. All eight observable truths are fully verified in the codebase. All three required artifacts exist, are substantive, are wired, and data flows through them via real DB queries and real API calls. All key links are confirmed. TypeScript compiles with zero errors. Requirements AI-07, AI-08, and AI-09 are accounted for and satisfied.

The only items pending are four human verification scenarios that require live external services (Gemini API + Supabase Storage) — these are by nature unverifiable programmatically.

---

_Verified: 2026-05-07T14:30:00Z_
_Verifier: Claude (gsd-verifier)_
