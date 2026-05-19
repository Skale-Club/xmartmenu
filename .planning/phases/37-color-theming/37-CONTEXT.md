# Phase 37: Color Theming - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect the existing `primary_color` and `accent_color` fields in `tenant_settings` to the public menu page via server-side CSS variable injection. Tenant's chosen colors replace the hardcoded globals.css default on their public menu. Admin branding settings get palette presets for easy color selection. Smart default palettes are applied at tenant creation based on cuisine type.

**Already exists (no new DB migration needed):**
- `tenant_settings.primary_color TEXT` — already in DB and types
- `tenant_settings.accent_color TEXT` — already in DB and types
- BrandingClient.tsx already has `<input type="color">` for both fields
- MenuPage.tsx already uses `bg-primary`, `text-primary` via `--color-primary` → `--primary`
- globals.css defines `--primary: #EEFF00` as platform-wide fallback

**What needs to be built:**
1. Server-side inline `<style>` injection in public menu page.tsx
2. MenuPage.tsx color audit — replace hardcoded hex values with `bg-primary`/`text-primary`
3. Cuisine-type palette presets in BrandingClient (clickable chips)
4. Smart default palette applied at tenant creation in onboarding API

</domain>

<decisions>
## Implementation Decisions

### CSS Variable Mapping
- `primary_color` → `--primary` (already wired to `--color-primary` in Tailwind @theme inline)
- `accent_color` → new `--accent` CSS var for prices and highlights
- globals.css `--primary: #EEFF00` stays as platform-wide fallback; per-tenant values override it via inline `<style>` in the page `<head>`
- Injection location: inline `<style>` inside the public menu page.tsx `<head>` (server-rendered, zero FOUC)

### Default Palettes
- Smart defaults applied at tenant creation in onboarding API — based on business_type selected during onboarding
- 6 cuisine presets:
  - `pizza`: primary `#E74C3C`, accent `#FFFFFF`
  - `japanese`: primary `#C0392B`, accent `#1A1A1A`
  - `burger`: primary `#F39C12`, accent `#2C3E50`
  - `cafe`: primary `#6F4E37`, accent `#FDF5E6`
  - `churrascaria`: primary `#27AE60`, accent `#F39C12`
  - `generic` (default): primary `#EEFF00`, accent `#09090b`
- Treat `#000000` in `primary_color` as "not configured yet" — apply smart default based on tenant's `cuisine_type` or business type
- Show palette preset chips in BrandingClient for easy one-click switching

### MenuPage Color Audit
- Audit MenuPage.tsx, CartModal.tsx, ProductModal.tsx for hardcoded hex colors that should be dynamic
- Replace hardcoded values with `bg-primary`, `text-primary`, `border-primary` Tailwind classes
- Category pills active state: convert to `bg-primary` if hardcoded
- Cart badge/count indicator: convert to `bg-primary` if hardcoded
- Add-to-cart CTAs and modal confirm buttons: already using `bg-primary` (confirmed in earlier grep)

### Plan Structure
- Plan 01: CSS injection in page.tsx + `--accent` var in globals.css + BrandingClient preset chips
- Plan 02: MenuPage/CartModal/ProductModal color audit + smart defaults at tenant creation in onboarding API

### Claude's Discretion
- Exact contrast ratio handling if chosen colors are too light/dark for text readability
- Whether to add a `--primary-foreground` override alongside `--primary` injection (likely needed for text-on-primary buttons)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/globals.css` — defines `--primary` and `@theme inline` with `--color-primary: var(--primary)`. The injection just overrides `--primary` inline.
- `src/app/(admin)/settings/branding/BrandingClient.tsx` — already has `<input type="color">` for `primary_color` and `accent_color`. Add preset chip UI here.
- `src/app/(public)/[slug]/page.tsx` — public menu entry point. Add `<style>` injection here server-side.
- `src/lib/get-effective-tenant.ts` — fetches tenant data server-side including `tenant_settings`. Colors are already available here.

### Established Patterns
- Server components in Next.js App Router can render inline `<style>` tags directly in JSX
- globals.css uses Tailwind 4's `@theme inline` to bridge CSS vars → Tailwind utilities
- BrandingClient uses `settings?.primary_color ?? '#000000'` pattern for defaults

### Integration Points
- Onboarding API (`src/app/api/auth/register/route.ts` or similar) — where to set default `primary_color` / `accent_color` based on business_type
- Public page.tsx server component — inject `<style>` tag using tenant's actual colors from DB fetch

</code_context>

<specifics>
## Specific Ideas

- The inline `<style>` tag approach: `<style>{`:root { --primary: ${primary_color}; --accent: ${accent_color}; }`}</style>` in the `<head>` JSX of the public page
- Also inject `--primary-foreground` calculated from primary_color luminance (dark color → white foreground; light color → zinc-950 foreground) — handles text-on-primary button legibility
- Preset chips in BrandingClient can use the same 6-preset object, showing small colored circles that onClick set both primary and accent fields

</specifics>

<deferred>
## Deferred Ideas

- WCAG contrast warning in BrandingClient — soft warning if color fails AA contrast (noted in SEED-015 notes, defer to future)
- Per-branch color overrides (noted in SEED-015 notes, explicitly deferred to v3+)

</deferred>
