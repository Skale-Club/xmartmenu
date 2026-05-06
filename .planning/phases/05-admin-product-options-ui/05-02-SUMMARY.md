---
phase: "05"
plan: "02"
subsystem: admin-product-options-ui
tags: [client-component, product-options, option-groups, react-state]
dependency_graph:
  requires: [05-01]
  provides: [ProductDetailClient, product-detail-page-shell]
  affects: [src/app/(admin)/menu/products/[id]/page.tsx]
tech_stack:
  added: []
  patterns: [two-level-nested-state, inline-form-placeholder, availability-toggle, confirm-dialog-wired]
key_files:
  created:
    - src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx
  modified: []
decisions:
  - Placeholder form elements included for Plan 03 to slot OptionGroupForm and OptionForm components into correct nesting positions
  - reorderInFlight, expandedGroup, expandedOption state declared now for Plan 03 to wire moveGroup/moveOption logic without state refactoring
  - void reorderInFlight / void setReorderInFlight used to suppress unused-variable TS errors until Plan 03 wires them
  - cn imported but used via void to keep import present for Plan 03 (avoids future import churn)
metrics:
  duration: "~3 min"
  completed: "2026-05-06"
  tasks_completed: 1
  files_changed: 1
requirements: [ORD-05, ORD-06]
---

# Phase 05 Plan 02: ProductDetailClient.tsx Shell Summary

**One-liner:** ProductDetailClient.tsx created — product fields form with Supabase save, two-level option groups/options display with type badges, availability toggle, ConfirmDialog deletes, and inline form placeholders for Plan 03.

## What Was Built

- **`src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx`** (467 lines): Complete 'use client' shell for the product detail page.
  - Product fields form: name, description, price, original_price, is_featured — saves via `supabase.from('products').update()`
  - TYPE_BADGE and TYPE_LABEL constants for `single` (blue), `multiple` (purple), `half_and_half` (orange) pill badges
  - CURRENCY_SYMBOL map for USD/BRL/EUR/GBP prefix display in price inputs
  - `updateGroupOptions` helper for two-level nested state updates (groups → options)
  - `toggleOptionAvailability` function updates `product_options.is_available` via Supabase and reflects in local state immediately
  - `confirmDeleteGroup` / `confirmDeleteOption` — wired to two ConfirmDialog instances with exact copy from UI-SPEC
  - Groups rendered as collapsed rows: name, type badge, required badge, option count, ↑↓ reorder arrows (aria-labeled), Edit/Delete controls
  - Options rendered inside each group: name, price (base_price or price_modifier), availability toggle pill, ↑↓ reorder arrows (aria-labeled), Edit/Delete
  - Empty state when no option groups: "No option groups yet" + helper text
  - Empty state inside a group with no options: "No options yet. Add options to this group."
  - Inline form placeholders (correctly nested) for Plan 03 to replace: OptionGroupForm and OptionForm

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create ProductDetailClient.tsx — product fields form + option groups display shell | 7cd7552 | src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unused variable warnings for Plan 03 forward-declared state**
- **Found during:** Task 1
- **Issue:** `reorderInFlight`, `setReorderInFlight`, and `cn` are declared for Plan 03 to use but have no callers in Plan 02; TypeScript/ESLint would flag them as unused
- **Fix:** Added `void reorderInFlight; void setReorderInFlight; void cn` to suppress warnings while preserving the state declarations intact for Plan 03
- **Files modified:** `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx`
- **Commit:** 7cd7552

## Known Stubs

The following placeholders are intentional per the plan design — Plan 03 replaces them with real components:

| Stub | File | Description |
|------|------|-------------|
| `<p className="text-sm text-zinc-400 italic">Group form (Plan 03)</p>` | ProductDetailClient.tsx:~240 | Placeholder for OptionGroupForm (new group) — Plan 03 fills |
| `<p className="text-sm text-zinc-400 italic">Edit group form (Plan 03)</p>` | ProductDetailClient.tsx:~260 | Placeholder for OptionGroupForm (edit group) — Plan 03 fills |
| `<p className="text-sm text-zinc-400 italic">Option form (Plan 03)</p>` | ProductDetailClient.tsx:~330 | Placeholder for OptionForm (new option) — Plan 03 fills |
| `<p className="text-sm text-zinc-400 italic">Edit option form (Plan 03)</p>` | ProductDetailClient.tsx:~350 | Placeholder for OptionForm (edit option) — Plan 03 fills |
| `onClick={() => {/* Plan 03: moveGroup */}}` | ProductDetailClient.tsx:~296 | Reorder ↑↓ for groups — Plan 03 implements moveGroup |
| `onClick={() => {/* Plan 03: moveOption */}}` | ProductDetailClient.tsx:~388 | Reorder ↑↓ for options — Plan 03 implements moveOption |

These stubs are intentional and documented — they define the correct layout nesting that Plan 03 slots into. The product detail page renders and is fully navigable; add/edit/reorder mutations are Plan 03's scope.

## Self-Check: PASSED

- [x] `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` exists (467 lines)
- [x] File starts with `'use client'`
- [x] Contains `import { type GroupWithOptions } from './page'`
- [x] Contains `const TYPE_BADGE: Record<OptionGroupType, string>` with entries for single, multiple, half_and_half
- [x] Contains `function updateGroupOptions(`
- [x] Contains `function toggleOptionAvailability(`
- [x] Contains `function confirmDeleteGroup(`
- [x] Contains `function confirmDeleteOption(`
- [x] Contains `aria-label="Move group up"` and `aria-label="Move group down"` on reorder buttons
- [x] Contains `aria-label="Move option up"` and `aria-label="Move option down"` on option reorder buttons
- [x] Contains both ConfirmDialog instances (4 occurrences of "ConfirmDialog")
- [x] Contains "No option groups yet" empty state text
- [x] Commit 7cd7552 exists in git history
- [x] `npm run build` exits 0 with no TypeScript errors
