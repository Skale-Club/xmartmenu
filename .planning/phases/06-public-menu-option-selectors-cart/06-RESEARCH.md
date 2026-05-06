# Phase 6: Public Menu — Option Selectors + Cart — Research

**Researched:** 2026-05-06
**Domain:** React state management, option selection UI, cart logic in Next.js App Router
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Fetch `product_option_groups` with nested `product_options` upfront in the server component (`src/app/(public)/[slug]/[menuSlug]/page.tsx`), alongside the existing products and categories fetch. Use `Promise.all` parallel fetch. Filter to `is_available = true` options only.
- **D-02:** Pass the fetched option groups to `MenuPage` as a new `optionGroupsByProductId: Record<string, GroupWithOptions[]>` prop. The server does the grouping by `product_id` before passing to the client.
- **D-03:** The page already has `revalidate = 60` — no change needed. Option groups are ISR-cached at the same interval as products.
- **D-04:** Keep cart as local `useState` in `MenuPage.tsx` — no React Context extraction.
- **D-05:** Extend `CartItem` interface to `{ product: Product; quantity: number; selectedOptions: Record<string, unknown>; unitPrice: number }`. The `unitPrice` is the resolved price. `selectedOptions` is `Record<string, unknown>` for DB insertion compatibility.
- **D-06:** Update `cartTotal` from `item.product.price * item.quantity` to `item.unitPrice * item.quantity`. Update `addToCart` signature to `(product: Product, selectedOptions: Record<string, unknown>, unitPrice: number)`.
- **D-07:** Add option selection UI directly inside the existing `ProductModal` function in `MenuPage.tsx` (extend in place — no new file).
- **D-08:** The "Add to cart" button is gated: disabled when any `required=true` single-type group has no selection made. Button label stays "Add to cart".
- **D-09:** The computed `unitPrice` is shown as a price preview below the option selectors, updating reactively.
- **D-10:** Half-and-half groups show both halves stacked vertically simultaneously. Price resolves as `Math.max(half1.base_price ?? 0, half2.base_price ?? 0)` when both are selected. Both halves must be selected for required gate.
- **D-11:** `single` group → radio buttons.
- **D-12:** `multiple` group → checkboxes, respects `min_selections` and `max_selections`.
- **D-13:** `half_and_half` group → two stacked single-option selectors.
- **D-14:** Cart popup shows selected options as a brief summary line per item.
- **D-15:** `CartModal` total calc updated to use `item.unitPrice`.
- **D-16:** Multi-language: use `name` field as fallback (translations display deferred).

### Claude's Discretion

None specified — all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORD-08 | Customer sees product option groups when opening a product detail | Server component fetches `product_option_groups` + `product_options` with `is_available = true` filter; passed as `optionGroupsByProductId` prop to `MenuPage`; `ProductModal` renders the option section when groups exist |
| ORD-09 | Customer can select exactly one option from a `single`-type group (radio — required group blocks add-to-cart if unselected) | `single` → native `<input type="radio">` with `name={groupId}`; `canAddToCart` derived value gates button; `required=true` + no selection → disabled |
| ORD-10 | Customer can select one or more options from a `multiple`-type group (checkboxes, respects min/max_selections) | `multiple` → `<input type="checkbox">`; selection state is `string[]`; when `selectedCount === max_selections`, unselected options get `opacity-40 pointer-events-none` |
| ORD-11 | Customer can pick two flavors for a `half_and_half`-type group; price resolves via `max(half1.base_price, half2.base_price)` | Two independent radio selectors over the same option list; price formula `Math.max(half1Option.base_price ?? 0, half2Option.base_price ?? 0)` |
| ORD-12 | Customer can add product with resolved options and computed unit_price to cart | `addToCart(product, selectedOptions, unitPrice)` signature; `unitPrice` computed in `ProductModal` before calling; composite cart key `${product.id}::${stableOptionsKey}` |
| ORD-13 | Customer can view cart popup with all items, quantities, and totals | `CartModal` already exists; update to render `selectedOptions` summary line and use `item.unitPrice` for totals |
| ORD-14 | Customer can increment/decrement item quantity from cart (+/- controls) | Existing `onUpdateQuantity` handler; must use composite cart key instead of `product.id` alone |
| ORD-15 | Customer can remove an item from cart | Existing `onRemove` handler; must use composite cart key |
| ORD-16 | Cart total recalculates automatically when items change | `cartTotal` driven by `item.unitPrice * item.quantity` sum — reactive automatically with `useState` |
</phase_requirements>

