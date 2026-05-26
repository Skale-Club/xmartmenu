---
id: SEED-026
status: ready
planted: 2026-05-25
planted_during: home-page-rebrand-planning
trigger_when: after SEED-025 is deployed (technically independent but deploy in order for safety)
scope: large
---

# SEED-026: Global Color Rebrand #EEFF00 → #F52323 (Wave 2)

## Why This Matters

The app's brand primary color is yellow-lime (`#EEFF00`). Changing to red (`#F52323`). The color drives 45+ files via a CSS variable (`--primary`), but 50+ instances hardcode `text-zinc-950` as text-on-primary (dark text — works on yellow, unreadable on red) and 14 files hardcode the hex fallback. Half-completing this leaves dark text on red buttons everywhere. Must ship as one atomic commit.

**Key insight:** `#EEFF00` is light → foreground `#09090b` (near-black). `#F52323` is dark/vivid → WCAG luminance returns `#ffffff` (white). The `--primary-foreground` CSS variable must flip along with `--primary`.

---

## What To Build

### 1. CSS variable defaults
**File:** `src/app/globals.css` (lines 6–7)
```css
--primary: #F52323;
--primary-foreground: #ffffff;
```

### 2. All 14 hardcoded `#EEFF00` fallbacks → `#F52323`

| File | Line(s) | Context |
|---|---|---|
| `src/app/(marketing)/layout.tsx` | 68 | `cta_color` fallback |
| `src/app/(superadmin)/layout.tsx` | 36 | `cta_color` fallback |
| `src/app/(admin)/layout.tsx` | 65, 111 | preview + admin primary fallback |
| `src/app/(public)/[slug]/page.tsx` | 90, 193 | public menu primary fallback |
| `src/app/(public)/[slug]/[menuSlug]/page.tsx` | 202 | menu page fallback |
| `src/app/(public)/[slug]/waiter/page.tsx` | 105 | waiter view fallback |
| `src/app/(public)/[slug]/me/page.tsx` | 52 | account panel fallback |
| `src/app/(public)/[slug]/me/login/page.tsx` | 22 | login page fallback |
| `src/components/menu/MenuPage.tsx` | 106, 790 | menu component fallback |
| `src/components/menu/AiChatWidget.tsx` | 25 | default prop fallback |
| `src/app/api/onboarding/route.ts` | 65 | onboarding default palette |

### 3. All 50 `bg-primary text-zinc-950` → `bg-primary text-primary-foreground`

Grep command: `bg-primary text-zinc-950` across all `.tsx` files.
Replace **only** paired occurrences — do NOT touch standalone `text-zinc-950` elsewhere.

Known files (22 total):
`ClientPage.tsx`, `AdminSidebar.tsx`, `CopyMenuUrl.tsx`, `dashboard/page.tsx`, `CategoriesClient.tsx`, `ProductsClient.tsx`, `MenusClient.tsx`, `OrdersClient.tsx`, `BrandingClient.tsx`, `ChatAddonClient.tsx`, `LocationsClient.tsx`, `QRCodeClient.tsx`, `StaffClient.tsx`, `DeliveryZonesSection.tsx`, `StoreClient.tsx`, `SubscriptionClient.tsx`, `login/page.tsx`, `register/page.tsx`, `pending/page.tsx`, `DashboardOverview.tsx`, `password/page.tsx`, `settings/store/StoreClient.tsx`

Also check `hover:bg-primary hover:text-zinc-950` and `group-hover:bg-primary group-hover:text-zinc-950` patterns — same replacement applies.

### 4. Hero heading gradient — preserve fade-out effect
**File:** `src/app/(marketing)/ClientPage.tsx:214`

```
from-primary via-yellow-200 to-white  →  from-primary via-red-200 to-white
```

Same `bg-clip-text text-transparent bg-gradient-to-r` structure — only the mid-stop changes. The "built for service." fade-out must remain visually smooth: vivid red → soft red → white.

### 5. Feature card hover gradient
**File:** `src/app/(marketing)/ClientPage.tsx:342`
```
to-yellow-500/5  →  to-primary/5
```
Makes it fully dynamic so it follows whatever primary color is set.

### 6. Admin defaults
- `src/app/(superadmin)/settings/SettingsClient.tsx:237`: `'#CBFF00'` → `'#F52323'`
- `src/app/(admin)/settings/branding/BrandingClient.tsx:24`: `primary: '#EEFF00'` → `primary: '#F52323'`

---

## Constraints

- One commit. Do not ship partial — half-done means dark text on red buttons everywhere.
- Only replace `text-zinc-950` where paired with `bg-primary`. Standalone `text-zinc-950` stays.
- `computePrimaryForeground()` in `src/lib/color-utils.ts` — no changes needed, already handles any hex.
- DB-stored `primary_color` / `cta_color` for existing tenants are unaffected (runtime override).

---

## Verification

1. All `bg-primary` buttons show white text on all pages
2. Hero "built for service." fades smoothly: red → light red → white
3. Admin sidebar active state: red background, white text
4. Auth login/register/pending buttons: red with white text
5. Public menu page primary color is red
6. No dark-on-red or dark-on-dark combinations anywhere
7. `hover:bg-primary` hover states also show white text on hover
