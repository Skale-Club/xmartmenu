# Phase 7: Checkout - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the order submission path: `selected_options` must be persisted to DB through the API, and the customer must see a proper confirmation screen (order ID, items, total) after placing their order. The checkout form (`customerName`, `customerPhone`), `submitOrder` function, and the `CartModal` UI all exist in `MenuPage.tsx` — this phase extends them, not replaces them.

Scope: add `selected_options` to API + DB path; capture `orderId` from response; show confirmation view inside existing `CartModal`.

</domain>

<decisions>
## Implementation Decisions

### selected_options API Path
- **D-01:** Add `selected_options: item.selectedOptions` to the `items.map()` inside `submitOrder` in `MenuPage.tsx`. The field already exists on `CartItem` after Phase 6.
- **D-02:** Add `selected_options?: Record<string, unknown>` to the `OrderItem` interface in `src/app/api/orders/route.ts`.
- **D-03:** Add `selected_options: item.selected_options || null` to the `orderItems` array inside the POST handler so the JSONB column is populated on insert.

### Order ID Capture
- **D-04:** Add `const [orderId, setOrderId] = useState<string | null>(null)` to `MenuPage.tsx`.
- **D-05:** After a successful POST, capture `data.id` and call `setOrderId(data.id)`. Remove the existing `setTimeout(() => setOrderSuccess(false), 3000)` — it is replaced by the explicit dismiss below.
- **D-06:** Reset `orderId` to `null` when the confirmation is dismissed.

### Confirmation Screen
- **D-07:** When `orderSuccess === true`, the `CartModal` renders a confirmation view **instead of** the cart items and checkout form. The existing `showCartModal` state remains `true` — the modal stays open. No new modal or overlay is needed.
- **D-08:** Confirmation view content:
  - Heading: "Order placed!" (or the multi-language equivalent from `UI_COPY`)
  - Order number: `#${orderId?.slice(0, 8).toUpperCase()}` (first 8 chars of UUID, uppercased)
  - Item list: each item shows `product name × quantity` + selected options summary (same format as cart item options summary from Phase 6)
  - Total: formatted via `formatPrice(total, currency)`
- **D-09:** Confirmation dismissal: a single "Close" button at the bottom calls `onClose()` — which already resets `showCartModal` to false. The `orderSuccess` and `orderId` states are also reset to `false`/`null` in the `onClose` handler.
- **D-10:** No auto-close timer — the customer reads the confirmation at their own pace.

### CartModal Props Change
- **D-11:** Add `orderId: string | null` as a new prop to `CartModal`. The component renders the confirmation view when both `orderSuccess === true` and `orderId !== null`.
- **D-12:** The existing `submittingOrder`, `orderError`, `onCustomerNameChange`, `onCustomerPhoneChange`, `onSubmit` props remain — they are still used for the pre-submission state.

### Multi-language Copy
- **D-13:** Add confirmation-related keys to `UI_COPY` for all 6 languages (en/pt/es/fr/de/it): `orderPlaced`, `orderNumber`, `orderThankYou`. Use `Order placed!` / `Pedido realizado!` / etc.

### Claude's Discretion
- Visual layout of the confirmation view within CartModal
- Icon or emoji to indicate success (optional, if consistent with existing style)
- Whether to show a divider between items in the confirmation

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Checkout Path (PRIMARY — extend, do not rewrite)
- `src/components/menu/MenuPage.tsx` — contains `submitOrder`, `CartModal`, `orderSuccess`, `orderId` (to add), `CartItem` with `selectedOptions`. Read `submitOrder` (lines ~168–210) and `CartModal` function (lines ~1133+) in full.
- `src/app/api/orders/route.ts` — `OrderItem` interface + POST handler; add `selected_options` to both. Read in full before modifying.

### Types
- `src/types/database.ts` — `OrderItem` DB type has `selected_options: Record<string, unknown> | null`

### Requirements
- `.planning/REQUIREMENTS.md` §ORD-17, ORD-18, ORD-19

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `submitOrder` (line ~168) — add `selected_options: item.selectedOptions` to items map; capture `data.id`; remove `setTimeout`
- `CartModal` function (line ~1133) — add `orderSuccess` branch: when true, render confirmation view instead of cart/form
- `formatPrice()` — already used in CartModal for totals; reuse in confirmation
- `UI_COPY` — already has 6-language support; add 3 new keys

### Established Patterns
- `CartModal` already receives `orderSuccess` and `cart` props — confirmation view has access to all items + total
- Options summary per item already rendered in CartModal (Phase 6) — reuse same pattern in confirmation

### Integration Points
- `orderId` state → new `CartModal` prop `orderId`
- `onClose` handler in CartModal → must also call `setOrderSuccess(false)` + `setOrderId(null)`

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard implementation following patterns above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-checkout*
*Context gathered: 2026-05-06*
