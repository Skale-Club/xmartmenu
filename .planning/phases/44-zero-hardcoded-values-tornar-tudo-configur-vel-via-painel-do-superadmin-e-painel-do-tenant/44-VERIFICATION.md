---
phase: 44-zero-hardcoded-values
verified: 2026-05-20T00:00:00Z
status: passed
score: 6/6 must-haves verified
gaps: []
human_verification:
  - test: "Superadmin saves seo_title in Settings panel and marketing page <title> updates within 60 s"
    expected: "Browser tab title and OG title reflect saved value after ISR cache window"
    why_human: "Requires a running server and live Supabase DB to observe the ISR revalidation cycle"
  - test: "Superadmin saves app_name and sidebar brand text updates without page reload"
    expected: "Sidebar brand link renders new app_name after next page load"
    why_human: "Requires authenticated superadmin session; cannot verify UI rendering programmatically"
  - test: "Public menu footer shows configured menu_footer_brand instead of 'XmartMenu'"
    expected: "Footer 'Powered by' link renders the DB value from platform_settings.menu_footer_brand"
    why_human: "Requires running app with migration 045 applied and platform_settings row set"
---

# Phase 44: Zero Hardcoded Values — Verification Report

**Phase Goal:** Eliminate all hardcoded values from the system — everything configurable must come from platform_settings (superadmin panel) or tenant_settings (tenant panel).
**Verified:** 2026-05-20
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration 045 adds cta_color, seo_title, seo_description to platform_settings with IF NOT EXISTS guards | VERIFIED | `supabase/migrations/045_platform_settings_columns.sql` exists; node verification script confirms all 3 columns + 3× IF NOT EXISTS |
| 2 | PATCH route allowed list includes seo_title and seo_description | VERIFIED | Line 18 of `settings/route.ts` contains `'seo_title'` and `'seo_description'` |
| 3 | HowItWorks and FeatureBlocks receive data props from platformLanding (not hardcoded) | VERIFIED | Both functions accept typed data props; ClientLandingPage passes `platformLanding?.how_it_works` and `platformLanding?.features` |
| 4 | FooterCTABand, Footer, and Nav receive props from platformLanding/appName | VERIFIED | All three components accept typed props; render body passes `platformLanding?.cta`, `platformLanding?.footer`, `appName` |
| 5 | Marketing layout exports generateMetadata() reading seo_title, seo_description, app_name | VERIFIED | `src/app/(marketing)/layout.tsx` exports `async function generateMetadata()`; static `export const metadata` is absent; `revalidate = 60` present |
| 6 | Both public menu pages pass footerBrand from platform_settings to MenuPage | VERIFIED | Both `[slug]/page.tsx` and `[slug]/[menuSlug]/page.tsx` query `menu_footer_brand` and pass `footerBrand={footerBrand}` to MenuPage |
| 7 | Superadmin sidebar brand uses ps?.app_name (not hardcoded) | VERIFIED | `src/app/(superadmin)/layout.tsx` line 47: `{ps?.app_name ?? 'XmartMenu'}`; no literal `>XmartMenu<` in JSX |

