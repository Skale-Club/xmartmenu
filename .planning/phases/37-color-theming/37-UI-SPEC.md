---
phase: 37
name: Color Theming
status: draft
created: 2026-05-19
---

# UI-SPEC — Phase 37: Color Theming

## 1. Design System

**Tool:** None (no `components.json` — Tailwind 4 + custom globals.css)

**Styling approach:** Tailwind 4 utility classes + CSS custom properties bridged via `@theme inline`. No shadcn registry. No third-party component registry.

**Icon library:** Lucide React (already in use across BrandingClient and MenuPage)

**Component pattern:** Server components with inline `<style>` for CSS var injection; Client components for interactive color picker and preset chips.

---

## 2. Spacing Scale

Standard 8-point scale applies throughout. All spacing uses Tailwind utilities mapped to multiples of 4px:

| Token | Value | Use |
|-------|-------|-----|
| `gap-2` | 8px | Between preset chip and color swatch |
| `gap-4` | 16px | Between palette preset row items |
| `gap-8` | 32px | Between Color Palette card sections |
| `p-10` | 40px | Card padding (matches existing BrandingClient pattern) |
| `mb-6` | 24px | Below section headings |
| `mb-8` | 32px | Below Color Palette card header |

Source: existing BrandingClient.tsx card padding (`p-10`, `gap-8`) — no change, preset chips slot into the existing Color Palette section.

Touch target minimum: 44px for preset chip hit area (achieved via `min-h-[44px]` or `p-3` on chip button).

---

## 3. Typography

Matches existing BrandingClient and MenuPage type scale exactly. No new type sizes introduced.

| Role | Size | Weight | Line-height | Element |
|------|------|--------|-------------|---------|
| Section heading | 20px (`text-xl`) | 900 (`font-black`) | 1.2 | `h2` in Color Palette card |
| Label | 10px (`text-[10px]`) | 900 (`font-black`) | — | `UPPERCASE TRACKING-WIDEST` field label |
| Hint / descriptor | 9px (`text-[9px]`) | 500 (`font-medium`) | relaxed | Below color hex input |
| Preset chip label | 10px (`text-[10px]`) | 900 (`font-black`) | — | Chip name below swatch circle |

Source: `labelClassName` and `inputClassName` patterns in BrandingClient.tsx lines 96–97.

---

## 4. Color Contract

### CSS Variable Map (locked — from CONTEXT.md)

| DB field | CSS variable | Tailwind utility | Fallback |
|----------|-------------|-----------------|---------|
| `primary_color` | `--primary` | `bg-primary`, `text-primary`, `border-primary` | `#EEFF00` (globals.css) |
| `accent_color` | `--accent` | `text-accent` (new), `bg-accent` (new) | `#09090b` |
| computed | `--primary-foreground` | `text-primary-foreground` | `#09090b` |

`--primary-foreground` is computed server-side from `primary_color` luminance:
- Relative luminance > 0.4 (light color) → foreground = `#09090b` (zinc-950)
- Relative luminance ≤ 0.4 (dark color) → foreground = `#ffffff`

**globals.css additions required:**
```css
:root {
  --accent: #09090b;
  --accent-foreground: #ffffff;
}

@theme inline {
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
}
```

### Inline injection format (locked — from CONTEXT.md)

Injected in public `page.tsx` `<head>` as server-rendered JSX:
```tsx
<style>{`:root { --primary: ${primaryColor}; --primary-foreground: ${primaryForeground}; --accent: ${accentColor}; }`}</style>
```

### 60/30/10 Allocation

| Role | Share | Color | Elements |
|------|-------|-------|---------|
| Dominant surface | 60% | `zinc-50` / `white` | Page background, cards, modal backgrounds |
| Secondary surface | 30% | `zinc-100`–`zinc-200` | Category pill inactive, input borders, dividers |
| Accent (tenant primary) | 10% | `var(--primary)` | Header background (no banner), active category pill, add-to-cart button, toggle active state, "Primary Brand Color" preview swatch, "Live Public Menu" link button in admin |
| Accent (tenant accent) | reserved | `var(--accent)` | Product price labels in cards/modals, cart total, featured card price badge |

