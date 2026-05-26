# Phase 44: Zero Hardcoded Values — Research

**Researched:** 2026-05-19
**Domain:** Next.js App Router layout/metadata, Supabase DB schema, CMS data binding
**Confidence:** HIGH (all findings verified by reading actual source files)

## Summary

Phase 44 eliminates hardcoded strings and values from the platform by connecting every user-facing
text and configurable value to its source-of-truth table: `platform_settings` for
platform-level concerns (landing page, marketing layout, superadmin UI) and `tenant_settings`
for restaurant-level concerns (admin panel, public menu footer).

**Critical pre-existing blocker discovered:** The `cta_color` column is referenced in three
source files (`(marketing)/layout.tsx`, `(superadmin)/layout.tsx`, `SettingsClient.tsx`) and in
the API route allowlist, but there is NO migration that adds this column to `platform_settings`.
The column exists only if it was added manually outside of migrations. Phase 44 must include a
migration that adds `cta_color` to `platform_settings` with an IF NOT EXISTS guard before any
other work proceeds.

**Primary recommendation:** Write one migration (045) adding `cta_color` to `platform_settings`
and `seo_title`/`seo_description` for metadata; then wire each hardcoded surface to its DB column
in a single-pass audit across four files.

## Standard Stack

No new libraries required. All work uses the existing stack.

| Tool | Version | Purpose |
|------|---------|---------|
| Next.js `generateMetadata` | already installed | Dynamic `<Metadata>` from DB |
| Supabase `createServiceClient` | already installed | Server-side DB reads |
| Tailwind CSS variables | already installed | `--primary`, `--accent` CSS vars |

**No new npm packages needed.**

## Architecture Patterns

### Existing Pattern: Server-Side CSS Variable Injection

Already established in Phases 37 and 37-02. Every layout that needs dynamic colors reads from DB
and injects a `<style>` block before children:

```tsx
// Source: src/app/(admin)/layout.tsx (verified)
const primary = (tenantSettings as any)?.primary_color ?? '#EEFF00'
const primaryFg = computePrimaryForeground(primary)
return (
  <>
    <style>{`:root{--primary:${primary};--primary-foreground:${primaryFg};--accent:${accent};}`}</style>
    {children}
  </>
)
```

### Existing Pattern: Dynamic Metadata via `generateMetadata`

Already established in the public menu routes. Marketing layout uses a static `export const
metadata` — replacing it with `generateMetadata` (async function) enables DB-driven title,
description, and OG tags:

```tsx
// Pattern to adopt in (marketing)/layout.tsx
export async function generateMetadata(): Promise<Metadata> {
  const service = await createServiceClient()
  const { data: ps } = await service.from('platform_settings').select('*').single()
  return {
    title: ps?.seo_title ?? 'XmartMenu | Digital menus built for service',
    description: ps?.seo_description ?? 'Create a beautiful digital menu...',
    openGraph: {
      title: ps?.seo_title ?? 'XmartMenu | Digital menus built for service',
      siteName: ps?.app_name ?? 'XmartMenu',
      // ...
    }
  }
}
```

**Constraint:** `(marketing)/layout.tsx` currently has `export const metadata` (static). Changing
to `generateMetadata` adds a DB call but this layout is not forced-dynamic — it will use the
60-second ISR revalidation already set on `page.tsx`. The layout itself needs `export const
revalidate = 60` added when switching to async metadata.

### Existing Pattern: DB-Driven Landing Page Sections

`platform_settings.landing` JSONB already contains CMS-ready data for all landing page sections
(`hero`, `how_it_works`, `features`, `pricing`, `cta`, `footer`) and `SettingsClient.tsx`
already has full UI to edit them. The sections are fully disconnected at render time:

- `page.tsx` reads `select('landing')` and passes only `platformLanding?.hero` to `ClientPage`
- `HowItWorks`, `FeatureBlocks`, `FAQ`, `FooterCTABand`, `Footer` use hardcoded module-level
  arrays (`steps`, `features`, `faqs`) — they never receive the DB data

The fix is: pass `platformLanding` fully into `ClientLandingPage`, then have each section
component accept the relevant sub-object as a prop with hardcoded fallbacks.

### Anti-Patterns to Avoid

- **Changing `SettingsClient.tsx` to add new fields:** The client is already fully wired to all
  existing `platform_settings` columns. New columns need a migration, not a SettingsClient change.
- **Removing hardcoded fallbacks:** Every DB-driven value must retain a hardcoded fallback for
  zero-downtime deploys and fresh DB rows.