---

## Summary

Phase 6 extends the existing `MenuPage.tsx` client component in place. All data, state, and display logic lives in the single file — no new files, no Context extraction, no new dependencies. The server component (`page.tsx`) gains a third parallel Supabase query for option groups, which it groups by `product_id` before passing to `MenuPage` as a new prop. Inside `MenuPage`, `CartItem` is extended with `selectedOptions` and `unitPrice`, and `ProductModal` gains an option selection section injected between the product description and the CTA row.

The most critical architectural decision is the **cart item keying change**. Currently cart items are keyed by `product.id`. Because the same product can appear twice with different options (e.g., same pizza, small vs large), the key must become a composite of `product.id + serialized selectedOptions`. Every cart operation (`addToCart`, `removeFromCart`, `updateCartQuantity`) and the `CartModal` rendering must use this composite key. Missing this causes option variants to silently merge in the cart — a correctness bug, not a cosmetic issue.

The second critical area is the **required-group gate**. `canAddToCart` must be a derived boolean computed from `modalSelections` state: all groups where `required === true` must satisfy their selection criteria. For `single` and `half_and_half` (both halves), this means the selection exists. For `multiple`, this means `selectedCount >= min_selections`. This value drives both the `disabled` attribute and `aria-disabled` on the "Add to cart" button.

**Primary recommendation:** Implement as three sequential tasks — (1) server component data fetch + prop wiring, (2) `CartItem` + `addToCart` + cart key refactor, (3) `ProductModal` option selector section + price preview. This ordering means task 2 can be verified independently before the UI complexity of task 3 is added.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React `useState` | 19 (via Next.js 15) | Modal selection state, cart state | Already in use throughout `MenuPage.tsx` |
| TypeScript | 5.x | Type-safe option state shapes | Already enforced in the project |
| Tailwind CSS v4 | 4.x | All styling | Established in UI-SPEC; no shadcn |
| `@supabase/supabase-js` | 2.x | Server-side option groups query | `createServiceClient()` already used in `page.tsx` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | ^1.7.0 | Icons (checkmark SVG in custom checkbox) | Already installed; only if custom checkbox SVG needs it |
| `formatPrice` (internal) | — | Price display formatting | Already used in `MenuPage.tsx` and `CartModal` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Local `useState` in `ProductModal` | Zustand / React Context | Context adds a `'use client'` boundary and file split; no benefit when state doesn't leave `MenuPage.tsx` |
| Inline option UI in `ProductModal` | Separate `OptionSelector` component file | Separate file would require importing back into `MenuPage.tsx`; D-07 locks this to in-place extension |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

No new files. All changes are in two existing files:

```
src/
├── app/(public)/[slug]/[menuSlug]/
│   └── page.tsx              ← add option groups query + grouping + new prop
└── components/menu/
    └── MenuPage.tsx          ← CartItem extension, addToCart, ProductModal, CartModal
```

### Pattern 1: Parallel Server Fetch with Product-Keyed Map

**What:** The server component fetches all option groups for all products in the menu in one query, then reduces them into a `Record<string, GroupWithOptions[]>` keyed by `product_id`.

**When to use:** Any time client components need per-product lookup without runtime fetch overhead.

**Example:**
```typescript
// In page.tsx — add to existing Promise.all
const [{ data: categories }, { data: products }, { data: optionGroups }] = await Promise.all([
  supabase.from('categories').select('*').eq('menu_id', menu.id).eq('is_active', true).order('position'),
  supabase.from('products').select('*').eq('menu_id', menu.id).eq('is_available', true).order('position'),
  supabase
    .from('product_option_groups')
    .select('*, options:product_options(*)')
    .in('product_id', /* product ids extracted after products query */ [])  // see note below
    .eq('options.is_available', true)
    .order('position')
    .order('position', { referencedTable: 'product_options' }),
])
```

