---
phase: 06-public-menu-option-selectors-cart
plan: "03"
subsystem: public-menu
tags: [option-selectors, product-modal, cart, ui, react]
dependency_graph:
  requires:
    - 06-01  # optionGroupsByProductId prop + server fetch
    - 06-02  # CartItem extension + addToCart(product, selectedOptions, unitPrice)
  provides:
    - Full option selection UI in ProductModal (radio/checkbox/half-and-half)
    - canAddToCart gate for required groups
    - computedUnitPrice reactive to selections
    - selectedOptions built and passed to addToCart on cart add
  affects:
    - src/components/menu/MenuPage.tsx
tech_stack:
  added: []
  patterns:
    - IIFE for computedUnitPrice derived value
    - Inline IIFEs for half-and-half and multiple-type JSX rendering
    - sr-only hidden native inputs with custom visual controls (radio/checkbox)
    - aria-disabled on wrapper label for disabled checkboxes (preserves DOM for screen readers)
key_files:
  created: []
  modified:
    - src/components/menu/MenuPage.tsx
decisions:
  - UI_COPY type extended to 15 keys — all 6 languages updated in one pass
  - onAddToCart signature changed from () => void to (selectedOptions, unitPrice) => void — ProductModal owns the selection state and builds selectedOptions before calling parent
  - Half-and-half price preview uses hardcoded "Price:" label per D-16 fallback rule (option group names aren't translated yet)
  - Temporary placeholder onClick(() => onAddToCart({}, computedUnitPrice)) added in Task 1 to keep build green before full JSX was in place — replaced in Task 2
  - mt-4 added to CTA div to maintain spacing after option selectors section
metrics:
  duration: "306s (~5 min)"
  completed: "2026-05-06"
  tasks_completed: 2
  files_modified: 1
---

# Phase 06 Plan 03: ProductModal Option Selector UI Summary

**One-liner:** Full option selection UI inside ProductModal — radio/checkbox/half-and-half selectors with reactive price preview, required-group gating, and selectedOptions passed to addToCart.

## What Was Built

This plan adds the complete customer-facing option selection interface to `ProductModal` in `MenuPage.tsx`. When a product has option groups (e.g. pizza sizes, toppings, half-and-half) and `directOrdersEnabled` is true, customers see interactive selectors between the product description and the price/CTA area.

### UI_COPY Extension (Task 1)

The `UI_COPY` record type was extended with 5 new keys:
- `required` — "Required" badge for mandatory option groups
- `chooseUpTo` — "Choose up to {max}" helper for multiple groups
- `chooseAtLeast` — "Choose at least {min}" helper
- `chooseBetween` — "Choose {min}–{max}" helper when both bounds set
- `firstHalf` / `secondHalf` — half-and-half sub-selector labels

All 6 languages (en/pt/es/fr/de/it) updated.

### Selection State + Derived Values (Task 1)

Three `useState` hooks added to `ProductModal`:
- `singleSelections: Record<string, string>` — tracks selected option ID per single-type group
- `halfSelections: Record<string, { half1: string | null; half2: string | null }>` — tracks both halves per half-and-half group
- `multiSelections: Record<string, string[]>` — tracks selected option IDs per multiple-type group

`useEffect` resets all three when `product.id` changes (prevents stale selections when modal reuses state).

`canAddToCart` — derived boolean that checks every `required=true` group has a valid selection. Gates the Add to cart button.

`computedUnitPrice` — IIFE that computes the resolved price:
- Single: `base_price` override if set, else adds `price_modifier`
- Half-and-half: `Math.max(half1.base_price, half2.base_price)`
- Multiple: accumulates `price_modifier` for each checked option

### Option Selector JSX (Task 2)

Inserted between product description and price/CTA row, gated by `optionGroups.length > 0`.

**Single groups** — radio buttons. Each option is a full-row `<label>` (min-h-[44px] touch target) with hidden native `<input type="radio" className="sr-only">` and custom circular indicator. Selected: `bg-zinc-50 border-zinc-900`. Price modifier shown inline; absolute base_price right-aligned.

**Multiple groups** — checkboxes. Same row treatment as single. Custom square control with SVG white checkmark. When `max_selections` reached, unselected options get `opacity-40 pointer-events-none`. Min/max hint text rendered as `text-xs text-zinc-400`.

**Half-and-half groups** — two stacked radio selectors inside `rounded-2xl bg-zinc-50` container. Each sub-selector labeled with `{groupName} — {firstHalf|secondHalf}`. When both halves selected, shows "Price: {formatPrice(max, currency)}" below.

### Reactive Price Preview (Task 2)

Static `{formatPrice(product.price, currency)}` replaced with `{formatPrice(computedUnitPrice, currency)}`. When options modify the price, a "Base: {original price}" hint appears below.

### Add to Cart Button (Task 2)

Button gated with `disabled={!canAddToCart}` and `aria-disabled`. When disabled: `opacity-50 cursor-not-allowed`. When enabled: `hover:bg-zinc-800`.

`onClick` handler builds `selectedOptions` Record by iterating `optionGroups`:
- Single: `{ [group.name]: opt.name }`
- Half-and-half: `{ [group.name]: "opt1.name / opt2.name" }`
- Multiple: `{ [group.name]: "name1, name2" }`

Then calls `onAddToCart(opts, computedUnitPrice)`.

### Call Site Update (Task 2)

ProductModal call site updated to pass `optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []}` and `onAddToCart` now receives `(selectedOptions, unitPrice)` then calls `addToCart(selectedProduct, selectedOptions, unitPrice)`.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `34bb8fa` | extend UI_COPY + add ProductModal option state hooks |
| Task 2 | `e7aa640` | add option selector JSX to ProductModal + update call site |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error from onAddToCart signature change**
- **Found during:** Task 1 build verification
- **Issue:** Changing `onAddToCart?: () => void` to `onAddToCart?: (selectedOptions, unitPrice) => void` caused the existing `onClick={onAddToCart}` button to fail type check (MouseEventHandler expects event, not (opts, price))
- **Fix:** Updated the temporary button to `onClick={() => onAddToCart({}, computedUnitPrice)}` in Task 1, then fully replaced in Task 2 with the real selectedOptions builder
- **Files modified:** `src/components/menu/MenuPage.tsx`
- **Commit:** `34bb8fa`

**2. [Rule 2 - Missing] Added mt-4 margin to price/CTA div**
- **Found during:** Task 2 JSX insertion
- **Issue:** When option selectors section is present, the price/CTA div needed top margin (the original had no mt-* because it was immediately after the description which has mb-4)
- **Fix:** Added `mt-4` to the price/CTA div class to maintain spacing
- **Files modified:** `src/components/menu/MenuPage.tsx`
- **Commit:** `e7aa640`

## Requirements Satisfied

- ORD-08: ProductModal renders option groups when product has groups and directOrdersEnabled
- ORD-09: Single groups use radio buttons; required gate disables "Add to cart" until selected
- ORD-10: Multiple groups use checkboxes; max reached disables unchosen options with opacity-40
- ORD-11: Half-and-half groups show two stacked selectors; price = max(half1.base_price, half2.base_price)
- ORD-12: addToCart called with built selectedOptions and computedUnitPrice; cart item carries correct unitPrice

## Self-Check: PASSED
