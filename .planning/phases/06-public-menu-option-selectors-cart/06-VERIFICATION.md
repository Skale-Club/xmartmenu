---
phase: 06-public-menu-option-selectors-cart
verified: 2026-05-06T18:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
human_verification:
  - test: "Single required group blocks Add to cart until selected"
    expected: "Add to cart button is disabled (opacity-50, cursor-not-allowed) when any required single group has no selection"
    why_human: "Cannot test React state interactions and DOM disabled states without a running browser"
  - test: "Half-and-half price preview shows max of both halves"
    expected: "After choosing both halves, the price display updates to Math.max(half1.base_price, half2.base_price)"
    why_human: "Reactive state change requires running browser to observe"
  - test: "Same product with different options occupies separate cart slots"
    expected: "Adding a pizza as Size:Small and then Size:Large creates two distinct cart rows, not a quantity=2 row"
    why_human: "Cart state behavior requires runtime interaction"
  - test: "Cart popup floating button appears at bottom of menu page"
    expected: "A rounded pill button with cart total and count badge appears fixed at bottom-right when cart has items"
    why_human: "Visual positioning and conditional rendering require browser"
---

# Phase 06: Public Menu Option Selectors + Cart Verification Report

**Phase Goal:** Customers can select product options and add items to an in-memory cart shown as a popup at the bottom of the menu page
**Verified:** 2026-05-06T18:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Option groups for all products in a menu are fetched server-side and grouped by product_id | ✓ VERIFIED | `page.tsx:58–77` — Stage 3 fetch with `.in('product_id', productIds)`, grouped into `Record<string, GroupWithOptions[]>` |
| 2 | Option groups fetch is gated behind directOrdersEnabled to avoid unnecessary DB queries | ✓ VERIFIED | `page.tsx:59` — `if (directOrdersEnabled && productIds.length > 0)` |
| 3 | Options with is_available=false are stripped server-side | ✓ VERIFIED | `page.tsx:70` — `.filter(o => o.is_available)` in grouping loop |
| 4 | CartItem carries selectedOptions, unitPrice, and a composite cartKey string | ✓ VERIFIED | `MenuPage.tsx:60–66` — CartItem interface; `MenuPage.tsx:68–72` — buildCartKey() with sorted JSON.stringify |
| 5 | addToCart keyed by cartKey; same product + different options = separate cart slots | ✓ VERIFIED | `MenuPage.tsx:139–150` — addToCart uses `buildCartKey(product.id, selectedOptions)` and finds by `cartKey` |
| 6 | ProductModal renders radio/checkbox/half-and-half option selectors; required gate disables Add to cart | ✓ VERIFIED | `MenuPage.tsx:889–1068` — full selector JSX; `MenuPage.tsx:748–760` — canAddToCart; `MenuPage.tsx:1118–1119` — `disabled={!canAddToCart}` |
| 7 | computedUnitPrice updates reactively as selections change; half-and-half uses max(base_prices) | ✓ VERIFIED | `MenuPage.tsx:762–791` — IIFE; `MenuPage.tsx:780` — `Math.max(opt1?.base_price ?? 0, opt2?.base_price ?? 0)` |
| 8 | CartModal shows all items with quantities, unitPrice totals, and selectedOptions summary line | ✓ VERIFIED | `MenuPage.tsx:1148` — total uses `item.unitPrice * item.quantity`; `MenuPage.tsx:1163` — key is `item.cartKey`; `MenuPage.tsx:1166–1173` — options summary |
| 9 | Customer can increment/decrement/remove cart items; cart total recalculates automatically | ✓ VERIFIED | `MenuPage.tsx:1178,1185,1193` — all three operations pass `item.cartKey`; `MenuPage.tsx:136` — `cartTotal` is derived from `cart` state (auto-recalculates) |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(public)/[slug]/[menuSlug]/page.tsx` | Server component with option groups fetch + prop wiring | ✓ VERIFIED | 91 lines; Stage 3 fetch present; `optionGroupsByProductId` prop wired to `<MenuPage>` at line 88 |
| `src/components/menu/MenuPage.tsx` | CartItem extension + cart operations + ProductModal selector UI + CartModal | ✓ VERIFIED | 1249 lines; all required interfaces, functions, and JSX sections present and substantive |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `page.tsx` | `supabase product_option_groups` | `.in('product_id', productIds)` | ✓ WIRED | `page.tsx:63` — exact pattern matches |
| `page.tsx` | `MenuPage` | `optionGroupsByProductId` prop | ✓ WIRED | `page.tsx:88` — prop present on `<MenuPage>` JSX element |
| `addToCart` | `CartItem.cartKey` | `buildCartKey()` helper function | ✓ WIRED | `MenuPage.tsx:140` — `const key = buildCartKey(product.id, selectedOptions)` |
| `CartModal` | `item.unitPrice` | total reduce | ✓ WIRED | `MenuPage.tsx:1148` — `cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)` |
| `ProductModal` | `addToCart` | `onAddToCart(selectedOptions, computedUnitPrice)` | ✓ WIRED | `MenuPage.tsx:1116` — `onAddToCart(opts, computedUnitPrice)` inside button onClick; call site at line 579–584 |
| `canAddToCart` | Add to cart button disabled attr | `disabled={!canAddToCart}` | ✓ WIRED | `MenuPage.tsx:1118` — present; `MenuPage.tsx:1119` — `aria-disabled` also set |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `page.tsx` → MenuPage | `optionGroupsByProductId` | Supabase `product_option_groups` + `product_options` via `.select('*, options:product_options(*)')` | Yes — DB query, filtered, grouped server-side | ✓ FLOWING |
| `MenuPage.tsx` CartModal | `cart` state | `addToCart()` appends real CartItem objects with product, selectedOptions, unitPrice, cartKey | Yes — state populated from user interactions | ✓ FLOWING |
| `MenuPage.tsx` CartModal total | `total` | `cart.reduce(... item.unitPrice * item.quantity ...)` | Yes — derived from live cart state | ✓ FLOWING |
| `MenuPage.tsx` ProductModal | `computedUnitPrice` | IIFE iterating `optionGroups` (from `optionGroupsByProductId` passed down) + selection state | Yes — computed from real DB-sourced data | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — All key logic is inside React client components (useState, event handlers). No runnable CLI or API endpoint to check without a browser runtime. Human verification items above cover these behaviors.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ORD-08 | 06-01, 06-03 | Customer sees product option groups when opening a product detail | ✓ SATISFIED | `MenuPage.tsx:889` — `{optionGroups.length > 0 && (...)` gate; `optionGroups` passed from `optionGroupsByProductId[selectedProduct.id]` at call site |
| ORD-09 | 06-03 | Customer can select exactly one option from a single-type group (radio; required blocks add-to-cart) | ✓ SATISFIED | `MenuPage.tsx:919–952` — radio JSX; `MenuPage.tsx:748–751` — canAddToCart checks `!!singleSelections[group.id]` for required single groups |
| ORD-10 | 06-03 | Customer can select one or more options from a multiple-type group (checkboxes, respects min/max) | ✓ SATISFIED | `MenuPage.tsx:955–1004` — checkbox JSX with `maxReached` logic; `opacity-40 pointer-events-none` at line 967 |
| ORD-11 | 06-03 | Customer can pick two flavors for a half_and_half-type group; price = max(half1.base_price, half2.base_price) | ✓ SATISFIED | `MenuPage.tsx:1007–1064` — two stacked radio selectors; `MenuPage.tsx:780` and `MenuPage.tsx:1016` — both use `Math.max(...base_price)` |
| ORD-12 | 06-03 | Customer can add product with resolved options and computed unit_price to cart | ✓ SATISFIED | `MenuPage.tsx:1116` — `onAddToCart(opts, computedUnitPrice)` inside button onClick; `addToCart` stores `unitPrice` and `selectedOptions` on CartItem |
| ORD-13 | 06-02 | Customer can view cart popup at bottom of menu page with all items, quantities, and totals | ✓ SATISFIED | `MenuPage.tsx:588–598` — floating button (`fixed bottom-20 right-4`) triggers `setShowCartModal(true)`; `MenuPage.tsx:624–640` — CartModal rendered when `showCartModal=true` |
| ORD-14 | 06-02 | Customer can increment/decrement item quantity from cart | ✓ SATISFIED | `MenuPage.tsx:1177–1189` — `-` and `+` buttons call `onUpdateQuantity(item.cartKey, item.quantity ± 1)` |
| ORD-15 | 06-02 | Customer can remove an item from cart | ✓ SATISFIED | `MenuPage.tsx:1192–1195` — remove button calls `onRemove(item.cartKey)`; `removeFromCart` filters by cartKey |
| ORD-16 | 06-02 | Cart total recalculates automatically when items change | ✓ SATISFIED | `MenuPage.tsx:136` — `cartTotal` is a derived `const` (not state); recalculates on every render triggered by `setCart` |

All 9 requirement IDs (ORD-08 through ORD-16) are accounted for. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| `MenuPage.tsx` | 417 | `placeholder="Buscar..."` | ℹ️ Info | Unrelated to this phase — pre-existing search input in Portuguese only; not a stub |

No blockers. The three `return null` occurrences at lines 611, 900, 1013 are early-exit guards in conditional rendering blocks (not component stubs). No `item.product.price` references remain (confirmed: 0 matches).

### Human Verification Required

#### 1. Required Group Gate

**Test:** Open a product with a `required=true` single option group. Without selecting any option, inspect the "Add to cart" button.
**Expected:** Button has `disabled` attribute, shows `opacity-50 cursor-not-allowed` styling, and click does nothing.
**Why human:** React `disabled` + event blocking requires a live browser.

#### 2. Half-and-Half Price Reactivity

**Test:** Open a product with a `half_and_half` group. Select option A for 1st half (base_price = R$20) and option B for 2nd half (base_price = R$30). Observe the price display.
**Expected:** Price updates to R$30 (the max). "Price: R$30" line appears below the sub-selectors.
**Why human:** Reactive state updates need a running browser.

#### 3. Separate Cart Slots for Same Product + Different Options

**Test:** Add a product with a size group (Small / Large) to cart twice — once as Small, once as Large.
**Expected:** Cart shows two separate rows (not one row with quantity 2), each with its own price and option summary.
**Why human:** Cart state manipulation requires browser interaction.

#### 4. Cart Popup Floating Button Visibility

**Test:** Load a public menu page for a tenant with `direct_orders_enabled=true`. Add an item to cart.
**Expected:** A rounded floating button appears at `bottom-20 right-4` showing the cart total and a red count badge.
**Why human:** CSS positioning and conditional rendering require a rendered browser viewport.

### Gaps Summary

No gaps found. All 9 observable truths are fully verified at all levels (exists, substantive, wired, data flowing). All 9 requirement IDs are satisfied with concrete code evidence. No blocker anti-patterns were detected.

---

_Verified: 2026-05-06T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
