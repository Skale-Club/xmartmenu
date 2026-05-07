---
phase: 13-seo-metadata
verified: 2026-05-07T23:50:00Z
status: human_needed
score: 4/4 must-haves verified
human_verification:
  - test: "WhatsApp link preview renders OG image on a real device"
    expected: "Pasting https://xmartmenu.skale.club into a WhatsApp chat shows the XmartMenu branded image (dark background, white text)"
    why_human: "WhatsApp preview requires a real mobile device or WhatsApp Desktop — cannot be automated"
  - test: "Google Rich Results Test passes for both JSON-LD schemas"
    expected: "https://search.google.com/test/rich-results with https://xmartmenu.skale.club detects Organization and SoftwareApplication with no errors or warnings"
    why_human: "Requires Google's live crawler against a deployed URL — cannot be run locally"
  - test: "JSON-LD is absent from tenant menu pages"
    expected: "curl -s http://localhost:3000/{any-tenant-slug} | grep 'ld+json' returns no output"
    why_human: "Requires a tenant slug to exist in the DB — cannot create test tenant without running the app against Supabase"
  - test: "Update SEO-04 row in REQUIREMENTS.md from Pending to Complete"
    expected: "| SEO-04 | Phase 13 — SEO & Metadata | Complete |"
    why_human: "Documentation discrepancy — SEO-04 row is still marked Pending in REQUIREMENTS.md despite all implementation being verified. A human should confirm and update."
---

# Phase 13: SEO Metadata Verification Report

**Phase Goal:** Ship SEO metadata for the landing page — sitemap.xml, robots.txt, JSON-LD structured data, and a verified OG image under the 300 KB WhatsApp limit.
**Verified:** 2026-05-07T23:50:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /sitemap.xml returns XML listing only the root URL — no tenant slugs appear | VERIFIED | `.next/server/app/sitemap.xml.body` contains exactly one `<loc>https://xmartmenu.skale.club</loc>` — no other entries |
| 2 | GET /robots.txt shows Disallow entries for /api/, /admin, and /superadmin | VERIFIED | `.next/server/app/robots.txt.body` includes `Disallow: /api/`, `Disallow: /admin`, `Disallow: /superadmin` plus 9 additional private paths, and `Sitemap:` line |
| 3 | JSON-LD Organization + SoftwareApplication blocks appear in the landing page HTML | VERIFIED | Prerendered `index.html` contains both `<script type="application/ld+json">` blocks with correct `@type: Organization` and `@type: SoftwareApplication` values, inline before `<nav>` |
| 4 | OG image is served at /opengraph-image under 300 KB | VERIFIED | `.next/server/app/opengraph-image.body` is exactly 33421 bytes (32.6 KB) — 9x under the 300 KB limit; `og:image` meta tag present in prerendered HTML with absolute URL `https://xmartmenu.skale.club/opengraph-image?55d30fe810fa03f5` |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/sitemap.ts` | MetadataRoute.Sitemap with single / entry | VERIFIED | 14 lines, exports `MetadataRoute.Sitemap`, single entry for `BASE_URL`, no Supabase imports, no dynamic flag |
| `src/app/robots.ts` | MetadataRoute.Robots with Disallow rules | VERIFIED | 28 lines, exports `MetadataRoute.Robots`, `allow: '/'`, disallow array has 13 entries including `/api/`, `/admin`, `/superadmin`, `sitemap:` URL set |
| `src/app/(marketing)/page.tsx` | JSON-LD Organization + SoftwareApplication scripts | VERIFIED | Two `<script type="application/ld+json" dangerouslySetInnerHTML>` blocks at top of LandingPage() return, XSS escape `.replace(/</g, '\\u003c')` applied to both, schema-dts types used |
| `src/app/opengraph-image.tsx` | ImageResponse serving PNG under 300 KB | VERIFIED | Located at root `src/app/` level (not in route group), exports `alt`, `size`, `contentType = 'image/png'`, pure flat CSS ImageResponse with no `fetch()` calls |
| `src/app/layout.tsx` | metadataBase set, openGraph.images pointing to /opengraph-image | VERIFIED | `metadataBase: new URL('https://xmartmenu.skale.club')`, `openGraph.images: [{ url: '/opengraph-image', width: 1200, height: 630 }]` |
| `src/app/(marketing)/layout.tsx` | openGraph.images pointing to /opengraph-image | VERIFIED | `openGraph.images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: '...' }]`, `twitter.images: ['/opengraph-image']` |
| `package.json` devDependencies | schema-dts at ^2.0.0 | VERIFIED | `"schema-dts": "^2.0.0"` present in devDependencies |

**Deleted artifact (correct):** `src/app/(marketing)/opengraph-image.tsx` — deleted and moved to root in Plan 13-02 to fix og:image injection. File confirmed absent.

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app/sitemap.ts` | `/sitemap.xml` | Next.js MetadataRoute file convention | WIRED | Build output: `.next/server/app/sitemap.xml.body` present and valid XML |
| `src/app/robots.ts` | `/robots.txt` | Next.js MetadataRoute file convention | WIRED | Build output: `.next/server/app/robots.txt.body` present with correct content |
| `src/app/(marketing)/page.tsx` | JSON-LD in landing page HTML | inline `<script dangerouslySetInnerHTML>` | WIRED | Prerendered `index.html` contains both JSON-LD scripts in rendered body |
| `src/app/opengraph-image.tsx` | `og:image` meta tag on / | Next.js opengraph-image file convention at root | WIRED | Prerendered `index.html` head: `<meta property="og:image" content="https://xmartmenu.skale.club/opengraph-image?55d30fe810fa03f5"/>` with type, width, height, alt |
| `src/app/layout.tsx` | Absolute og:image URL | metadataBase | WIRED | `metadataBase: new URL('https://xmartmenu.skale.club')` present; absolute URL confirmed in prerendered output |

