# Phase 6: Public Menu — Option Selectors + Cart - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The public menu page gains option group selection UI (radio buttons, checkboxes, half-and-half stacked pickers) inside the existing product modal. The `CartItem` type is extended to carry `selectedOptions` and `unitPrice`. The existing cart popup and submission flow are updated to use the resolved unit price. This phase ends at cart management — the checkout form and `submitOrder` function (already implemented in `MenuPage.tsx`) are Phase 7.

Scope: option selection in product modal, CartItem extension, cart popup showing selected options, computed unit_price in cart total.

</domain>

<decisions>
## Implementation Decisions

### Option Data Fetching
- **D-01:** Fetch `product_option_groups` with nested `product_options` upfront in the server component (`src/app/(public)/[slug]/[menuSlug]/page.tsx`), alongside the existing products and categories fetch. Use `Promise.all` parallel fetch. Filter to `is_available = true` options only.
- **D-02:** Pass the fetched option groups to `MenuPage` as a new `optionGroupsByProductId: Record<string, GroupWithOptions[]>` prop. The server does the grouping by `product_id` before passing to the client.
- **D-03:** The page already has `revalidate = 60` — no change needed. Option groups are ISR-cached at the same interval as products.

### Cart State Architecture
- **D-04:** Keep cart as local `useState` in `MenuPage.tsx` — no React Context extraction. The cart is only consumed within `MenuPage.tsx` and its inline `ProductModal`/`CartModal` functions. Extracting to Context adds complexity without benefit.
- **D-05:** Extend `CartItem` interface to `{ product: Product; quantity: number; selectedOptions: Record<string, unknown>; unitPrice: number }`. The `unitPrice` is the resolved price (base product price + option modifiers, or max of two halves for half_and_half). `selectedOptions` is stored as `Record<string, unknown>` for DB insertion compatibility (matches `selected_options JSONB` column).
- **D-06:** Update `cartTotal` from `item.product.price * item.quantity` to `item.unitPrice * item.quantity`. Update `addToCart` signature to `(product: Product, selectedOptions: Record<string, unknown>, unitPrice: number)`.

### Product Modal Extension
- **D-07:** Add option selection UI directly inside the existing `ProductModal` function in `MenuPage.tsx` (extend in place — no new file). The modal already renders product info; add an `<OptionSelector>` section between the product description and the "Add to cart" button.
- **D-08:** The "Add to cart" button is gated: disabled when any `required=true` single-type group has no selection made. Button label stays "Add to cart" (already in `UI_COPY` for multi-language).
- **D-09:** The computed `unitPrice` is shown as a price preview below the option selectors, updating reactively as options are selected. Format via existing `formatPrice(unitPrice, currency)`.

### Half-and-Half UX
- **D-10:** Half-and-half groups show both halves stacked vertically:
  - "First half" selector (labeled with group name + " — 1st half")
  - "Second half" selector (labeled with group name + " — 2nd half")
  - Both are visible simultaneously — no wizard/reveal.
  - Price resolves as `Math.max(half1.base_price ?? 0, half2.base_price ?? 0)` when both are selected.
  - Required half-and-half group: both halves must be selected before "Add to cart" is enabled.

### Option Selector Types
- **D-11:** `single` group → radio buttons (one selection, clears on re-click if not required).
- **D-12:** `multiple` group → checkboxes, respects `min_selections` and `max_selections`. If max is reached, remaining checkboxes are disabled.
- **D-13:** `half_and_half` group → two stacked single-option selectors (each renders like a radio group for the same option list).

### Cart Popup Updates
- **D-14:** Cart popup (existing `CartModal`) shows selected options as a brief summary line per item (e.g., "Size: Large, Extra cheese"). Use `Object.entries(item.selectedOptions)` to render key: value pairs.
- **D-15:** `CartModal` total calculation already uses `item.product.price` — update to `item.unitPrice`. The `CartItem` change handles this automatically once the type is extended.

### General
- **D-16:** Multi-language support: option group names and option names are stored in `translations JSONB` — use `name` field as fallback (translations display deferred per REQUIREMENTS.md out-of-scope note).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Public Menu (PRIMARY — extend, do not rewrite)
- `src/components/menu/MenuPage.tsx` — the entire public menu component; contains `CartItem`, `addToCart`, `ProductModal`, `CartModal`, `cartTotal`, all existing cart + checkout logic. Read in full before planning any changes.
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — server component; add option groups fetch here alongside existing products fetch.

### Database Schema + Types
- `supabase/migrations/021_orders_v11_schema.sql` — `product_option_groups` + `product_options` table definition, RLS policies (public can read options)
- `src/types/database.ts` — `ProductOptionGroup`, `ProductOption`, `OptionGroupType` union types — use these, do not redefine
- `src/app/(admin)/menu/products/[id]/page.tsx` — `GroupWithOptions` interface (exported from here) — reuse this type in the public page

### Requirements
- `.planning/REQUIREMENTS.md` §ORD-08 through ORD-16 — acceptance criteria for option selection and cart

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CartItem` interface (line ~53 in MenuPage.tsx) — extend, do not replace
- `addToCart(product)` (line ~123) — update signature to accept `selectedOptions` + `unitPrice`
- `cartTotal` (line ~120) — change `item.product.price` → `item.unitPrice`
- `ProductModal` function (line ~700) — add option selector section before "Add to cart" button
- `CartModal` function (line ~835) — update total calc + add selectedOptions summary per item
- `UI_COPY` record (line ~33) — multi-language strings already defined; add option-related strings here

### Established Patterns
- Server component fetches with `Promise.all` parallel — replicate for option groups fetch
- `formatPrice(price, currency)` utility for all price display
- ISR `revalidate = 60` — already handles option group cache
- `selectedProduct` state controls which product's modal is open

### Integration Points
- Server component `page.tsx`: add option groups fetch + pass `optionGroupsByProductId` prop to `MenuPage`
- `MenuPage` props: add `optionGroupsByProductId: Record<string, GroupWithOptions[]>`
- `ProductModal` props: receive the groups for the currently selected product
- `onAddToCart` callback: currently `() => addToCart(selectedProduct)` → update to collect `selectedOptions` + compute `unitPrice` first

</code_context>

<specifics>
## Specific Ideas

No specific references beyond codebase patterns above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-public-menu-option-selectors-cart*
*Context gathered: 2026-05-06*
