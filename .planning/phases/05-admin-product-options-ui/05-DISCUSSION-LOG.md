# Phase 5: Admin Product Options UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 05-admin-product-options-ui
**Areas discussed:** Entry point, Creation flow, Position ordering, Price field design

---

## Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing product modal | Add option groups section inside the existing max-w-4xl modal — no routing change | |
| Dedicated /products/[id] page | New App Router route; admin navigates from product list row "Edit" button | ✓ |

**User's choice:** Recommended default — dedicated product detail page
**Notes:** Roadmap explicitly says "product detail/edit page"; option groups need sufficient screen space; existing modal would become too crowded.

---

## Creation Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Inline expand-form | "+ Add group" expands an inline form row; collapses after save. No sub-modals. | ✓ |
| Sub-modal | A nested modal opens within the option groups section | |
| Inline editable rows | Click-to-edit directly on the row text | |

**User's choice:** Recommended default — inline expand-form
**Notes:** Avoids modal-within-modal stacking; matches "no extra navigation" admin feel.

---

## Position Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Up/down arrow buttons | ↑↓ buttons on each row; no new library dependency | ✓ |
| Drag-and-drop | Needs dnd-kit or @hello-pangea/dnd — not currently installed | |

**User's choice:** Recommended default — up/down arrow buttons
**Notes:** No drag-and-drop library installed; simpler to implement and maintain.

---

## Price Field Design

| Option | Description | Selected |
|--------|-------------|----------|
| Both fields always shown | Show base_price + price_modifier inputs on every option form | |
| Adaptive single field | Field label/semantics change based on group type (base_price for single/half_and_half, price_modifier for multiple) | ✓ |
| Fixed to price_modifier only | Always treat as modifier, simplify schema usage | |

**User's choice:** Recommended default — adaptive single field
**Notes:** Matches schema intent; reduces cognitive load for admins; field label updates reactively when group type changes.

---

## Claude's Discretion

- Visual layout of option groups section (card per group vs. flat list)
- Loading/saving state indicators within inline forms
- Empty state when product has no groups
- Option count summary on group header row

## Deferred Ideas

None.