**Note on the query:** Because `products` must resolve before we have product IDs to filter option groups, the `Promise.all` must either (a) fetch option groups by `menu_id` join (preferred — see below), or (b) run option groups fetch sequentially after products. The cleaner approach is to use the `menu_id` path:

```typescript
// Option A: join via product_id IN (products for this menu)
// The admin page uses: .select('*, options:product_options(*)').eq('product_id', id)
// For the public page, filter by tenant_id or use a subquery pattern.
// Cleanest approach: fetch all option groups where product_id IN product IDs,
// but that requires products to resolve first.
//
// RECOMMENDED: Run in two stages — first parallel fetch for tenant+menu+categories+products,
// then parallel fetch for option groups using the resolved product IDs.
```

**Actual recommended implementation:**

```typescript
// Stage 1: parallel (same as existing)
const [tenant, { data: menuCandidate }] = await Promise.all([...])

// Stage 2: parallel using menu.id
const [{ data: categories }, { data: products }] = await Promise.all([
  supabase.from('categories')...,
  supabase.from('products')...,
])

// Stage 3: option groups using resolved product IDs
const productIds = (products ?? []).map(p => p.id)
const { data: rawGroups } = productIds.length > 0
  ? await supabase
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .in('product_id', productIds)
      .order('position')
      .order('position', { referencedTable: 'product_options' })
  : { data: [] }

// Group by product_id
const optionGroupsByProductId: Record<string, GroupWithOptions[]> = {}
for (const group of rawGroups ?? []) {
  const filtered = { ...group, options: group.options.filter(o => o.is_available) }
  if (!optionGroupsByProductId[group.product_id]) optionGroupsByProductId[group.product_id] = []
  optionGroupsByProductId[group.product_id].push(filtered as GroupWithOptions)
}
```

### Pattern 2: Modal Local State for Option Selections

**What:** `ProductModal` uses internal `useState` hooks for the current selection state. State is created fresh each time a modal opens (via `product.id` dependency — already handled by `useEffect(() => setImageIndex(0), [product.id])`).

**When to use:** Selection state only matters while the modal is open. Discarding on close is correct UX.

**Example:**
```typescript
// Inside ProductModal function (after existing useState hooks)
const groups = optionGroups ?? []

// For single and half_and_half: Record<groupId, optionId>
const [singleSelections, setSingleSelections] = useState<Record<string, string>>({})
// For half_and_half: Record<groupId, { half1: string | null; half2: string | null }>
const [halfSelections, setHalfSelections] = useState<Record<string, { half1: string | null; half2: string | null }>>({})
// For multiple: Record<groupId, string[]>
const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>({})

// Reset when product changes
useEffect(() => {
  setSingleSelections({})
  setHalfSelections({})
  setMultiSelections({})
}, [product.id])
```

### Pattern 3: Composite Cart Key

**What:** When the same product can be added with different option selections, the cart key must be a string combining `product.id` with a stable serialization of `selectedOptions`.

**When to use:** Every cart state operation: `addToCart`, `removeFromCart`, `updateCartQuantity`, `cart.map(item => ...)` in `CartModal`.

**Example:**
```typescript
// Stable key: sort entries to avoid key-order differences
function cartKey(productId: string, selectedOptions: Record<string, unknown>): string {
  return `${productId}::${JSON.stringify(
    Object.fromEntries(Object.entries(selectedOptions).sort(([a], [b]) => a.localeCompare(b)))
  )}`
}

// Updated CartItem
interface CartItem {
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  cartKey: string  // derived, stored for O(1) lookup
}

// Updated addToCart
function addToCart(product: Product, selectedOptions: Record<string, unknown>, unitPrice: number) {
  const key = cartKey(product.id, selectedOptions)
  setCart(prev => {
    const existing = prev.find(item => item.cartKey === key)
    if (existing) {
      return prev.map(item => item.cartKey === key ? { ...item, quantity: item.quantity + 1 } : item)
    }
    return [...prev, { product, quantity: 1, selectedOptions, unitPrice, cartKey: key }]
  })
}
```

