---
phase: 13-seo-metadata
plan: "01"
subsystem: seo
tags: [sitemap, robots, json-ld, schema-dts, seo, structured-data]
dependency_graph:
  requires: [12-core-landing-page]
  provides: [sitemap-xml, robots-txt, json-ld-organization, json-ld-software-application]
  affects: [src/app/sitemap.ts, src/app/robots.ts, src/app/(marketing)/page.tsx]
tech_stack:
  added: [schema-dts@2.0.0]
  patterns: [Next.js MetadataRoute file convention, inline dangerouslySetInnerHTML for JSON-LD]
key_files:
  created:
    - src/app/sitemap.ts
    - src/app/robots.ts
  modified:
    - src/app/(marketing)/page.tsx
    - package.json
decisions:
  - "sitemap.ts lists only / — no DB queries to avoid exposing tenant roster as public XML"
  - "robots.ts disallows actual admin route paths (/dashboard, /menu, /menus, /orders, /tenants, /overview, /users, /onboarding, /auth) plus /api/ — route groups (admin)/(superadmin) add no URL segment"
  - "JSON-LD injected via inline <script dangerouslySetInnerHTML> in page.tsx only (not layout.tsx) to avoid leaking to tenant menu pages"
  - "schema-dts installed as devDependency — zero runtime footprint, types stripped at build"
metrics:
  duration: "204s (~3.4 min)"
  completed_date: "2026-05-07"
  tasks_completed: 2
  files_changed: 4
---

# Phase 13 Plan 01: Sitemap, Robots, and JSON-LD Structured Data Summary

**One-liner:** Next.js MetadataRoute sitemap.ts + robots.ts with disallow rules, plus Organization and SoftwareApplication JSON-LD in landing page via schema-dts types and dangerouslySetInnerHTML.

## What Was Built

### Task 1 — schema-dts, sitemap.ts, robots.ts (commit: f2d4215)

**schema-dts@2.0.0** installed as devDependency. Provides TypeScript types for schema.org JSON-LD — zero runtime footprint.

**src/app/sitemap.ts** — MetadataRoute.Sitemap with single `/` entry:
- `url: 'https://xmartmenu.skale.club'`
- `changeFrequency: 'monthly'`, `priority: 1`
- No Supabase or DB calls — pure static route, cached at build
- Rendered as `/sitemap.xml` (static) in build output

**src/app/robots.ts** — MetadataRoute.Robots:
- `allow: '/'`
- Disallows: `/api/`, `/admin`, `/superadmin`, `/dashboard`, `/settings`, `/menu`, `/menus`, `/orders`, `/tenants`, `/overview`, `/users`, `/onboarding`, `/auth`
- Note: `(admin)` and `(superadmin)` are route groups (parentheses) — they add NO URL segment. The actual served paths are `/dashboard`, `/menu`, etc. The plan's disallow list for `/admin` and `/superadmin` is added for spec compliance (harmless if no routes exist at those paths).
- `sitemap: 'https://xmartmenu.skale.club/sitemap.xml'`
- Rendered as `/robots.txt` (static) in build output

### Task 2 — JSON-LD in landing page (commit: a5c7010)

**src/app/(marketing)/page.tsx** updated:

Imports added:
```typescript
import type { WithContext, Organization, SoftwareApplication } from 'schema-dts'
```

JSON-LD schemas defined in `LandingPage()` body:
- **Organization:** `@type: Organization`, `name: XmartMenu`, `url: https://xmartmenu.skale.club`, `description: Digital menu platform for restaurants via QR code`, `sameAs: []`
- **SoftwareApplication:** `@type: SoftwareApplication`, `applicationCategory: BusinessApplication`, `operatingSystem: Web`, `offers: { @type: Offer, price: 0, priceCurrency: BRL, description: Grátis durante o beta }`

Both rendered as `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />` — XSS escape applied per Next.js JSON-LD guide.

Scripts placed at top of `LandingPage()` return fragment, before `<Nav />`. This ensures they appear only on `/` — NOT in `layout.tsx`, NOT in marketing layout, NOT on any tenant page.

## Verification Results

- `npx tsc --noEmit` — exits 0 (no TypeScript errors)
- Automated JSON-LD check — `JSON-LD OK`
- `npm run build` — succeeds, 28/28 static pages generated
- `/sitemap.xml` — appears as static route in build output (`.next/server/app/sitemap.xml`)
- `/robots.txt` — appears as static route in build output (`.next/server/app/robots.txt`)
- `(marketing)/layout.tsx` — no `application/ld+json` (verified)
- `src/app/layout.tsx` — no `application/ld+json` (verified)

## Deviations from Plan

**1. [Rule 1 - Bug] Comment text triggered automated check for `next/script`**
- **Found during:** Task 2 automated verification
- **Issue:** The comment `NEVER use next/script for JSON-LD` contained the literal string `next/script` which the plan's `node -e` verification script detected as a forbidden import
- **Fix:** Rewrote comment to `Do NOT use the Script component for JSON-LD` — preserves intent without triggering false positive
- **Files modified:** `src/app/(marketing)/page.tsx`

Otherwise plan executed exactly as written.

## Known Stubs

None. Both sitemap.ts and robots.ts output real data. JSON-LD values are hardcoded constants (no placeholder text).

## Self-Check: PASSED