- **Putting metadata in `page.tsx`:** Marketing layout-level metadata belongs in `layout.tsx`
  (affects all marketing routes including `/privacy`, `/terms`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Dynamic metadata | Custom `<meta>` tags in RSC | Next.js `generateMetadata` — handles OG, twitter, title automatically |
| CSS variable injection | Theme provider / context | `<style>` block in layout RSC — already the pattern, zero JS overhead |

## Hardcoded Value Audit (Complete)

### A. PLATFORM-LEVEL — Source: `platform_settings`

#### A1. `(marketing)/layout.tsx` — METADATA (hardcoded, NOT from DB)

| Hardcoded Value | Location | Target Column | Column Exists? |
|----------------|----------|---------------|----------------|
| `'XmartMenu | Digital menus built for service'` | `metadata.title` | `seo_title` (or derive from `app_name` + tagline) | NO — needs migration |
| `'Create a beautiful digital menu...'` | `metadata.description` | `seo_description` | NO — needs migration |
| `'XmartMenu'` | `openGraph.siteName` | `app_name` | YES (004) |
| `'XmartMenu | Digital menus built for service'` | `openGraph.title` | `seo_title` | NO — needs migration |
| `'XmartMenu | Digital menus built for service'` | `twitter.title` | `seo_title` | NO — needs migration |
| `'en_US'` | `openGraph.locale` | acceptable hardcoded (platform is English-only) | N/A |

**Simplest approach:** Add two columns `seo_title TEXT` and `seo_description TEXT` to
`platform_settings` (optional, nullable — fallback to `app_name` + hardcoded tagline when NULL).
Alternatively, derive `seo_title` from `app_name` at runtime without adding columns; this avoids
a migration for a low-value field. Recommend adding the columns for full CMS control.

#### A2. `(marketing)/ClientPage.tsx` — LANDING SECTIONS (hardcoded, NOT from DB)

The `platform_settings.landing` JSONB already has CMS content for:

| Section | DB key | ClientPage status |
|---------|--------|-------------------|
| Hero | `landing.hero` | CONNECTED (via `heroSettings` prop) |
| How It Works | `landing.how_it_works` | DISCONNECTED — uses hardcoded `steps` array |
| Feature Blocks | `landing.features` | DISCONNECTED — uses hardcoded `features` array |
| FAQ | — | DISCONNECTED — no DB equivalent, hardcoded `faqs` array |
| Footer CTA Band | `landing.cta` | DISCONNECTED — hardcoded strings |
| Footer | `landing.footer` | DISCONNECTED — `copyright` is in DB but not rendered |
| Nav `"XmartMenu"` brand | — | DISCONNECTED — should use `app_name` |
| Footer `"XmartMenu"` brand | — | DISCONNECTED — should use `app_name` or `brand_name` |

**Decision needed by planner:** FAQ section has no DB equivalent in `landing` JSONB schema.
Options: (a) leave hardcoded since FAQ rarely changes, (b) add `faq` array to the JSONB schema
and add editing to SettingsClient. Recommended: hardcode FAQ for now — adding CMS edit for FAQ
in SettingsClient is a separate scope item.

#### A3. `(superadmin)/layout.tsx` — SIDEBAR BRAND TEXT (hardcoded)

| Hardcoded Value | Location | Target Column | Column Exists? |
|----------------|----------|---------------|----------------|
| `"XmartMenu"` | `<a>` brand link in sidebar | `app_name` | YES (004) |
| `"Super Admin Console"` | `<p>` subtitle in sidebar | acceptable — superadmin internal label | N/A |

**Current state:** `(superadmin)/layout.tsx` already fetches `cta_color` from `platform_settings`
in the same Promise.all. Adding `app_name` to that select is a 1-line change.

#### A4. `cta_color` COLUMN MISSING FROM DB SCHEMA

This is the most critical finding. `cta_color` is:
- Selected in `(marketing)/layout.tsx`: `select('cta_color')`
- Selected in `(superadmin)/layout.tsx`: `select('cta_color')`
- Used in `SettingsClient.tsx` state and UI
- Included in the API route PATCH allowlist

But there is ZERO migration adding `cta_color TEXT` to `platform_settings`. The column
was never added via SQL. Any row returned by `select('cta_color')` will either error or return
`undefined` (Supabase returns null for unknown columns without error in most SDKs). This means
the current fallback `?? '#EEFF00'` always fires, but edits via SettingsClient PATCH fail
silently because the DB column does not accept the field.

**Migration required:** `ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS cta_color TEXT NOT NULL DEFAULT '#EEFF00';`

### B. TENANT-LEVEL — Source: `tenant_settings`

#### B1. Public Menu `footerBrand` — NOT passed from public pages

| Issue | File | Current State | Fix |
|-------|------|---------------|-----|
| `footerBrand` prop defaults to `'XmartMenu'` | `MenuPage.tsx` line 70 | Default never overridden | Public page.tsx must fetch `menu_footer_brand` from `platform_settings` and pass as `footerBrand` |

Both public menu routes (`[slug]/page.tsx` and `[slug]/[menuSlug]/page.tsx`) instantiate
`<MenuPage>` without passing `footerBrand`. The `platform_settings.menu_footer_brand` column
exists and is CMS-editable, but the wire is broken.

#### B2. `AdminSidebar.tsx` — No additional hardcoded strings found

`AdminSidebar` already receives `appName` from `platform_settings` via `(admin)/layout.tsx`
and renders it at line 120. Navigation labels (`'Dashboard'`, `'Menus'`, `'Orders'`, etc.) are
intentionally static English strings — not values a tenant configures. No action needed.

#### B3. `globals.css` fallback colors

```css
/* src/app/globals.css — current */
:root {
  --primary: #EEFF00;
  --primary-foreground: #09090b;
  --accent: #09090b;
}
```

These are CSS fallbacks used before layout-injected `:root{}` styles resolve. They should match
`platform_settings.cta_color` (for `--primary`) and `platform_settings.default_accent_color`
(for `--accent`). Since these are inline `<style>` overrides in every layout, the CSS file
fallbacks only matter for very brief FOUC windows or for routes with no layout override.

**Recommendation:** Update `globals.css` defaults to match the DB defaults
(`--primary: #EEFF00` already matches; `--accent: #09090b` already matches). No migration
needed — just cosmetic alignment.

## Common Pitfalls

### Pitfall 1: Marketing layout uses static `export const metadata`
**What goes wrong:** Switching to `generateMetadata()` (async) requires the layout to become
dynamic or to set `revalidate`. If forgotten, the metadata never updates from DB.
**How to avoid:** Add `export const revalidate = 60` alongside `generateMetadata` in
`(marketing)/layout.tsx`.

### Pitfall 2: `cta_color` column absent from DB
**What goes wrong:** Saving via SettingsClient silently discards `cta_color` edits because the
column doesn't exist. No error in the API since the PATCH just ignores unknown columns in the
PostgreSQL upsert.
**How to avoid:** Migration 045 must add `cta_color` with IF NOT EXISTS guard BEFORE any other
work in this phase.

### Pitfall 3: Landing sections wired to DB but FAQ left hardcoded
**What goes wrong:** Partial wiring creates inconsistency — some sections from DB, some hardcoded.
**How to avoid:** Make the FAQ explicitly hardcoded by design, documented in a code comment, not
left accidentally hardcoded.

### Pitfall 4: `platformLanding` fetched via `select('landing')` only
**What goes wrong:** `page.tsx` passes `platformLanding` to `ClientLandingPage`, but
`HowItWorks`/`FeatureBlocks`/etc. receive no props. Even after adding the props, the DB shape
(`how_it_works.steps[].step`, `.icon`, `.title`, `.desc`) must match what `ClientPage.tsx` renders.
**How to avoid:** Map DB keys explicitly and use the existing hardcoded arrays as fallbacks.
Verify key names against `004_platform_settings.sql` JSONB defaults.

### Pitfall 5: `(marketing)/layout.tsx` concurrent DB call and metadata
**What goes wrong:** If `generateMetadata` and the layout's `async` body both call
`platform_settings`, two DB round-trips fire per request.
**How to avoid:** Move to `select('*')` or a combined select so a single read covers both the
metadata generation and the CSS var injection.

## Code Examples

### Migration 045 — add `cta_color` to `platform_settings`

```sql
-- Migration 045: add cta_color to platform_settings
-- Phase 44: Zero Hardcoded Values
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS cta_color     TEXT NOT NULL DEFAULT '#EEFF00',
  ADD COLUMN IF NOT EXISTS seo_title     TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT;
```

### Wire `footerBrand` in public menu page

```tsx
// In src/app/(public)/[slug]/page.tsx — add to the existing platform_settings query
const supabaseService = createServiceClient()
const { data: ps } = await supabaseService.from('platform_settings').select('menu_footer_brand').single()
const footerBrand = ps?.menu_footer_brand ?? 'XmartMenu'

// Then pass it:
<MenuPage footerBrand={footerBrand} ... />
```

### Dynamic metadata in `(marketing)/layout.tsx`

```tsx
// Replace static `export const metadata` with:
export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const service = createServiceClient()  // sync createServiceClient — no await needed
  const { data: ps } = await service.from('platform_settings')
    .select('app_name, seo_title, seo_description, cta_color')
    .single()

  const title = ps?.seo_title ?? `${ps?.app_name ?? 'XmartMenu'} | Digital menus built for service`
  const description = ps?.seo_description ?? 'Create a beautiful digital menu, generate a QR code, and start taking orders.'

  return {
    title,
    description,
    openGraph: { title, description, siteName: ps?.app_name ?? 'XmartMenu', ... },
    twitter: { title, description, ... },
  }
}
```

### Wire landing sections in `ClientPage.tsx`

```tsx
// page.tsx — expand query
const { data } = await service.from('platform_settings').select('landing').single()
const platformLanding = data?.landing ?? null
// Pass fully to ClientLandingPage — no change needed here

// ClientPage.tsx — read all sections from props
export default function ClientLandingPage({ platformLanding }: { platformLanding?: any }) {
  const l = platformLanding ?? {}
  const heroSettings = l.hero ?? {}
  const howItWorksData = l.how_it_works ?? null  // null triggers hardcoded fallback
  // Pass howItWorksData to <HowItWorks data={howItWorksData} /> etc.
}
```

### Wire `app_name` in `(superadmin)/layout.tsx`

```tsx
// Change existing select from:
.select('cta_color')
// to:
.select('cta_color, app_name')

// Then render:
<a href="/">{ps?.app_name ?? 'XmartMenu'}</a>
// instead of hardcoded:
<a href="/">XmartMenu</a>
```

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Static `export const metadata` | `generateMetadata()` async function | Required for DB-driven title/OG tags |
| Hardcoded section arrays in ClientPage | Props from `platformLanding` JSONB | DB-editable via SettingsClient already |

## Open Questions

1. **FAQ section CMS?**
   - What we know: `platform_settings.landing` JSONB has no `faq` key; SettingsClient has no FAQ editor
   - What's unclear: Whether the planner wants to keep FAQ hardcoded or add CMS support
   - Recommendation: Keep FAQ hardcoded with an explicit comment — scope is already large enough

2. **Marketing layout `createServiceClient` is synchronous vs async**
   - What we know: In `(marketing)/layout.tsx`, `createServiceClient()` is called with `await` (it's async in this codebase)
   - What's unclear: Whether adding a second `select()` in `generateMetadata` should reuse the same instance
   - Recommendation: Use a single `async function` for both metadata and CSS injection; read all needed columns in one query

## Environment Availability

Step 2.6: SKIPPED (no external tool dependencies — all changes are code/SQL edits to existing infrastructure)

## Validation Architecture

All changes in this phase are display/wiring changes — no new business logic. Validation is
manual visual inspection:

- Marketing landing page renders DB content (not hardcoded) for HowItWorks, FeatureBlocks, CTA
- Public menu footer shows `platform_settings.menu_footer_brand` value
- Superadmin sidebar shows `platform_settings.app_name`
- Marketing `<title>` and OG tags match `platform_settings.seo_title`
- SettingsClient saves `cta_color` successfully (no silent discard)

## Sources

### Primary (HIGH confidence)

- `src/app/(marketing)/ClientPage.tsx` — confirmed: HowItWorks/FeatureBlocks/FAQ/FooterCTABand/Footer receive no props; Hero reads `platformLanding?.hero` only
- `src/app/(marketing)/page.tsx` — confirmed: passes only `platformLanding` to ClientLandingPage (= `landing` JSONB from DB)
- `src/app/(marketing)/layout.tsx` — confirmed: `export const metadata` is fully hardcoded; DB only used for `cta_color`
- `src/app/(superadmin)/layout.tsx` — confirmed: hardcoded "XmartMenu" and "Super Admin Console" strings; `cta_color` already fetched
- `src/components/admin/AdminSidebar.tsx` — confirmed: `appName` prop received and rendered; no other hardcoded brand strings
- `supabase/migrations/004_platform_settings.sql` — confirmed: `platform_settings` schema lacks `cta_color`
- All migrations grepped for `cta_color` — confirmed: zero matches across all 44 migration files
- `src/app/(public)/[slug]/page.tsx` — confirmed: `footerBrand` never passed to MenuPage
- `src/app/globals.css` — confirmed: `--primary: #EEFF00` and `--accent: #09090b` fallbacks

## Metadata

**Confidence breakdown:**
- Hardcoded value audit: HIGH — all findings from direct source file reads
- Missing migration: HIGH — grepped all 44 migrations, zero `cta_color` matches
- Fix patterns: HIGH — same patterns already used in Phases 37, 42, 13

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (stable codebase, no external dependencies)
