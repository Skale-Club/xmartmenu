---
id: SEED-015
status: completed
completed: 2026-05-19
planted: 2026-05-19
completed_in: v2.2 (Restaurant Growth Platform — phase 37)
planted_during: v2.2-milestone-setup
trigger_when: working on public menu UX or tenant branding customization
scope: small
---

# SEED-015: Dynamic Color Theming for Public Menus

## Why This Matters

Today the public menu page has a fixed visual style — the color palette is hardcoded and the same for every restaurant. A sushi bar, a steakhouse, and a juice bar all look identical in terms of color. This is a missed opportunity: color is one of the strongest brand signals.

The proposal: each tenant has a `primary_color` and `secondary_color` stored in the database (already partially modeled in `tenant_settings` or `tenants`). The public menu page reads these values server-side and injects them as CSS custom properties (`--color-primary`, `--color-secondary`) into the page. Every interactive element — buttons, category pills, cart badge, add-to-cart CTA, modal headers — inherits these values automatically.

The admin picks their palette (or gets a smart default based on cuisine type). The public menu immediately reflects the brand.

**Examples:**
- Japanese restaurant → dark background, red accent (`#C0392B` / `#1A1A1A`)
- Brazilian churrascaria → deep green + gold (`#27AE60` / `#F39C12`)
- Café → warm brown + cream (`#6F4E37` / `#FDF5E6`)
- Pizzeria → red + white (`#E74C3C` / `#FFFFFF`)

## When to Surface

**Trigger:** when working on public menu UX, tenant branding, or the full website platform (SEED-012)

Surface during `/gsd:new-milestone` when the scope involves:
- Tenant branding and visual identity
- Public menu redesign
- White-label features (SEED-012 full website)
- Multi-tenant theme system

## Scope Estimate

**Small** — 1–2 days. Components:

1. **DB migration**
   - `tenants` or `tenant_settings`: add `primary_color TEXT DEFAULT '#000000'` and `secondary_color TEXT DEFAULT '#FFFFFF'`
   - Seed defaults per cuisine type (optional: smart defaults in migration)

2. **Server-side CSS injection**
   - Public menu page (`src/app/(public)/[slug]/page.tsx` or layout) reads colors from tenant data
   - Injects `<style>:root { --color-primary: {primary}; --color-secondary: {secondary}; }</style>` into `<head>`
   - Next.js `generateMetadata` or a dedicated `<ColorTheme>` Server Component handles injection
   - Zero JS on the client — pure CSS cascade

3. **CSS refactor on public menu**
   - Replace all hardcoded color values (buttons, badges, CTAs, active states) with `var(--color-primary)` and `var(--color-secondary)`
   - Ensure sufficient contrast ratio (WCAG AA) — add a contrast-check helper if needed

4. **Admin color picker UI**
   - Section "Cores do Menu" in tenant branding settings
   - Two `<input type="color">` fields: Primary and Secondary
   - Live preview panel showing button + badge samples with chosen colors
   - Save persists to DB

5. **Smart defaults by cuisine type**
   - When a new tenant is created, assign a default palette based on `cuisine_type` (or business type from onboarding)
   - Mapping table: `pizza → red/white`, `japanese → black/red`, `burger → yellow/black`, etc.

## Breadcrumbs

- `src/app/(public)/[slug]/page.tsx` — public menu entry point; colors injected here server-side
- `src/app/(public)/[slug]/MenuPage.tsx` — all hardcoded colors to migrate to CSS vars
- `src/app/(admin)/settings/store/` — branding settings where color picker goes
- `src/types/database.ts` — `Tenant` or `TenantSettings` receives `primary_color`, `secondary_color`
- `supabase/migrations/` — new migration adding color fields
- `src/lib/get-effective-tenant.ts` — tenant data fetched server-side includes color fields

## Notes

- **Server-side injection is critical for performance** — do not fetch colors client-side. The colors must be present in the initial HTML to avoid a flash of unstyled content (FOUC).
- **CSS custom properties cascade naturally** — a single `:root { --color-primary: X }` block covers every component that uses the var, so no per-component changes are needed beyond replacing hardcoded values.
- **WCAG contrast** — the admin UI should warn (not block) if the chosen color combination fails AA contrast for body text. Most restaurants will pick readable combinations, but a soft warning is good UX.
- **SEED-012 (full website)** shares this system — homepage hero, nav, buttons all use the same `--color-primary` / `--color-secondary` props. Implement here, extend there.
- **SEED-011 (multi-location)** could support per-branch color overrides in v2+ — model the fields on `tenants` (not `locations`) for now to keep v1 simple.