**Score:** 6/6 requirements verified (7/7 observable truths verified)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/045_platform_settings_columns.sql` | ALTER TABLE adding cta_color, seo_title, seo_description with IF NOT EXISTS | VERIFIED | File exists; 9 lines; 3× IF NOT EXISTS; correct DEFAULT '#EEFF00' on cta_color |
| `src/app/api/superadmin/settings/route.ts` | PATCH allowed list includes seo_title and seo_description | VERIFIED | Line 18: full allowed array including both fields |
| `src/app/(public)/[slug]/page.tsx` | footerBrand fetched from platform_settings and passed to MenuPage | VERIFIED | Lines 77-79 fetch + assign; line 216 passes prop |
| `src/app/(public)/[slug]/[menuSlug]/page.tsx` | footerBrand fetched from platform_settings and passed to MenuPage | VERIFIED | Lines 83-85 fetch + assign; line 235 passes prop |
| `src/app/(marketing)/ClientPage.tsx` | All section components accept data/appName props with fallbacks | VERIFIED | HowItWorks, FeatureBlocks, FooterCTABand, Footer, Nav all have correct signatures; render body wires platformLanding sub-keys |
| `src/app/(marketing)/page.tsx` | Fetches landing and app_name; passes both to ClientLandingPage | VERIFIED | `select('landing, app_name')` on line 10; `appName={appName}` prop on line 63 |
| `src/app/(marketing)/layout.tsx` | Exports generateMetadata() reading seo_title, seo_description, app_name, cta_color | VERIFIED | Full async generateMetadata export; shared getPlatformSettings() helper; revalidate = 60 |
| `src/app/(superadmin)/layout.tsx` | Sidebar brand renders ps?.app_name | VERIFIED | select includes `app_name`; JSX uses `{ps?.app_name ?? 'XmartMenu'}` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `settings/route.ts` PATCH | platform_settings | allowed list filter | WIRED | seo_title + seo_description present in allowed array; update loop writes to DB |
| `[slug]/page.tsx` | MenuPage | footerBrand prop | WIRED | platform_settings queried; value assigned; prop passed to MenuPage which renders it at line 754 |
| `[slug]/[menuSlug]/page.tsx` | MenuPage | footerBrand prop | WIRED | Same pattern; prop passed inside `menuPageEl` at line 235 |
| `ClientPage.tsx HowItWorks` | platformLanding.how_it_works.steps | data prop | WIRED | `<HowItWorks data={platformLanding?.how_it_works} />` at line 521 |
| `ClientPage.tsx FeatureBlocks` | platformLanding.features.items | data prop | WIRED | `<FeatureBlocks data={platformLanding?.features} />` at line 522 |
| `ClientPage.tsx FooterCTABand` | platformLanding.cta | data prop | WIRED | `<FooterCTABand data={platformLanding?.cta} />` at line 524 |
| `ClientPage.tsx Footer` | platformLanding.footer + appName | data + appName props | WIRED | `<Footer data={platformLanding?.footer} appName={appName} />` at line 526 |
| `(marketing)/layout.tsx generateMetadata` | platform_settings | getPlatformSettings() select | WIRED | Selects app_name, seo_title, seo_description, cta_color in one call; result used in all Metadata fields |
| `(superadmin)/layout.tsx` | platform_settings.app_name | select('cta_color, app_name') | WIRED | Promise.all includes app_name; sidebar brand link renders `{ps?.app_name ?? 'XmartMenu'}` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ClientPage.tsx HowItWorks` | `data?.steps` | `platformLanding?.how_it_works` from DB | Yes — DB JSONB; falls back to hardcoded constant when null | FLOWING |
| `ClientPage.tsx FeatureBlocks` | `data?.items` | `platformLanding?.features` from DB | Yes — DB JSONB; falls back to hardcoded constant when null | FLOWING |
| `ClientPage.tsx FooterCTABand` | `data?.heading/text/button` | `platformLanding?.cta` from DB | Yes — DB JSONB with string fallbacks | FLOWING |
| `ClientPage.tsx Footer` | `appName`, `data?.copyright` | `app_name` from DB + `platformLanding?.footer` | Yes — real DB columns; fallback to 'XmartMenu' / hardcoded copyright | FLOWING |
| `(marketing)/layout.tsx` generateMetadata | `ps?.seo_title`, `ps?.app_name` | `getPlatformSettings()` → platform_settings | Yes — DB read with NULL-safe fallbacks | FLOWING |
| `(superadmin)/layout.tsx` brand | `ps?.app_name` | platform_settings in Promise.all | Yes — DB read in layout server component | FLOWING |
| `MenuPage` footerBrand | `footerBrand` prop | platform_settings.menu_footer_brand via page.tsx | Yes — DB read in RSC, rendered at line 754 | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — verification is against static file content; running app and live DB required to exercise ISR revalidation and DB reads. Human verification items listed below cover these behaviors.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CFG-01 | 44-01 | Migration 045 adds cta_color, seo_title, seo_description to platform_settings | SATISFIED | `supabase/migrations/045_platform_settings_columns.sql` exists with all 3 columns + IF NOT EXISTS guards |
| CFG-02 | 44-02 | HowItWorks and FeatureBlocks sections in ClientPage.tsx receive props from platformLanding | SATISFIED | Both components accept typed data props; render body passes platform_settings.landing sub-keys |
| CFG-03 | 44-02 | Footer, FooterCTABand, Nav sections in ClientPage.tsx receive props from platformLanding | SATISFIED | All three components accept typed props; data flows from platform_settings.landing JSONB |
| CFG-04 | 44-03 | (marketing)/layout.tsx exports generateMetadata() reading from platform_settings | SATISFIED | Async generateMetadata export present; static metadata export absent; seo_title, seo_description, app_name all read from DB |
| CFG-05 | 44-01 | Both public menu pages pass footerBrand to MenuPage; PATCH allowed list includes seo fields | SATISFIED | Both pages fetch menu_footer_brand and pass footerBrand prop; route.ts allowed list confirmed |
| CFG-06 | 44-03 | (superadmin)/layout.tsx renders ps?.app_name in sidebar brand link | SATISFIED | Line 47: `{ps?.app_name ?? 'XmartMenu'}`; no hardcoded >XmartMenu< in JSX |

All 6 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/(marketing)/layout.tsx` | 19 | `return null` in catch block | Info | Legitimate error fallback in getPlatformSettings(); all callers handle null via `?? fallback` — not a stub |

No blockers or warnings found. The single `return null` is in a `catch {}` block that is properly consumed by `ps?.field ?? defaultValue` patterns throughout — this is correct defensive error handling.

---

### Human Verification Required

#### 1. Marketing page <title> reflects seo_title from DB

**Test:** Log in as superadmin, navigate to Settings, set `seo_title` to a custom value, save. Wait 60 seconds (ISR window), then open the marketing page in an incognito window and inspect the `<title>` tag.
**Expected:** `<title>` and OG title match the saved value.
**Why human:** Requires a running Next.js server, applied migration 045, and a live Supabase row with seo_title set.

#### 2. Superadmin sidebar brand reflects app_name

**Test:** Set `app_name` to a custom value via Settings. Reload any superadmin page.
**Expected:** Sidebar brand link renders the new app_name instead of 'XmartMenu'.
**Why human:** Requires authenticated superadmin session and live DB.

#### 3. Public menu footer brand reflects menu_footer_brand

**Test:** Set `menu_footer_brand` to a custom value via Settings. Wait for ISR revalidation (60 s) or hard reload. Open a public menu page (e.g. `/some-tenant-slug`).
**Expected:** Footer "Powered by" link shows the configured brand name.
**Why human:** Requires migration 045 applied in production DB and a live tenant with public menu.

---

### Gaps Summary

No gaps. All 6 requirements verified at all four levels (exists, substantive, wired, data-flowing). The three human verification items are confirmatory — they verify end-to-end runtime behavior but the code paths are complete and correct in the codebase.

---

_Verified: 2026-05-20_
_Verifier: Claude (gsd-verifier)_