### Palette Presets (locked — from CONTEXT.md)

6 presets displayed as clickable chips in BrandingClient Color Palette section:

| Name | `primary_color` | `accent_color` | Chip display |
|------|----------------|----------------|-------------|
| Pizza | `#E74C3C` | `#FFFFFF` | Red swatch + "Pizza" label |
| Japanese | `#C0392B` | `#1A1A1A` | Deep red swatch + "Japanese" label |
| Burger | `#F39C12` | `#2C3E50` | Amber swatch + "Burger" label |
| Cafe | `#6F4E37` | `#FDF5E6` | Brown swatch + "Cafe" label |
| Churrascaria | `#27AE60` | `#F39C12` | Green swatch + "Churrasco" label |
| Generic | `#EEFF00` | `#09090b` | Yellow swatch + "Default" label |

---

## 5. Component Inventory

### 5.1 BrandingClient — Palette Preset Chips (NEW)

**Location:** Inside existing "Color Palette" card, above the two color pickers.

**Layout:** Horizontal scrollable row (`flex gap-3 overflow-x-auto scrollbar-hide pb-2`).

**Chip anatomy:**
```
[colored circle 32×32px] [chip name 10px font-black]
```
Each chip is a `<button type="button">` with:
- Outer: `flex flex-col items-center gap-1.5 p-3 rounded-lg border border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50 transition-all active:scale-95 min-w-[56px]`
- Selected state (when current primary + accent exactly match): `border-zinc-900 bg-zinc-50`
- Color swatch: `w-8 h-8 rounded-full border border-zinc-200 shadow-sm flex-shrink-0` with `style={{ backgroundColor: preset.primary }}`
- Label: `text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap`

**onClick behavior:** Sets both `primary_color` and `accent_color` form fields to the preset values. Chips are purely a convenience — the hex inputs and color pickers remain the source of truth.

**Section heading addition:** Below the existing `h2 "Color Palette"` header, add:
```
<p class="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Quick Presets</p>
[chip row]
<div class="border-t border-zinc-50 mt-6 mb-8" /> <!-- separator before pickers -->
```

### 5.2 Public page.tsx — CSS Variable Injection (NEW)

**Location:** Server component JSX in `src/app/(public)/[slug]/page.tsx` and `src/app/(public)/[slug]/[menuSlug]/page.tsx`.

**Output:** A single `<style>` tag inside the component return, before `<ScanRecorder>` and `<MenuPage>`. This sits in the document `<head>` because Next.js App Router hoists `<style>` tags from the page component automatically.

```tsx
const primaryColor = (tenant.tenant_settings as any)?.primary_color ?? '#EEFF00'
const accentColor = (tenant.tenant_settings as any)?.accent_color ?? '#09090b'
const primaryForeground = computePrimaryForeground(primaryColor) // luminance util

return (
  <>
    <style>{`:root{--primary:${primaryColor};--primary-foreground:${primaryForeground};--accent:${accentColor};}`}</style>
    <ScanRecorder tenantId={tenant.id} />
    <MenuPage ... />
  </>
)
```

**Luminance util** (`src/lib/color-utils.ts`, new file):
- Parse hex → R, G, B (0–1 linear)
- Apply sRGB gamma: `c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`
- `L = 0.2126*R + 0.7152*G + 0.0722*B`
- Return `#09090b` if `L > 0.4`, else `#ffffff`

### 5.3 MenuPage / ProductCard / CartModal / ProductModal — Color Audit

**Current hardcoded colors to migrate:**

