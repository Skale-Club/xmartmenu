# Phase 8: Tenant Orders View - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-05-06
**Phase:** 08-tenant-orders-view
**Areas discussed:** Items count in list row, Selected options in detail modal

---

## Items Count in List Row

| Option | Description | Selected |
|--------|-------------|----------|
| Add item count column | Show 'N items' in each table row for at-a-glance scanning | ✓ |
| Leave items in detail only | Clicking the row opens detail modal — no change to table | |

**User's choice:** Add items count column
**Notes:** Makes order size visible at a glance without clicking into detail.

---

## Selected Options in Detail Modal

| Option | Description | Selected |
|--------|-------------|----------|
| Show selected_options per item | Compact summary line below each item name: "Size: Large · Extra cheese" | ✓ |
| Keep items display as-is | Only show product name and price per item | |

**User's choice:** Show selected options in detail modal
**Notes:** Operationally important — kitchen needs to know exactly what customizations the customer selected.

---

## Claude's Discretion

- Exact column width for Items column
- Singular/plural handling ("1 item" vs "1 items")
- Spacing around selected_options summary line

## Deferred Ideas

None.