---

## Data-Flow Trace (Level 4)

All phase 13 artifacts produce static/hardcoded outputs — there is no dynamic data source to trace. All values are compile-time constants appropriate for SEO assets.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `sitemap.ts` | `url: BASE_URL` | Hardcoded constant | Yes — single marketing URL as intended | FLOWING |
| `robots.ts` | `disallow` array | Hardcoded constants | Yes — 13 real path disallow rules | FLOWING |
| `page.tsx` JSON-LD | `organization`, `software` | Hardcoded schema objects | Yes — real schema.org values | FLOWING |
| `opengraph-image.tsx` | JSX layout | Hardcoded CSS/text | Yes — flat dark design with brand name | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| sitemap.xml contains only root URL | Read `.next/server/app/sitemap.xml.body` | One `<loc>https://xmartmenu.skale.club</loc>` entry only | PASS |
| robots.txt includes /api/, /admin, /superadmin | Read `.next/server/app/robots.txt.body` | All three present plus 10 additional paths | PASS |
| JSON-LD present in prerendered HTML | Read `.next/server/app/index.html`, search for `ld+json` | Two inline script blocks found with correct @type values | PASS |
| og:image meta tag absolute URL in HTML | Read `.next/server/app/index.html`, search for `og:image` | `content="https://xmartmenu.skale.club/opengraph-image?55d30fe810fa03f5"` present | PASS |
| OG image body under 300 KB | `wc -c .next/server/app/opengraph-image.body` | 33421 bytes (32.6 KB) | PASS |
| No next/script in page.tsx | grep for `next/script` | Not found | PASS |
| No fetch() in opengraph-image.tsx | grep for `fetch(` | Not found | PASS |
| No ld+json in layout files | grep layouts for `application/ld` | Not found in either layout | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEO-01 | 13-01 | `/sitemap.xml` lists only `/` — no tenant slugs | SATISFIED | `sitemap.xml.body` has single `<loc>https://xmartmenu.skale.club</loc>`; `sitemap.ts` has no DB imports |
| SEO-02 | 13-01 | `/robots.txt` allows `/`, disallows `/api/`, `/admin/`, `/superadmin/` | SATISFIED | `robots.txt.body` contains `Disallow: /api/`, `Disallow: /admin`, `Disallow: /superadmin` |
| SEO-03 | 13-01 | JSON-LD `Organization` + `SoftwareApplication` in `page.tsx` only via `dangerouslySetInnerHTML` | SATISFIED | Both scripts confirmed in `page.tsx` and prerendered `index.html`; absent from both layout files |
| SEO-04 | 13-02 | OG image JPEG/PNG ≤ 300 KB at `/opengraph-image`, `metadataBase` set | SATISFIED | 33421 bytes confirmed; `metadataBase` in `layout.tsx`; `og:image` meta tag with absolute URL in prerendered HTML |

**Documentation gap noted:** REQUIREMENTS.md traceability table shows SEO-04 as "Pending" — this is a stale documentation state. All implementation evidence confirms SEO-04 is complete. The row should be updated to "Complete". This does not affect goal achievement but should be corrected.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

All scanned files are clean: no TODO/FIXME markers, no placeholder text, no empty return values, no `next/script` for JSON-LD, no `fetch()` in ImageResponse.

---

## Human Verification Required

### 1. WhatsApp Link Preview

**Test:** Paste `https://xmartmenu.skale.club` into a WhatsApp chat on a real mobile device (not web/simulator).
**Expected:** The link preview shows the XmartMenu branded image (dark background `#18181b`, white "XmartMenu" heading, grey subtitle, white CTA button).
**Why human:** WhatsApp's preview crawler cannot be triggered programmatically; requires real device with a deployed URL.

### 2. Google Rich Results Test — JSON-LD Validation

**Test:** Open https://search.google.com/test/rich-results and enter `https://xmartmenu.skale.club`.
**Expected:** Both `Organization` and `SoftwareApplication` entities detected with no errors or warnings.
**Why human:** Requires Google's live crawler against a deployed production URL.

### 3. JSON-LD Isolation from Tenant Pages

**Test:** With a local production build running (`npm run build && npm run start`), run: `curl -s http://localhost:3000/{any-tenant-slug} | grep "ld+json"`.
**Expected:** No output — JSON-LD must not appear on tenant menu pages.
**Why human:** Requires a tenant slug to exist in the Supabase database; cannot create a test tenant without a live DB connection. The code isolation is verified (JSON-LD is only in `page.tsx` not in any layout), but runtime behavior on a real tenant page should be confirmed once a tenant exists.

### 4. REQUIREMENTS.md Documentation Update

**Test:** Edit `.planning/REQUIREMENTS.md` line 60: change `| SEO-04 | Phase 13 — SEO & Metadata | Pending |` to `| SEO-04 | Phase 13 — SEO & Metadata | Complete |`.
**Expected:** All four SEO requirements show "Complete" in the traceability table.
**Why human:** Documentation correction — a human should confirm before updating.

---

## Gaps Summary

No implementation gaps. All four SEO assets exist, are substantive, and are wired into the build output. The prerendered HTML from the current build confirms correct og:image meta tags, JSON-LD content, and all expected metadata.

The only outstanding items are:
1. A documentation inconsistency (SEO-04 marked "Pending" in REQUIREMENTS.md — should be "Complete")
2. Three human-gated verification items that require a deployed URL and real devices (WhatsApp preview, Google Rich Results, tenant page isolation)

All of these are post-implementation verification gates, not implementation gaps.

---

_Verified: 2026-05-07T23:50:00Z_
_Verifier: Claude (gsd-verifier)_