### Pattern 4: `canAddToCart` Derived Boolean

**What:** Computed from current modal selection state; gates the "Add to cart" button.

**When to use:** Derived on every render from `singleSelections`, `halfSelections`, `multiSelections`, `groups`.

**Example:**
```typescript
const canAddToCart = groups.every(group => {
  if (!group.required) return true
  if (group.type === 'single') return !!singleSelections[group.id]
  if (group.type === 'half_and_half') {
    const half = halfSelections[group.id]
    return !!half?.half1 && !!half?.half2
  }
  if (group.type === 'multiple') {
    const sel = multiSelections[group.id] ?? []
    return sel.length >= group.min_selections
  }
  return true
})
```

### Pattern 5: Unit Price Computation

**What:** Computed from base product price plus option modifiers.

**When to use:** Reactively inside `ProductModal`; passed to `addToCart` when user confirms.

**Example:**
```typescript
const computedUnitPrice = (() => {
  let price = product.price
  for (const group of groups) {
    if (group.type === 'single') {
      const optId = singleSelections[group.id]
      if (optId) {
        const opt = group.options.find(o => o.id === optId)
        if (opt) {
          if (opt.base_price !== null) price = opt.base_price
          else price += opt.price_modifier
        }
      }
    } else if (group.type === 'half_and_half') {
      const half = halfSelections[group.id]
      if (half?.half1 && half?.half2) {
        const opt1 = group.options.find(o => o.id === half.half1)
        const opt2 = group.options.find(o => o.id === half.half2)
        // D-10: max of the two half base_prices
        price = Math.max(opt1?.base_price ?? 0, opt2?.base_price ?? 0)
      }
    } else if (group.type === 'multiple') {
      const sel = multiSelections[group.id] ?? []
      for (const optId of sel) {
        const opt = group.options.find(o => o.id === optId)
        if (opt) price += opt.price_modifier
      }
    }
  }
  return price
})()
```

### Pattern 6: selectedOptions Shape for DB Compatibility

**What:** `selectedOptions` must be a `Record<string, unknown>` that maps to the `selected_options JSONB` column in `order_items`. The shape should be human-readable for CartModal display and machine-readable for Phase 7 DB insertion.

**Recommended shape:**
```typescript
// Build selectedOptions when user clicks "Add to cart"
const selectedOptions: Record<string, unknown> = {}
for (const group of groups) {
  if (group.type === 'single') {
    const optId = singleSelections[group.id]
    if (optId) {
      const opt = group.options.find(o => o.id === optId)
      if (opt) selectedOptions[group.name] = opt.name
    }
  } else if (group.type === 'half_and_half') {
    const half = halfSelections[group.id]
    if (half?.half1 && half?.half2) {
      const opt1 = group.options.find(o => o.id === half.half1)
      const opt2 = group.options.find(o => o.id === half.half2)
      if (opt1 && opt2) selectedOptions[group.name] = `${opt1.name} / ${opt2.name}`
    }
  } else if (group.type === 'multiple') {
    const sel = multiSelections[group.id] ?? []
    if (sel.length > 0) {
      selectedOptions[group.name] = sel
        .map(id => group.options.find(o => o.id === id)?.name)
        .filter(Boolean)
        .join(', ')
    }
  }
}
```

This gives CartModal display like `"Size: Large, Toppings: Cheese, Pepperoni"` from `Object.entries(selectedOptions)`.

### Anti-Patterns to Avoid

