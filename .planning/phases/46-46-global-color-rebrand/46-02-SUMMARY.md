---
phase: 46-global-color-rebrand
plan: "02"
subsystem: ui
tags: [branding, color, buttons, accessibility, tailwind]

requires:
  - plan: 46-01
    provides: CSS variable flip to white foreground

provides:
  - All bg-primary buttons now use text-primary-foreground (white on red) instead of text-zinc-950 (dark)

affects: [admin, marketing, auth, superadmin]

tech-stack:
  added: []
  patterns:
    - Surgical replacement: text-zinc-950 → text-primary-foreground only on lines containing bg-primary

key-files:
  created: []
  modified:
    - src/components/admin/CopyMenuUrl.tsx
    - src/components/admin/AdminSidebar.tsx
    - src/app/(admin)/dashboard/page.tsx
    - src/app/(admin)/menus/MenusClient.tsx
    - src/app/(admin)/settings/subscription/SubscriptionClient.tsx
    - src/app/(admin)/settings/locations/LocationsClient.tsx
    - src/app/(admin)/settings/branding/BrandingClient.tsx
    - src/app/(admin)/menu/products/ProductsClient.tsx
    - src/app/(admin)/settings/store/StoreClient.tsx
    - src/app/(admin)/settings/store/DeliveryZonesSection.tsx
    - src/app/(admin)/orders/OrdersClient.tsx
    - src/app/(admin)/settings/chat/ChatAddonClient.tsx
    - src/app/(admin)/settings/password/page.tsx
    - src/app/(admin)/menu/categories/CategoriesClient.tsx
    - src/app/(admin)/settings/staff/StaffClient.tsx
    - src/app/(admin)/layout.tsx
    - src/app/(admin)/settings/qrcode/QRCodeClient.tsx
    - src/app/(marketing)/ClientPage.tsx
    - src/app/(superadmin)/overview/DashboardOverview.tsx
    - src/app/auth/login/page.tsx
    - src/app/auth/pending/page.tsx
    - src/app/auth/register/page.tsx

requirements-completed:
  - COLOR-03

duration: ~5min
completed: 2026-05-25
---

# Phase 46 Plan 02: Button Foreground Fix Summary

**All ~50 bg-primary buttons now use text-primary-foreground so white text renders on red.**

## Accomplishments

- PowerShell regex replacement across 22 files: on any line containing `bg-primary`, replaced `text-zinc-950` → `text-primary-foreground`
- Covers `hover:bg-primary hover:text-zinc-950` and `group-hover:` variants too
- Standalone `text-zinc-950` on non-primary-background elements untouched
- TypeScript check passed (0 errors)

## Decisions Made

- Used PowerShell line-scoped regex to be surgical — never touching `text-zinc-950` on lines without `bg-primary`
- Committing atomically with Plan 01: the CSS variable flip is only correct once all buttons use `text-primary-foreground`
---
*Phase: 46-global-color-rebrand*
*Completed: 2026-05-25*
