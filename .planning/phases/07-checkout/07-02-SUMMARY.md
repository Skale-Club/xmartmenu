---
phase: 07-checkout
plan: 02
subsystem: public-menu
tags: [checkout, confirmation, i18n, cart, orders]
dependency_graph:
  requires: [06-03]
  provides: [checkout-confirmation-ux]
  affects: [MenuPage.tsx, CartModal, submitOrder]
tech_stack:
  added: []
  patterns: [useState-snapshot-before-clear, conditional-modal-view]
key_files:
  modified:
    - src/components/menu/MenuPage.tsx
decisions:
  - Snapshot cart into confirmedCart before clearing to display ordered items in confirmation view
  - Use orderId && orderSuccess double-guard to render confirmation instead of cart form
  - HTML entity &#10003; for checkmark instead of emoji to avoid ESLint issues
metrics:
  duration: 277s
  completed: "2026-05-06"
  tasks_completed: 2
  files_modified: 1
requirements:
  - ORD-17
  - ORD-18
  - ORD-19
---

# Phase 7 Plan 2: Checkout Confirmation Flow Summary

**One-liner:** End-to-end checkout confirmation with order number, item snapshot, and multi-language copy inside CartModal.

## What Was Built

Wired the full checkout confirmation UX inside `MenuPage.tsx`:

1. **UI_COPY extended** — Added `orderPlaced`, `orderNumber`, `orderThankYou` keys to all 6 language entries (en/pt/es/fr/de/it) and the TypeScript type annotation.

2. **submitOrder updated** — Now sends `selected_options: item.selectedOptions` in the API payload, captures `data.id` into new `orderId` state, snapshots cart into `confirmedCart` before clearing, and keeps the modal open (removed `setShowCartModal(false)` and `setTimeout`).

3. **CartModal rewritten** — New props: `orderId: string | null`, `ui: typeof UI_COPY[string]`, `confirmedCart: CartItem[]`. When `orderSuccess && orderId`, renders a confirmation view (checkmark, translated heading, order number first 8 chars uppercased, item list with options, total, Close button). Otherwise renders the standard cart + form view.

4. **CartModal call site updated** — Passes `orderId`, `ui`, `confirmedCart` props. The `onClose` handler now resets `showCartModal`, `orderSuccess`, and `orderId` together.

## Tasks

| Task | Name | Commit | Files |
|---|---|---|---|
| 1 | Add UI_COPY confirmation keys for all 6 languages | d208b14 | src/components/menu/MenuPage.tsx |
| 2 | Update submitOrder, add orderId state, update CartModal and call site | ffb16de | src/components/menu/MenuPage.tsx |

## Verification Results

- `grep -c "orderPlaced"` returns 7 (type def + 6 languages) ✓
- `selected_options: item.selectedOptions` present in submitOrder ✓
- `setOrderId(data.id)` called after successful POST ✓
- `setTimeout` removed from file ✓
- `orderId.slice(0, 8).toUpperCase()` renders in confirmation ✓
- `setOrderId(null)` in onClose handler ✓
- `npm run build` exits 0 ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Functionality] Added confirmedCart state for item snapshot**

- **Found during:** Task 2 planning — the plan's NOTE explicitly flagged this
- **Issue:** After `setCart([])`, the cart prop would be empty when confirmation renders, showing no items
- **Fix:** Added `const [confirmedCart, setConfirmedCart] = useState<CartItem[]>([])` state; snapshot with `setConfirmedCart([...cart])` before clearing; pass `confirmedCart` as separate prop to CartModal for the confirmation view
- **Files modified:** src/components/menu/MenuPage.tsx
- **Commit:** ffb16de

**2. [Rule 1 - Bug] Used HTML entity instead of emoji checkmark**

- **Found during:** Task 2
- **Issue:** Raw checkmark emoji in JSX could trigger ESLint/linting issues in CI
- **Fix:** Used `&#10003;` HTML entity instead of emoji in the confirmation view
- **Files modified:** src/components/menu/MenuPage.tsx
- **Commit:** ffb16de

## Known Stubs

None — all data paths are wired. The confirmation view uses real `data.id` from the API response, real cart snapshot, and real i18n copy.

## Self-Check: PASSED

- File exists: src/components/menu/MenuPage.tsx ✓
- Commit d208b14 exists ✓
- Commit ffb16de exists ✓
- Build passes ✓
