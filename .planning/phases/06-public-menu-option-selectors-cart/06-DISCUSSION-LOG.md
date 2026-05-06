# Phase 6: Public Menu — Option Selectors + Cart - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 06-public-menu-option-selectors-cart
**Areas discussed:** Option data fetching, CartContext vs local state, Product modal extension, Half-and-half UX

---

## Option Data Fetching

| Option | Description | Selected |
|--------|-------------|----------|
| Upfront in server component | Fetch all option groups alongside products; ISR-cached at revalidate=60; zero modal-open latency | ✓ |
| On-demand client-side | Fetch per product when customer opens modal; lighter initial load; ~100ms delay | |

**User's choice:** Recommended default — upfront server fetch
**Notes:** Consistent with existing pattern; ISR caches at same 60s interval; avoids loading state UX in the product modal.

---

## CartContext vs Local State

| Option | Description | Selected |
|--------|-------------|----------|
| Keep local useState | Cart stays in MenuPage.tsx; zero refactor overhead; cart only used here | ✓ |
| Extract to CartContext | Matches roadmap language; enables future cross-component cart access | |

**User's choice:** Recommended default — keep local state
**Notes:** Cart is only consumed within MenuPage.tsx and its inline functions; Context adds indirection without benefit at this scope.

---

## Product Modal Extension

| Option | Description | Selected |
|--------|-------------|----------|
| Extend in place in MenuPage.tsx | Add option selectors inside existing ProductModal function; consistent with monolith pattern | ✓ |
| Extract OptionSelector.tsx | Separate file; cleaner but MenuPage.tsx is already a large monolith | |

**User's choice:** Recommended default — extend in place
**Notes:** All public menu logic lives in one file; consistent with existing pattern; no new file overhead.

---

## Half-and-Half UX

| Option | Description | Selected |
|--------|-------------|----------|
| Both selectors stacked | 1st and 2nd half visible simultaneously; price preview updates live | ✓ |
| Wizard-style | Pick 1st half → 2nd half selector reveals; more guided but more steps | |

**User's choice:** Recommended default — stacked simultaneous
**Notes:** Simpler UX; both halves visible at once; price preview updates as each half is picked.

---

## Claude's Discretion

- Visual styling of option group sections within ProductModal
- Option group header formatting (group name, required indicator)
- Price preview placement and format
- Disabled state styling for max_selections checkboxes

## Deferred Ideas

None.
