---
phase: 09-text-seeding
verified: 2026-05-06T00:00:00Z
status: gaps_found
score: 14/15 must-haves verified
gaps:
  - truth: "Gemini API key is configured for the seed route to call the LLM"
    status: failed
    reason: "GOOGLE_GENERATIVE_AI_API_KEY is absent from both .env.local and .env.example; the @ai-sdk/google SDK defaults to this env var and will throw at runtime without it"
    artifacts:
      - path: ".env.local"
        issue: "Missing GOOGLE_GENERATIVE_AI_API_KEY entry"
      - path: ".env.example"
        issue: "Missing GOOGLE_GENERATIVE_AI_API_KEY entry — new developers have no reference"
    missing:
      - "Add GOOGLE_GENERATIVE_AI_API_KEY=your-key-here to .env.example"
      - "Add real GOOGLE_GENERATIVE_AI_API_KEY value to .env.local"
human_verification:
  - test: "Navigate to a superadmin tenant detail page in a browser"
    expected: "AI Tools section is visible below the Tabs block with four bulk seed buttons and per-item seed section"
    why_human: "Visual layout and component rendering cannot be verified statically"
  - test: "Click 'Seed menu' with a valid tenant and menu selected"
    expected: "LLM call succeeds, categories and products appear in the tenant menu, success banner shows counts"
    why_human: "Requires live Gemini API key, running Supabase, and end-to-end POST execution"
  - test: "Click 'Seed product' after selecting a category from the dropdown"
    expected: "Single product inserted into that category; per-item Seeding... label shows during call"
    why_human: "Requires live environment and category selector populated from categories-list API"
---

# Phase 9: Text Seeding Verification Report

