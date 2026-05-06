---
phase: "05"
plan: "01"
subsystem: admin-product-options-ui
tags: [routing, server-component, supabase, product-options]
dependency_graph:
  requires: [04-02]
  provides: [product-detail-route, group-with-options-type]
  affects: [ProductsClient.tsx]
tech_stack:
  added: []
  patterns: [async-params-next15, parallel-promise-all-fetch, referencedTable-nested-order]
key_files:
  created:
    - src/app/(admin)/menu/products/[id]/page.tsx
  modified:
    - src/app/(admin)/menu/products/ProductsClient.tsx
decisions:
  - Edit button navigates to /admin/menu/products/[id] instead of opening modal (D-03: modal kept for future quick-edit)
  - GroupWithOptions interface exported from page.tsx so ProductDetailClient (Plan 02) can import it
  - async params pattern (Promise<{ id: string }>) used per Next.js 15+ requirement
  - Nested options ordered via referencedTable:'product_options' to fix Pitfall 1
metrics:
  duration: "~1 min"
  completed: "2026-05-06"
  tasks_completed: 2
  files_changed: 2
requirements: [ORD-05]
---

# Phase 05 Plan 01: Entry Point + Server Component Summary

**One-liner:** Product detail route wired — Edit button navigates to /admin/menu/products/[id] and server component fetches product, option groups with nested ordered options, and tenant settings in parallel.

## What Was Built

- **ProductsClient.tsx Edit button** updated: `onClick` changed from `startEdit(product)` to `router.push(\`/admin/menu/products/${product.id}\`)`. The `startEdit` function and modal remain intact for potential future quick-edit use.
- **New route `src/app/(admin)/menu/products/[id]/page.tsx`** (server component): fetches product (with category), all option groups (with nested `product_options` ordered by `position`), and tenant settings in parallel via `Promise.all`. Guards with `notFound()` if the product doesn't exist or doesn't belong to the tenant. Exports `GroupWithOptions` interface for downstream use by `ProductDetailClient` (Plan 02).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Update Edit button to navigate to product detail page | 56b5a52 | src/app/(admin)/menu/products/ProductsClient.tsx |
| 2 | Create server component for product detail route | c4b8e38 | src/app/(admin)/menu/products/[id]/page.tsx |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

- `ProductDetailClient` is imported by `page.tsx` but does not yet exist — will be created in Plan 02. TypeScript will report a module-not-found error until then. This is intentional and documented in the plan.

## Self-Check

- [x] `src/app/(admin)/menu/products/[id]/page.tsx` exists
- [x] `src/app/(admin)/menu/products/ProductsClient.tsx` contains `router.push` navigation on Edit button
- [x] Commits 56b5a52 and c4b8e38 exist in git history
- [x] `startEdit` function still present in ProductsClient.tsx (line 141)
- [x] `GroupWithOptions` exported from page.tsx
- [x] `referencedTable: 'product_options'` present in page.tsx
- [x] `await params` pattern used (Next.js 15+ async params)
- [x] `if (!product) notFound()` guard present