- **Keying cart by `product.id` alone:** Same product with different options will merge instead of creating separate cart entries. Causes `addToCart` to only increment quantity on the first variant added.
- **Passing raw `group.options` without `is_available` filter to the client:** Unavailable options should be stripped server-side, not conditionally hidden client-side.
- **Using `disabled` attribute on checkboxes when max is reached (D-12 / UI-SPEC):** Native `disabled` breaks keyboard group navigation. Use `opacity-40 pointer-events-none` on the label wrapper and `aria-disabled="true"` instead.
- **Computing `selectedOptions` shape inside `addToCart`:** The shape computation belongs in `ProductModal` where group/option data is in scope. Pass the already-built object to `addToCart`.
- **Mutating `ProductModal` props interface without updating the call site:** `ProductModal` currently receives no `optionGroups` prop. The call site in `MenuPage` renders `selectedProduct && <ProductModal ... />` — this must pass `optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []}`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Price formatting | Custom price formatter | `formatPrice(price, currency)` from `@/lib/utils` | Already handles currency symbols, locales, decimal formatting |
| Type definitions for option groups | Re-declare `ProductOptionGroup`, `ProductOption` | Import from `@/types/database` | Already defined and used in admin pages |
| `GroupWithOptions` interface | Re-declare in `MenuPage.tsx` | Import `GroupWithOptions` from `src/app/(admin)/menu/products/[id]/page.tsx` | Exported from there per Phase 5 decision |
| Supabase client for server component | New client setup | `createServiceClient()` — already used in this exact file | Consistent with existing public page pattern |

---

## Common Pitfalls

### Pitfall 1: Cart Key Not Updated in `removeFromCart` and `updateCartQuantity`

**What goes wrong:** `removeFromCart` and `updateCartQuantity` currently use `productId: string` as the identifier. If they still use `item.product.id` equality, two cart entries for the same product with different options will both be affected by remove/update operations.

**Why it happens:** The existing functions were written when one product = one cart entry was a valid assumption.

**How to avoid:** Change parameter type from `productId: string` to `cartKey: string` (or add `cartKey` parameter). Update all call sites in `CartModal`'s `onRemove` and `onUpdateQuantity` callbacks. The `CartModal` receives `item.cartKey` from the parent — use that as the identifier.

**Warning signs:** Two cart entries for the same product; removing one removes both; quantity update affects wrong entry.

### Pitfall 2: `ProductModal` State Not Resetting Between Products

**What goes wrong:** User opens Product A, selects options, closes without adding to cart. Opens Product B. The option state from Product A is still active.

**Why it happens:** `ProductModal` is a function component that persists state between renders when `selectedProduct` changes without unmounting.

**How to avoid:** Add `useEffect(() => { setSingleSelections({}); setHalfSelections({}); setMultiSelections({}) }, [product.id])` inside `ProductModal`. The `imageIndex` reset already uses this exact pattern (`useEffect(() => setImageIndex(0), [product.id])`).

**Warning signs:** Options from a previous product appear pre-selected when opening a different product.

### Pitfall 3: `is_available` Filter Not Applied to Options

**What goes wrong:** Unavailable options appear in the selector. Customer selects an unavailable option, adds to cart.

**Why it happens:** If the server-side query returns all options without filtering, the client renders them all.

**How to avoid:** Filter client-side `options` on the embedded query: `.select('*, options:product_options(*)')` — then filter in the grouping step: `options: group.options.filter(o => o.is_available)`. Alternatively, use `.select('*, options:product_options!inner(*)')` with `.eq('options.is_available', true)` — but the inner join approach would exclude groups that have no available options entirely, which may be correct.

**Warning signs:** Option appears in the public menu that the admin has marked unavailable.

### Pitfall 4: `optionGroups` Fetch Runs Even When `directOrdersEnabled === false`

**What goes wrong:** Unnecessary DB query on every public menu load when the tenant hasn't enabled direct orders.

**Why it happens:** The fetch runs unconditionally in the server component.

**How to avoid:** Gate the option groups query behind a check: `const directOrdersEnabled = tenant.tenant_settings?.direct_orders_enabled ?? false`. Only run the option groups query when `directOrdersEnabled` is true. This saves a DB round-trip for the majority of tenants who don't use the feature.

```typescript
const optionGroupsByProductId: Record<string, GroupWithOptions[]> = {}
if (directOrdersEnabled && productIds.length > 0) {
  // run query + grouping
}
```

**Warning signs:** Slow public menu load for tenants without direct orders enabled.

### Pitfall 5: Half-and-Half Price Computation Uses `price_modifier` Instead of `base_price`

**What goes wrong:** `computedUnitPrice` for half-and-half groups uses `opt.price_modifier` (additive delta) instead of `opt.base_price` (absolute price). Half-and-half flavors are pizza sizes — they use `base_price`, not `price_modifier`.