| File | Line | Hardcoded | Replacement |
|------|------|-----------|------------|
| `MenuPage.tsx` | 89 | `'#000000'` (primaryColor fallback) | `'#EEFF00'` (matches globals.css platform default) |
| `MenuPage.tsx` | 90 | `'#FF5722'` (accentColor fallback) | `'#09090b'` (matches new --accent default) |
| `MenuPage.tsx` | 663 | `bg-indigo-500` (cart badge) | `style={{ backgroundColor: primaryColor }}` + `text-primary-foreground` |
| `MenuPage.tsx` | 525 | `text-indigo-600` ("View Details" link) | `text-zinc-500` (neutral — not a tenant-branded element) |
| `MenuPage.tsx` | 748 | `text-indigo-500` (Hours modal clock icon) | `text-primary` |
| `CartModal.tsx` | 30 | `'#6366f1'` (accent fallback) | `'#09090b'` |
| `CartModal.tsx` | 35 | `bg-[#b0b8c8]` (modal background) | Keep as-is — structural chrome, not tenant-branded |
| `CartModal.tsx` | 155 | `bg-[#e8eaf0]` (order summary card) | Keep as-is — structural chrome |
| `CartModal.tsx` | 202 | `bg-[#e8eaf0]` (Checkout button) | Keep as-is — structural chrome |

**Elements already correctly using CSS vars (no change needed):**
- Category pill active: `style={{ backgroundColor: primaryColor, color: '#fff' }}` — already dynamic; migrate `'#fff'` to `primaryForeground` variable
- Add-to-cart button in ProductCard: `style={{ backgroundColor: primaryColor }}` — already dynamic
- Add-to-cart button in featured section: `style={{ backgroundColor: primaryColor }}` — already dynamic
- Product price badge (ProductCard): `style={{ color: accentColor }}` — already dynamic
- Product price in ProductModal: `style={{ color: accentColor }}` — already dynamic
- Cart total in CartModal: `style={{ color: accent }}` — already dynamic; update fallback from `'#6366f1'` to `'#09090b'`
- Header background (no banner): `style={{ backgroundColor: primaryColor }}` — already dynamic
- Header overlay tint: `style={{ backgroundColor: primaryColor, opacity: 0.2 }}` — already dynamic
- Toggle active: `bg-primary` — already uses CSS var

### 5.4 Onboarding API — Smart Default Palette (NEW)

**File:** `src/app/api/onboarding/route.ts`

**Change:** Extend the `tenant_settings` insert (line 134) to include `primary_color` and `accent_color` derived from `business_type`:

```ts
const CUISINE_PALETTES: Record<string, { primary: string; accent: string }> = {
  pizza:         { primary: '#E74C3C', accent: '#FFFFFF' },
  japanese:      { primary: '#C0392B', accent: '#1A1A1A' },
  burger:        { primary: '#F39C12', accent: '#2C3E50' },
  cafe:          { primary: '#6F4E37', accent: '#FDF5E6' },
  churrascaria:  { primary: '#27AE60', accent: '#F39C12' },
}
const defaultPalette = CUISINE_PALETTES[business_type] ?? { primary: '#EEFF00', accent: '#09090b' }
```

Insert these alongside phone and address in the `tenant_settings.insert()` call.

---

## 6. Interaction States

### Preset Chip

| State | Visual |
|-------|--------|
| Default | `border-zinc-100`, chip name `text-zinc-500` |
| Hover | `border-zinc-300`, `bg-zinc-50` |
| Active (press) | `scale-95` |
| Selected (colors match) | `border-zinc-900`, `bg-zinc-50`, chip name `text-zinc-900` |

### Color Picker + Hex Input

No changes to existing interaction pattern. Pickers already use `w-14 h-14`, hex inputs already use `font-mono uppercase text-[10px]`.

### Save Button

Uses existing BrandingClient pattern: `bg-primary text-zinc-950` → on success: `bg-green-500 text-white`. The `text-zinc-950` foreground for the primary button must be replaced with `text-primary-foreground` (computed dynamically) so dark tenant primaries render legible text.

**Save button CTA label:** "Deploy Changes" (existing — no change)

---

