# Phase 8: Tenant Orders View - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The admin orders page (`/admin/orders`) is **nearly fully implemented** before this phase begins. `OrdersClient.tsx` already has: order list table, detail modal, `updateStatus` (pending→preparing→ready→done + cancel), DB persistence, status color badges. The server component already fetches `order_items(*)` including `selected_options`.

Phase 8 closes two specific gaps against the success criteria:
1. Add an "items count" column to the order list table rows
2. Display `selected_options` per item in the order detail modal

Scope: two targeted UI additions to `OrdersClient.tsx` only. No API changes needed.

</domain>

<decisions>
## Implementation Decisions

### Items Count in List Row
- **D-01:** Add an "Items" column to the order table showing the item count: `{order.order_items?.length ?? 0} items`. Position: after Phone, before Total.
- **D-02:** Column header: "Items" (or equivalent abbreviated label). Cell value: `"{N} item(s)"` — singular/plural handled.
- **D-03:** Style consistent with other data cells: `text-sm text-zinc-600`.

### Selected Options in Detail Modal
- **D-04:** In the detail modal's items list, show `selected_options` as a compact summary line below each item row, when `selected_options` is non-null and non-empty.
- **D-05:** Format: join the option values with `" · "` separator. Use `Object.values(item.selected_options as Record<string, unknown>).join(' · ')`. Display as `text-xs text-zinc-500` below the item name.
- **D-06:** Skip items with no selected_options (null, empty object, or all falsy values) — don't render an empty line.
- **D-07:** The `order_items.selected_options` is already fetched via `select('*, order_items(*)')` in the server component — no data fetch change needed.

### Notes Field
- **D-08:** If `order.notes` is non-null and non-empty, show it in the detail modal in a "Notes" section above the status block. Style: `text-sm text-zinc-700`. This is a minor addition since the field exists in the DB.

### General
- **D-09:** All changes are confined to `src/app/(admin)/orders/OrdersClient.tsx`. No changes to `page.tsx`, API routes, or types.
- **D-10:** The existing `currency` is hardcoded as `R$` in the detail modal — leave as-is (out of scope to fix).

### Claude's Discretion
- Exact column width for the new "Items" column in the table
- Whether "1 item" vs "1 items" requires singular/plural handling
- Spacing around the selected_options summary line

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Orders UI (PRIMARY — extend, do not rewrite)
- `src/app/(admin)/orders/OrdersClient.tsx` — full implementation; read in full before modifying. The table structure and detail modal are the two edit targets.
- `src/app/(admin)/orders/page.tsx` — server component; already fetches `order_items(*)` — no changes needed.

### Types
- `src/types/database.ts` — `Order` and `OrderItem` types; `OrderItem.selected_options: Record<string, unknown> | null`

### Requirements
- `.planning/REQUIREMENTS.md` §ORD-20, ORD-21

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Table Columns (OrdersClient.tsx ~line 58)
`ID | Customer | Phone | Total | Status | Date`
→ Add "Items" between Phone and Total

### Current Detail Modal Items Render (~line 114)
```
{selectedOrder.order_items?.map((item, idx) => (
  <div key={idx} className="flex justify-between text-sm">
    <span>{item.quantity}x {item.product_name}</span>
    <span>R$ {(item.unit_price * item.quantity).toFixed(2)}</span>
  </div>
))}
```
→ Add `selected_options` summary line below `<span>{item.quantity}x {item.product_name}</span>`

### Reusable Patterns
- Status badge pattern already uses `statusColors` record
- `order.id.slice(0, 8)` already used for ID display
- `new Date(order.created_at).toLocaleDateString(...)` already used for date

### Integration Points
- `OrderWithItems = Order & { order_items: OrderItem[] }` — `OrderItem` already has `selected_options: Record<string, unknown> | null`
- Server component already fetches `selected_options` via `select('*, order_items(*)')` — data is available, just not rendered

</code_context>

<specifics>
## Specific Ideas

No specific references — small extension of existing patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-tenant-orders-view*
*Context gathered: 2026-05-06*