**Why it happens:** `price_modifier` is non-nullable (always present), while `base_price` is nullable. Developers default to the always-present field.

**How to avoid:** For `half_and_half` groups, always read `opt.base_price` for the max computation per D-10. The formula is `Math.max(opt1.base_price ?? 0, opt2.base_price ?? 0)` — not `product.price + modifier`.

**Warning signs:** Half-and-half price shows `0` or adds only small delta instead of showing the full size price.

### Pitfall 6: `CartModal` `total` Local Variable Uses Old Formula

**What goes wrong:** `CartModal` declares `const total = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)` at line 850. This is a **local computed variable inside CartModal** — separate from the `cartTotal` in `MenuPage`. Both must be updated.

**Why it happens:** Two places compute the total — the floating cart button uses `cartTotal` (in `MenuPage` state), and `CartModal` recomputes with its own `total` variable. Only updating `cartTotal` leaves `CartModal` showing wrong totals.

**How to avoid:** Update the `CartModal` local `total` to `cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)`. Also update the per-item subtotal display at line 885: `item.product.price * item.quantity` → `item.unitPrice * item.quantity`.

**Warning signs:** Cart bubble total matches but CartModal total shows different (lower) amount when options add cost.

### Pitfall 7: `selectedOptions` Key Ordering in Composite Cart Key

**What goes wrong:** Two cart items for the same product with the same options are treated as different entries because `JSON.stringify({ A: 1, B: 2 })` vs `JSON.stringify({ B: 2, A: 1 })` produce different strings.

**Why it happens:** JavaScript object key insertion order is not guaranteed to be consistent.

**How to avoid:** Sort entries before stringifying: `JSON.stringify(Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b))))`.

**Warning signs:** Adding the same product with the same options twice creates two cart entries instead of incrementing quantity.

---

## Code Examples

Verified patterns from codebase analysis:

### Existing `ProductModal` Call Site (MenuPage.tsx line 554–565)
```typescript
{selectedProduct && (
  <ProductModal
    product={selectedProduct}
    accentColor={accentColor}
    currency={currency}
    whatsapp={whatsapp}
    lang={selectedLanguage}
    onClose={() => setSelectedProduct(null)}
    onWhatsApp={() => openWhatsApp(selectedProduct)}
    onAddToCart={directOrdersEnabled ? () => { addToCart(selectedProduct); setSelectedProduct(null) } : undefined}
  />
)}
```

This call site needs:
1. New `optionGroups` prop: `optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []}`
2. `onAddToCart` callback changed to: receive `selectedOptions` and `unitPrice` from `ProductModal`'s internal state

### CartModal Item Key (currently line 864)
```typescript
// CURRENT — uses product.id:
<div key={item.product.id} className="flex items-center gap-3 ...">

// UPDATED — uses composite cartKey:
<div key={item.cartKey} className="flex items-center gap-3 ...">
```

### UI_COPY Extension (MenuPage.tsx lines 33–40)

Add new keys to all 6 languages. Current shape:
```typescript
const UI_COPY: Record<string, { search: string; all: string; featured: string; noItems: string; tryAnother: string; other: string; createAccount: string; hoursBtn: string; hoursTitle: string }> = {
```

New keys to add (6 languages each):
- `required` — "Required" badge
- `chooseUpTo` — "Choose up to {max}" (use template or function)
- `chooseAtLeast` — "Choose at least {min}"
- `chooseBetween` — "Choose {min}–{max}"
- `firstHalf` — "{groupName} — 1st half" (template)
- `secondHalf` — "{groupName} — 2nd half"
- `halfPrice` — "Price: {price}"
- `basePrice` — "Base: {price}"

### Supabase Nested Select Pattern (from admin page.tsx line 34–38)
```typescript
// Admin page uses this pattern for option groups — replicate in public page:
supabase
  .from('product_option_groups')
  .select('*, options:product_options(*)')
  .eq('product_id', id)
  .order('position')
  .order('position', { referencedTable: 'product_options' })
```

The public page needs `.in('product_id', productIds)` instead of `.eq('product_id', id)`.