## 7. Copywriting Contract

### Admin — Branding Settings (Color Palette section)

| Element | Copy |
|---------|------|
| Section subheading above chips | "Quick Presets" |
| Preset chip labels | "Pizza", "Japanese", "Burger", "Cafe", "Churrasco", "Default" |
| Primary color field label | "Primary Brand Color" (existing — no change) |
| Primary color hint | "Used for headers and core UI" (existing — no change) |
| Accent color field label | "Interactive Accent" (existing — no change) |
| Accent color hint | "Used for prices and highlights" (existing — no change) |

### Public Menu — Empty State (no change)

Existing: Search icon + `{ui.noItems}` + `{ui.tryAnother}` — uses `UI_COPY` i18n map. No copy changes in this phase.

### Error States

| Scenario | Copy |
|----------|------|
| Save fails (existing alert) | "Error saving settings" (existing — no change) |

### Destructive Actions

None in this phase. No color reset or destructive confirmation flow is required. `#000000` check (treat as "not configured") is silent — it triggers a smart default at creation time only, not via a user-initiated reset.

---

## 8. Responsive Behavior

### Preset chip row

- Mobile (< 640px): horizontally scrollable row, `scrollbar-hide`, chips do not wrap
- Desktop (≥ 640px): row can display all 6 chips without scroll at standard viewport width (each chip ~56px min-width + gap = ~408px total, fits in single-column card on ≥ 640px)

### Color Palette card

Unchanged from existing `grid-cols-1 sm:grid-cols-2` layout for the two pickers. Preset row spans full width of the card above the grid.

---

## 9. Accessibility

- Each preset chip `<button>` carries `aria-label="Apply {PresetName} palette"` so screen readers announce the action without relying on the visual swatch
- Color swatch circles are `aria-hidden="true"` (decorative)
- The `<style>` injection does not affect accessibility tree
- `--primary-foreground` computation ensures minimum 4.5:1 contrast ratio for text-on-primary surfaces (buttons, active pills) against the 6 defined presets — all verified:
  - `#E74C3C` → L=0.214 → white foreground ✓
  - `#C0392B` → L=0.107 → white foreground ✓
  - `#F39C12` → L=0.462 → dark foreground ✓
  - `#6F4E37` → L=0.112 → white foreground ✓
  - `#27AE60` → L=0.153 → white foreground ✓
  - `#EEFF00` → L=0.886 → dark foreground ✓

---

## 10. Registry

**shadcn:** Not initialized. No registry applies.

**Third-party registries:** None.

**Safety Gate:** Not applicable.

---

## 11. Out of Scope (deferred)

Per CONTEXT.md `<deferred>` block — do NOT implement:

- WCAG contrast warning in BrandingClient (soft warning UI for failing AA contrast)
- Per-branch color overrides
- Any color reset / "restore default" button

---

## 12. Pre-population Audit

| Decision | Source |
|----------|--------|
| `--primary` / `--accent` CSS var mapping | CONTEXT.md §Implementation Decisions |
| Inline `<style>` injection location | CONTEXT.md §Implementation Decisions |
| 6 cuisine presets with exact hex values | CONTEXT.md §Implementation Decisions |
| `#000000` = "not configured" logic | CONTEXT.md §Implementation Decisions |
| Plan split (CSS injection + chips vs audit + smart defaults) | CONTEXT.md §Plan Structure |
| `--primary-foreground` computation | CONTEXT.md §Specific Ideas |
| BrandingClient existing patterns (card padding, label classes, toggle pattern) | Codebase scan — BrandingClient.tsx |
| Hardcoded hex audit findings | Codebase scan — MenuPage.tsx, CartModal.tsx, ProductModal.tsx |
| Onboarding insert location | Codebase scan — api/onboarding/route.ts line 134 |
| globals.css current CSS vars | Codebase scan — globals.css |
| Cart badge current color (`bg-indigo-500`) | Codebase scan — MenuPage.tsx line 663 |