**Phase Goal:** Superadmin can trigger AI text seeding for any tenant from the superadmin panel — generating English categories, products, restaurant copy, and optional translations — with prompt injection mitigations and ai_usage cost tracking in place from day one
**Verified:** 2026-05-06
**Status:** gaps_found — 1 gap (missing Gemini API key in env)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ai_usage table SQL migration exists with correct schema and UNIQUE constraint | VERIFIED | `supabase/migrations/022_ai_usage.sql` lines 19-28: `CREATE TABLE IF NOT EXISTS ai_usage` with all required columns and `UNIQUE(tenant_id, feature_key, date)` |
| 2 | tenant_settings table gains business_type, tagline, about columns | VERIFIED | Migration 022 lines 11-14: `ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS business_type TEXT, tagline TEXT, about TEXT` |
| 3 | sanitizeForPrompt() strips injection chars and truncates | VERIFIED | `src/lib/ai/sanitize.ts`: strips `` ` {} <> \n\r ``, normalises whitespace, `.slice(0, maxLength)` |
| 4 | npm packages ai, @ai-sdk/google, zod installed | VERIFIED | `package.json`: `"ai": "^6.0.175"`, `"@ai-sdk/google": "^3.0.67"`, `"zod": "^4.4.3"`; `node_modules` dirs all present |
| 5 | AiUsage TypeScript type exported from src/types/database.ts | VERIFIED | Lines 157-165: `export interface AiUsage { id, tenant_id, feature_key, date, call_count, token_count, created_at }` |
| 6 | POST /api/superadmin/tenants/{id}/seed returns 401 for non-superadmins | VERIFIED | Route line 28-29: `await assertSuperadmin()` followed by `if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })` |
| 7 | All 6 seed types handled: menu, categories, products, copy, single_category, single_product | VERIFIED | Route lines 81-642: each type has its own conditional branch with LLM call and DB write |
| 8 | Additive-only inserts — existing names not overwritten | VERIFIED | Each branch pre-fetches existing names into a Set and filters before insert (e.g. lines 91, 117-119, 307, 355-356) |
| 9 | revalidatePath called after every successful DB write | VERIFIED | Route lines 431-434: `revalidatePath('/{slug}')` and `revalidatePath('/{slug}/{menu.slug}')` after all DB writes |
| 10 | ai_usage upsert fires non-blocking after every LLM call | VERIFIED | Route lines 416-428: wrapped in independent try/catch, errors logged but not rethrown; `onConflict: 'tenant_id,feature_key,date'` |
| 11 | Translations JSONB populated when menu.supported_languages has non-English locales | VERIFIED | Route lines 70-74: `langInstruction` built from `supportedLangs.filter(l => l !== 'en')`; passed into every prompt |
| 12 | Superadmin tenant detail page shows AI Tools section with all four bulk buttons | VERIFIED | `TenantDetailClient.tsx` lines 422-495: `AI Tools` heading, `Seed menu` (primary), `Seed categories`, `Seed products`, `Seed copy` (secondary) |
| 13 | Per-item Seed category and Seed product buttons present with category selector | VERIFIED | Lines 528-565: `Seed category` button calls `handleSeedSingle('single_category')`; `Seed product` button calls `handleSeedSingle('single_product', selectedCategoryId)`; category dropdown populated from `menuCategories` via `useEffect` |
| 14 | LLM inputs sanitized via sanitizeForPrompt before interpolation | VERIFIED | Route lines 48-49: `sanitizeForPrompt(businessType)` and `sanitizeForPrompt(companyName)` assigned to `safeBusinessType` / `safeCompanyName` before prompt construction |
| 15 | GOOGLE_GENERATIVE_AI_API_KEY configured for runtime Gemini calls | FAILED | Key absent from `.env.local` and `.env.example`; SDK reads this env var at call time and throws if missing |

**Score:** 14/15 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/022_ai_usage.sql` | ai_usage table + tenant_settings copy columns | VERIFIED | 47 lines; all required DDL present with RLS |
| `src/lib/ai/sanitize.ts` | sanitizeForPrompt utility | VERIFIED | 13 lines; named export only; regex strips all required chars |
| `src/types/database.ts` | AiUsage interface + TenantSettings extended | VERIFIED | AiUsage at line 157; business_type/tagline/about at lines 34-36 |
| `src/lib/ai/schemas.ts` | Four Zod schemas for LLM output | VERIFIED | 49 lines; MenuSeedSchema, CopySeedSchema, SingleCategorySeedSchema, SingleProductSeedSchema exported |
| `src/app/api/superadmin/tenants/[id]/seed/route.ts` | POST handler for all seed types | VERIFIED | 443 lines; all 6 types, auth guard, sanitize, ai_usage, revalidatePath |
| `src/app/(superadmin)/tenants/[id]/page.tsx` | Server component with business_type prop | VERIFIED | Fetches `logo_url, business_type` from tenant_settings; `supported_languages` from menus; passes `businessType` prop |
| `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` | AI Tools section UI | VERIFIED | Full AI Tools section with all state, handlers, buttons, banners, per-item section |
| `src/app/api/superadmin/tenants/[id]/menus/[menuId]/categories-list/route.ts` | Categories list endpoint for Seed product dropdown | VERIFIED | 21 lines; GET handler returns `{ categories: [...] }` with auth guard |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `seed/route.ts` | `src/lib/ai/sanitize.ts` | `import { sanitizeForPrompt }` | WIRED | Line 7; called at lines 48-49 |
| `seed/route.ts` | `categories` table | `service.from('categories').insert()` | WIRED | Lines 133, 329, 566 |
| `seed/route.ts` | `products` table | `service.from('products').insert()` | WIRED | Lines 188, 265, 384 |
| `seed/route.ts` | `tenant_settings` table | `service.from('tenant_settings').upsert()` | WIRED | Lines 288-294 (`type === 'copy'`) |
| `seed/route.ts` | `ai_usage` table | `service.from('ai_usage').upsert()` | WIRED | Lines 419-425; non-blocking try/catch |
| `seed/route.ts` | `next/cache` | `import { revalidatePath }` | WIRED | Line 5; called at lines 432-434 |
| `TenantDetailClient.tsx` | `/api/superadmin/tenants/{id}/seed` | `fetch POST in handleSeed` | WIRED | Lines 171-181; response handled and displayed |
| `TenantDetailClient.tsx` | `/api/superadmin/tenants/{id}/seed` | `fetch POST in handleSeedSingle` | WIRED | Lines 200-215; `categoryId` passed for single_product |
| `TenantDetailClient.tsx` | `categories-list` endpoint | `useEffect` fetch on `selectedMenuId` change | WIRED | Lines 128-135; populates `menuCategories` state |
| `page.tsx` | `TenantDetailClient.tsx` | `businessType` and `supported_languages` props | WIRED | Line 60: `businessType={settings?.business_type ?? null}`; `supported_languages` in menus select at line 51 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `TenantDetailClient.tsx` | `menuCategories` | `useEffect` → `categories-list` endpoint → DB query | Yes — `categories-list/route.ts` queries `categories` table with `.eq('tenant_id')` and `.eq('menu_id')` | FLOWING |
| `TenantDetailClient.tsx` | `menus` | `page.tsx` → `service.from('menus').select(...)` | Yes — server component queries menus table with tenant filter | FLOWING |
| `TenantDetailClient.tsx` | `businessType` prop | `page.tsx` → `settings?.business_type` from DB | Yes — queries `tenant_settings` table | FLOWING |
| `seed/route.ts` | LLM-generated objects | `generateObject(google('gemini-2.5-flash'), ...)` | Yes — live Gemini API call (blocked by missing API key at runtime) | HOLLOW at runtime until `GOOGLE_GENERATIVE_AI_API_KEY` is set |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for live LLM calls — requires running server + Gemini API key. Static checks passed; runtime behavior requires human verification.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| sanitizeForPrompt strips injection chars | `node -e "const {sanitizeForPrompt} = require('./src/lib/ai/sanitize.ts')"` — checked by reading implementation | Regex `/[{}<>\n\r]/g` + `.slice(0, maxLength)` present | PASS (static) |
| Zod v4 record schema valid | `node -e "const {z}=require('zod'); z.record(z.string(),z.any())"` | Returns schema object successfully | PASS |
| categories-list endpoint exists and queries DB | Read file | 21-line GET handler with DB query; returns `{ categories: data ?? [] }` | PASS (static) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AI-01 | 09-02 | Superadmin initiates text seeding from tenant detail page; writes to categories/products | SATISFIED | `TenantDetailClient.tsx` → `handleSeed` → POST `/seed`; `seed/route.ts` → `service.from('categories').insert()` and `service.from('products').insert()` |
| AI-02 | 09-02 | Generates English categories based on business type; respects existing (additive) | SATISFIED | Route uses `safeBusinessType` in prompts; pre-fetches `existingCatNames` Set; filters before insert |
| AI-03 | 09-02 | Generates English product names/descriptions for each category; respects existing | SATISFIED | `type === 'menu'` and `type === 'products'` branches; `existingProdNames` Set filters duplicates |
| AI-04 | 09-02 | Generates restaurant copy (tagline, about) for tenant profile | SATISFIED | `type === 'copy'` branch: `CopySeedSchema`, upserts `tenant_settings.tagline` and `tenant_settings.about` |
| AI-05 | 09-02 | Generates translations in enabled languages via `translations` JSONB | SATISFIED | `langInstruction` built from `menu.supported_languages`; injected into every prompt; stored in `translations` column |
| AI-06 | 09-03 | Superadmin sees Seed button next to Add category / Add product | SATISFIED | `TenantDetailClient.tsx`: `Seed category` and `Seed product` per-item buttons with category selector dropdown |
| AI-13 | 09-01 | LLM prompts sanitize tenant-supplied strings before interpolation | SATISFIED | `sanitizeForPrompt` called on `businessType` and `companyName` in route before all prompt interpolations |
| AI-14 | 09-02 | Public menu routes revalidated via `revalidatePath()` after AI writes | SATISFIED | Route lines 431-434: calls `revalidatePath('/{tenant.slug}')` and `revalidatePath('/{tenant.slug}/{menu.slug}')` after all DB writes |
| AI-15 | 09-01 | ai_usage table tracks calls per tenant per feature per day | SATISFIED | Migration 022 creates table; route upserts after each LLM call with `feature_key: 'text_seed'`, `call_count: 1`, `token_count: totalTokens` |