### GroupWithOptions Import

`GroupWithOptions` is exported from the admin page — import directly:
```typescript
// In page.tsx (public):
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `CartItem = { product, quantity }` | `CartItem = { product, quantity, selectedOptions, unitPrice, cartKey }` | Phase 6 | All cart operations must use `cartKey` for lookup; `submitOrder` in Phase 7 must pass `selectedOptions` to API |
| `addToCart(product: Product)` | `addToCart(product, selectedOptions, unitPrice)` | Phase 6 | Call site in `ProductModal` must build `selectedOptions` and compute `unitPrice` before calling |
| `cartTotal = item.product.price * item.quantity` | `cartTotal = item.unitPrice * item.quantity` | Phase 6 | Two places: `cartTotal` in MenuPage + `total` inside CartModal |

---

## Open Questions

1. **What happens when `directOrdersEnabled` is false and the product has option groups?**
   - What we know: UI-SPEC and D-07 say no option selectors render when `directOrdersEnabled === false`; ProductModal shows info only.
   - What's clear: No ambiguity — the `onAddToCart` prop being `undefined` already handles this (button not rendered). The option selector section itself must also be gated behind `directOrdersEnabled`.
   - Recommendation: Confirm in the plan that both the option section AND the "Add to cart" button are gated behind `directOrdersEnabled`.

2. **`submitOrder` in CartModal currently sends `unit_price: item.product.price` (line 179)**
   - What we know: Phase 7 owns `submitOrder` but the function is already in `MenuPage.tsx`. The `CartItem` change to add `unitPrice` makes the correct value available.
   - What's unclear: Should Phase 6 update `submitOrder` to use `item.unitPrice`, or leave that to Phase 7?
   - Recommendation: Update `unit_price: item.unitPrice` in `submitOrder` within Phase 6 since `CartItem` is being extended here. This prevents Phase 7 from having to navigate a partially-updated interface. Include as a task step.

3. **`options:product_options(*)` vs `options:product_options(id, name, base_price, price_modifier, is_available, position)`**
   - What we know: The admin query uses `*` for product options. The public menu only needs a subset of fields.
   - What's unclear: Whether selecting `*` causes any performance concern at ISR cadence.
   - Recommendation: Use `*` for simplicity, matching the admin page pattern. The ISR cache at `revalidate = 60` means this query runs at most once per minute regardless of traffic.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — all required infrastructure is already in place: Supabase tables created in Phase 4, RLS policies active, `createServiceClient` in server component already working, Tailwind v4 configured).

---

## Validation Architecture

Step 2.6: SKIPPED — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

---

## Sources

### Primary (HIGH confidence)
- `src/components/menu/MenuPage.tsx` — direct inspection of all existing cart logic, `CartItem` interface, `ProductModal`, `CartModal`, `addToCart`, `removeFromCart`, `updateCartQuantity`, `cartTotal`
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — direct inspection of server component fetch pattern, `Promise.all` structure, `revalidate`, `createServiceClient`
- `src/app/(admin)/menu/products/[id]/page.tsx` — `GroupWithOptions` interface definition and export, exact Supabase query pattern for option groups
- `src/types/database.ts` — `ProductOptionGroup`, `ProductOption`, `OptionGroupType`, `PriceRule`, `OrderItem.selected_options` type definitions
- `supabase/migrations/021_orders_v11_schema.sql` — schema definition for `product_option_groups`, `product_options`, RLS policies confirming `options_public_read` exists
- `.planning/phases/06-public-menu-option-selectors-cart/06-CONTEXT.md` — all locked decisions D-01 through D-16
- `.planning/phases/06-public-menu-option-selectors-cart/06-UI-SPEC.md` — full visual and interaction contract

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — ORD-08 through ORD-16 acceptance criteria
- `.planning/STATE.md` — accumulated decisions from prior phases

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire stack is verified by reading existing code
- Architecture patterns: HIGH — patterns derived from actual codebase, not inference
- Pitfalls: HIGH — pitfalls identified from direct code inspection (e.g., duplicate `total` computation in `CartModal`, existing `product.id` keying)

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (stable codebase, 30-day horizon)