All 9 requirements covered. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.env.local` | — | `GOOGLE_GENERATIVE_AI_API_KEY` absent | Blocker | Every call to `google('gemini-2.5-flash')` will throw at runtime; the seed route is completely non-functional without this key |
| `.env.example` | — | `GOOGLE_GENERATIVE_AI_API_KEY` absent from template | Warning | New developers lack the env var reference; will not know the key is required |
| `src/lib/ai/schemas.ts` | 5 | `z.record(z.string(), z.any())` vs plan's `z.record(z.any())` | Info | The two-arg form is correct Zod v4 syntax (confirmed working); plan specified Zod v3-style single-arg which would fail in v4. Deviation is a fix, not a defect |

---

### Human Verification Required

#### 1. AI Tools Section Visual Layout

**Test:** Open any superadmin tenant detail page in a browser (e.g. `/tenants/{id}`)
**Expected:** AI Tools section appears below the Tabs/Menus block; four bulk seed buttons are visible; per-item section shows Seed category button and a category dropdown with Seed product
**Why human:** Visual rendering and layout positioning cannot be confirmed programmatically

#### 2. End-to-End Seed Flow (requires Gemini API key set)

**Test:** With `GOOGLE_GENERATIVE_AI_API_KEY` set in `.env.local`, click "Seed menu" for a tenant with a menu and a business type (e.g. "pizzeria")
**Expected:** Success banner appears with category and product counts; categories and products are visible in the tenant's admin menu editor
**Why human:** Requires live Gemini API, running Supabase, and full Next.js server

#### 3. Duplicate Prevention

**Test:** Click "Seed categories" twice in succession for the same menu
**Expected:** Second call adds 0 categories (all already exist); success banner says "Nothing added — all generated items already exist"
**Why human:** Requires live environment and DB state inspection

#### 4. Per-Item Seed Product with Category Selector

**Test:** In the per-item section, select a category from the dropdown, then click "Seed product"
**Expected:** The dropdown is populated from live categories; Seeding... label shows during call; product appears in the selected category
**Why human:** Requires `menuCategories` to be populated from the categories-list API call, which depends on a running server

---

### Gaps Summary

**1 blocker gap** prevents the phase from being fully production-ready:

**Missing Gemini API key** (`GOOGLE_GENERATIVE_AI_API_KEY`): The entire seed route depends on `google('gemini-2.5-flash')` from `@ai-sdk/google`. The SDK reads `GOOGLE_GENERATIVE_AI_API_KEY` from the environment at call time and throws an `AI_LoadAPIKeyError` if absent. Both `.env.local` (runtime) and `.env.example` (developer reference) are missing this key. All 6 seed type handlers will fail at the `generateObject(...)` call. The fix is a one-line addition to each file.

The structural implementation is complete and correct: all 6 seed types are handled, auth is guarded, sanitization is applied, ai_usage logging is non-blocking, revalidatePath is called, the UI is wired, and all 9 requirements have implementation evidence. The only thing preventing goal achievement is the absent runtime secret.

---

_Verified: 2026-05-06_
_Verifier: Claude (gsd-verifier)_
