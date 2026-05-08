# Phase 25: Customer + Kitchen — Research

**Researched:** 2026-05-08
**Domain:** React state management, Next.js server components, Supabase JSONB, ingredient customization UI
**Confidence:** HIGH — all findings sourced from direct codebase inspection

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGR-07 | ProductModal customization panel — chips with stepper −/0/+ for default ingredients, "Adicionar ingrediente" button for non-default; gated on flag + product has product_ingredients | MenuPage.tsx inspection: ProductModal receives props from parent; server pages must pass `productIngredientsByProductId` analogous to `optionGroupsByProductId` |
| INGR-08 | Live price recompute; removal free; "+R$X,XX" badge only when unit_price > 0 | `computedUnitPrice` IIFE inside ProductModal (lines 799–828) — ingredient delta adds on top of options price |
| INGR-09 | `ingredient_modifications` JSONB written to `order_items`; null when no modifications | `submitOrder` maps items to API body (lines 195–204); API route inserts `orderItems` array (lines 84–92); both need extending |
| INGR-10 | KDS card + admin orders modal render ingredient_modifications with color-coded prefixes | `OrderCard` items loop (lines 79–90); admin modal items loop (lines 318–339); both need new rendering block after `item.notes` |
</phase_requirements>

---

## Summary

Phase 25 wires ingredient customization from customer-facing modal through cart, API, and database into the KDS and admin orders display. All schema and TypeScript types are already in place from Phase 23; Phase 24 established that admins can assign ingredients to products. This phase adds: (1) a new prop pathway so `product_ingredients` data reaches `ProductModal`, (2) UI state and rendering inside `ProductModal` for the ingredient stepper and addable list, (3) cart and API changes to persist `ingredient_modifications`, and (4) rendering in `OrderCard` and the admin orders detail modal.

The most important architectural discovery: the two public menu server pages (`/[slug]/page.tsx` and `/[slug]/[menuSlug]/page.tsx`) follow **different patterns**. The slug-only page (`[slug]/page.tsx`) passes NO option groups to `MenuPage` and does not even import `GroupWithOptions`. The `[slug]/[menuSlug]/page.tsx` page is the one that fetches option groups and passes `optionGroupsByProductId`. Phase 25 must extend the `[menuSlug]` page to also fetch `product_ingredients`, and must handle the slug-only page analogously (or accept that customization is only available on the per-menu URL, which matches how `optionGroupsByProductId` already works).

`addToCart` currently takes 4 args: `(product, selectedOptions, unitPrice, note?)`. `ProductModal.onAddToCart` currently has signature `(selectedOptions, unitPrice, note?)`. Both need a 5th/4th arg `ingredientModifications?`. `buildCartKey` must NOT change — same product+options = same slot regardless of modifications.

**Primary recommendation:** Add `productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]>` prop to `MenuPage` and `ingredientCustomizationEnabled: boolean` prop; extend both server pages to fetch and pass these; extend `ProductModal` props; add stepper state, price delta, and "Adicionar ingrediente" sheet; extend cart/API/KDS rendering.

---

## Data Flow: Product Ingredients to ProductModal

### Current flow (option groups)

```
[slug]/[menuSlug]/page.tsx
  → fetches product_option_groups + product_options (when directOrdersEnabled)
  → builds optionGroupsByProductId: Record<string, GroupWithOptions[]>
  → passes as prop to MenuPage

MenuPage (client component)
  → Props: optionGroupsByProductId?: Record<string, GroupWithOptions[]>
  → on product click: setSelectedProduct(product)
  → renders <ProductModal optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []} ...>

ProductModal (inline function in MenuPage.tsx)
  → receives optionGroups: GroupWithOptions[]
  → renders option group UI
```

### Required flow for Phase 25

```
[slug]/[menuSlug]/page.tsx (and [slug]/page.tsx for parity)
  → fetches product_ingredients + ingredients (when ingredientCustomizationEnabled)
  → builds productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]>
  → passes to MenuPage

MenuPage
  → NEW Props: ingredientCustomizationEnabled?: boolean
               productIngredientsByProductId?: Record<string, ProductIngredientWithIngredient[]>
  → passes both to ProductModal for selectedProduct

ProductModal
  → NEW Props: ingredientCustomizationEnabled?: boolean
               productIngredients?: ProductIngredientWithIngredient[]
  → renders customization panel when flag on AND productIngredients?.length > 0
```

### Server query to add

```typescript
// In [slug]/[menuSlug]/page.tsx, add inside the conditional block:
const ingredientCustomizationEnabled =
  tenant.tenant_settings?.ingredient_customization_enabled ?? false

const productIngredientsByProductId: Record<string, ProductIngredientWithIngredient[]> = {}
if (ingredientCustomizationEnabled && productIds.length > 0) {
  const { data: rawPIs } = await supabase
    .from('product_ingredients')
    .select('*, ingredient:ingredients(*)')
    .in('product_id', productIds)
    .order('position')

  for (const pi of rawPIs ?? []) {
    if (!productIngredientsByProductId[pi.product_id]) {
      productIngredientsByProductId[pi.product_id] = []
    }
    productIngredientsByProductId[pi.product_id].push(pi as ProductIngredientWithIngredient)
  }
}
```

Note: The RLS policy on `product_ingredients` uses `USING(true)` (public read) per Phase 23 decisions — no auth needed for this query from the public page.

---

## Architecture Patterns

### Pattern 1: ProductModal Extension (inline function in MenuPage.tsx)

`ProductModal` is defined as an **inline function** inside `MenuPage.tsx` (not a separate file). It is not exported. All additions happen in that same file.

**New state to add inside ProductModal:**
```typescript
// Maps ingredient_id → stepper value: -1 = removed, 0 = default (no change), +1 = extra
const [ingredientSteppers, setIngredientSteppers] = useState<Record<string, number>>({})
// ingredient_ids of non-default ingredients the customer chose to add
const [addedIngredients, setAddedIngredients] = useState<string[]>([])
// controls visibility of "Adicionar ingrediente" picker sheet
const [showAddIngredient, setShowAddIngredient] = useState(false)
```

**Reset on product change (append to existing useEffect):**
```typescript
useEffect(() => {
  setSingleSelections({})
  setHalfSelections({})
  setMultiSelections({})
  setItemNote('')
  setIngredientSteppers({})   // ADD
  setAddedIngredients([])     // ADD
  setShowAddIngredient(false) // ADD
}, [product.id])
```

### Pattern 2: Price Delta Computation

The existing `computedUnitPrice` IIFE (lines 799–828) computes price from base + option groups. The ingredient delta adds on top:

```typescript
// After computedUnitPrice is established, compute ingredient delta:
const ingredientDelta = (() => {
  let delta = 0
  for (const pi of productIngredients ?? []) {
    const stepperVal = ingredientSteppers[pi.ingredient_id] ?? 0
    if (stepperVal === 1) {
      // Extra: charge extra_price_override ?? ingredient.default_extra_price
      const price = pi.extra_price_override ?? pi.ingredient.default_extra_price
      delta += price
    }
    // stepperVal === -1 (removed): free in v1.7 — no delta
    // stepperVal === 0: no change — no delta
  }
  for (const ingId of addedIngredients) {
    // Find in productIngredients (non-default)
    const pi = (productIngredients ?? []).find(p => p.ingredient_id === ingId)
    if (pi) {
      const price = pi.add_price_override ?? pi.ingredient.default_add_price
      delta += price
    }
  }
  return delta
})()

const finalUnitPrice = computedUnitPrice + ingredientDelta
```

The `finalUnitPrice` replaces `computedUnitPrice` in the displayed price and in the `onAddToCart` call.

### Pattern 3: buildIngredientModifications

Before calling `onAddToCart`, build the modifications object:

```typescript
function buildIngredientModifications(
  productIngredients: ProductIngredientWithIngredient[],
  steppers: Record<string, number>,
  added: string[]
): IngredientModifications | null {
  const removed: IngredientRemoval[] = []
  const extras: IngredientExtra[] = []
  const addedMods: IngredientExtra[] = []

  for (const pi of productIngredients) {
    const val = steppers[pi.ingredient_id] ?? 0
    if (val === -1 && pi.is_default) {
      removed.push({ ingredient_id: pi.ingredient_id, name: pi.ingredient.name })
    } else if (val === 1 && pi.is_default) {
      const unit_price = pi.extra_price_override ?? pi.ingredient.default_extra_price
      extras.push({ ingredient_id: pi.ingredient_id, name: pi.ingredient.name, qty: 1, unit_price })
    }
  }

  for (const ingId of added) {
    const pi = productIngredients.find(p => p.ingredient_id === ingId)
    if (pi) {
      const unit_price = pi.add_price_override ?? pi.ingredient.default_add_price
      addedMods.push({ ingredient_id: ingId, name: pi.ingredient.name, qty: 1, unit_price })
    }
  }

  if (removed.length === 0 && extras.length === 0 && addedMods.length === 0) return null
  return { removed, extras, added: addedMods }
}
```

### Pattern 4: CartItem + addToCart Extension

**CartItem interface** (in MenuPage.tsx, currently at line 62):
```typescript
interface CartItem {
  product: Product
  quantity: number
  selectedOptions: Record<string, unknown>
  unitPrice: number
  cartKey: string
  note?: string
  ingredientModifications?: IngredientModifications | null  // ADD
}
```

**addToCart** (currently at line 144) — add 5th arg:
```typescript
function addToCart(
  product: Product,
  selectedOptions: Record<string, unknown>,
  unitPrice: number,
  note?: string,
  ingredientModifications?: IngredientModifications | null  // ADD
) {
  const key = buildCartKey(product.id, selectedOptions)
  setCart(prev => {
    const existing = prev.find(item => item.cartKey === key)
    if (existing) {
      return prev.map(item =>
        item.cartKey === key
          ? { ...item, quantity: item.quantity + 1, note: note ?? item.note,
              ingredientModifications: ingredientModifications ?? item.ingredientModifications }  // ADD
          : item
      )
    }
    return [...prev, { product, quantity: 1, selectedOptions, unitPrice, cartKey: key, note,
                       ingredientModifications }]  // ADD
  })
}
```

**CRITICAL: buildCartKey does NOT change.** Same product+options = same slot. Modifications replace (merge into) the existing slot.

### Pattern 5: ProductModal onAddToCart call

Currently at line 1172:
```typescript
onAddToCart(opts, computedUnitPrice, itemNote || undefined)
```

Changes to:
```typescript
const mods = buildIngredientModifications(
  productIngredients ?? [],
  ingredientSteppers,
  addedIngredients
)
onAddToCart(opts, finalUnitPrice, itemNote || undefined, mods)
```

And `onAddToCart` prop type changes from:
```typescript
onAddToCart?: (selectedOptions: Record<string, unknown>, unitPrice: number, note?: string) => void
```
to:
```typescript
onAddToCart?: (
  selectedOptions: Record<string, unknown>,
  unitPrice: number,
  note?: string,
  ingredientModifications?: IngredientModifications | null
) => void
```

### Pattern 6: MenuPage call site (line 606)

Currently:
```typescript
onAddToCart={directOrdersEnabled
  ? (selectedOptions, unitPrice, note) => {
      addToCart(selectedProduct, selectedOptions, unitPrice, note)
      setSelectedProduct(null)
    }
  : undefined}
```

Changes to:
```typescript
onAddToCart={directOrdersEnabled
  ? (selectedOptions, unitPrice, note, ingredientModifications) => {
      addToCart(selectedProduct, selectedOptions, unitPrice, note, ingredientModifications)
      setSelectedProduct(null)
    }
  : undefined}
```

### Pattern 7: submitOrder + API Extension

**submitOrder** (line 195) — add `ingredient_modifications` to the items map:
```typescript
items: cart.map(item => ({
  product_id: item.product.id,
  product_name: item.product.name,
  quantity: item.quantity,
  unit_price: item.unitPrice,
  selected_options: item.selectedOptions,
  notes: item.note || undefined,
  ingredient_modifications: item.ingredientModifications || null,  // ADD
})),
```

**API route** (`/api/orders/route.ts`) — extend `OrderItem` interface and `orderItems` map:
```typescript
interface OrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  notes?: string
  selected_options?: Record<string, unknown>
  ingredient_modifications?: IngredientModifications | null  // ADD
}
```

And in the `orderItems` map (line 84):
```typescript
const orderItems = items.map((item) => ({
  order_id: order.id,
  product_id: item.product_id,
  product_name: item.product_name,
  quantity: item.quantity,
  unit_price: item.unit_price,
  notes: sanitizeNote(item.notes),
  selected_options: item.selected_options || null,
  ingredient_modifications: item.ingredient_modifications || null,  // ADD
}))
```

No sanitization needed beyond null-coalescing — JSONB accepts the object as-is; Supabase handles serialization. Do NOT validate the JSONB structure in the API route (keep it simple; TypeScript types ensure correctness at the call site).

### Pattern 8: KDS OrderCard Rendering

Inside `OrderCard` (lines 79–90), add after the `item.notes` block:

```typescript
{item.ingredient_modifications && (() => {
  const mods = item.ingredient_modifications
  const hasAny =
    mods.removed.length > 0 || mods.extras.length > 0 || mods.added.length > 0
  if (!hasAny) return null
  return (
    <span className="flex flex-col gap-0.5 mt-0.5">
      {mods.removed.map(r => (
        <span key={r.ingredient_id} className="text-xs text-red-600 line-through">
          SEM {r.name}
        </span>
      ))}
      {mods.extras.map(e => (
        <span key={e.ingredient_id} className="text-xs text-amber-600">
          +{e.qty} {e.name}
        </span>
      ))}
      {mods.added.map(a => (
        <span key={a.ingredient_id} className="text-xs text-green-600">
          +{a.qty} {a.name}
        </span>
      ))}
    </span>
  )
})()}
```

### Pattern 9: Admin Orders Modal Rendering

Same rendering, added after the `item.notes` block in the detail modal (lines 333–338):

```typescript
{item.ingredient_modifications && (() => {
  const mods = item.ingredient_modifications
  const hasAny =
    mods.removed.length > 0 || mods.extras.length > 0 || mods.added.length > 0
  if (!hasAny) return null
  return (
    <span className="flex flex-col gap-0.5 mt-0.5">
      {mods.removed.map(r => (
        <span key={r.ingredient_id} className="text-xs text-red-600 line-through">
          SEM {r.name}
        </span>
      ))}
      {mods.extras.map(e => (
        <span key={e.ingredient_id} className="text-xs text-amber-600">
          +{e.qty} {e.name}
        </span>
      ))}
      {mods.added.map(a => (
        <span key={a.ingredient_id} className="text-xs text-green-600">
          +{a.qty} {a.name}
        </span>
      ))}
    </span>
  )
})()}
```

---

## Standard Stack

All libraries already in use in this project — no new dependencies.

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| React useState/useEffect | (Next.js 15) | Stepper/addedIngredients state in ProductModal | Existing pattern |
| Tailwind CSS | v3 | Color-coded ingredient badges | Use literal classes only |
| Supabase JS | v2 | product_ingredients query + JSONB insert | Existing client |
| lucide-react | current | Icons — already used in OrdersClient | No new icon needed for ingredient mods |

### Installation

No new packages required.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONB serialization | Custom serializer | Pass the IngredientModifications object directly to Supabase | Supabase client serializes JSONB automatically |
| Deep equality for cart merging | Custom diff | Keep buildCartKey as-is (product+options only) | Modifications replace existing slot; no key change needed |

---

## Common Pitfalls

### Pitfall 1: buildCartKey must NOT include ingredient modifications

**What goes wrong:** If `ingredientModifications` is included in `buildCartKey`, each customization variant creates a separate cart slot — the cart fills with duplicates.

**How to avoid:** `buildCartKey` (line 71) stays exactly as-is: `${productId}::${JSON.stringify(sortedOptions)}`. Modifications are metadata on the slot, not a key dimension. The existing comment on line 149 already documents this for `note`; the same applies to `ingredientModifications`.

### Pitfall 2: JSONB null vs empty object

**What goes wrong:** `ingredient_modifications: {}` or `ingredient_modifications: { removed: [], extras: [], added: [] }` in the DB is truthy in JS — code checking `if (item.ingredient_modifications)` would render an empty section.

**How to avoid:** `buildIngredientModifications` returns `null` when all three arrays are empty (see Pattern 3). The API route passes `item.ingredient_modifications || null`. KDS/modal rendering adds a `hasAny` guard before rendering the span.

### Pitfall 3: `[slug]/page.tsx` does not pass optionGroupsByProductId

**What goes wrong:** Assuming both public page routes are symmetric. They are not — `[slug]/page.tsx` (the default menu route) passes NO `optionGroupsByProductId`, so `ProductModal` already gracefully handles missing data for this route. The same pattern applies to `productIngredientsByProductId`.

**How to avoid:** Add ingredient fetching to BOTH public pages, following the same conditional guard used in `[menuSlug]/page.tsx` for `directOrdersEnabled`/`optionGroups`. The `[slug]/page.tsx` currently passes no `optionGroupsByProductId` at all, so `MenuPage` receives `{}` from the default prop. Extend both pages the same way for ingredients.

### Pitfall 4: Tailwind dynamic class construction

**What goes wrong:** Building class strings dynamically (e.g., `text-${color}-600`) causes Tailwind to miss the class in its content scan — the style doesn't apply in production.

**How to avoid:** Use only literal complete class names: `text-red-600 line-through`, `text-amber-600`, `text-green-600`. These must appear verbatim in the source.

### Pitfall 5: Stepper value semantics for non-default ingredients

**What goes wrong:** Using the stepper state for non-default (addable) ingredients when they should be in a separate list. Default ingredients use `ingredientSteppers[id] = -1/0/1`; non-default available ingredients use `addedIngredients` (a string[] of added ingredient_ids). Conflating these leads to confusing UX and wrong price computation.

**How to avoid:** Only `is_default=true` product_ingredients get a stepper chip. `is_default=false` available ingredients go into the "Adicionar ingrediente" list. The picker adds to `addedIngredients[]`.

### Pitfall 6: Price override fallback chain

**What goes wrong:** Using `pi.extra_price_override` directly without checking for `null` — the override is nullable, meaning "use catalog default."

**How to avoid:** Always use `pi.extra_price_override ?? pi.ingredient.default_extra_price` for extras, and `pi.add_price_override ?? pi.ingredient.default_add_price` for additions. This is the same contract established in Phase 24 (admin tab description: "empty overrides fall back to catalog defaults").

### Pitfall 7: ProductModal prop type mismatch

**What goes wrong:** Adding `ingredientModifications` to `onAddToCart` callback type in `ProductModal` but forgetting to update the call site in `MenuPage` where `onAddToCart` is passed and where `addToCart` is called.

**How to avoid:** The chain has 4 touch points — all must be updated together:
1. `CartItem` interface (add field)
2. `addToCart` function signature (add 5th arg)
3. `MenuPage` `onAddToCart` lambda passed to `ProductModal` (add 4th destructured arg)
4. `ProductModal` `onAddToCart` prop type (add 4th arg)

### Pitfall 8: ingredient_modifications in `IngredientModifications | null` type assertion

**What goes wrong:** The API route's `OrderItem` interface currently types `notes?: string` as optional. When `ingredient_modifications` is added, TypeScript must know its type. Importing `IngredientModifications` from `@/types/database` in the API route file is needed.

**How to avoid:** Add `import type { IngredientModifications } from '@/types/database'` to `/api/orders/route.ts` and type the field as `ingredient_modifications?: IngredientModifications | null`.

---

## Detailed File Change Map

### Files to modify (exhaustive)

| File | What Changes |
|------|-------------|
| `src/app/(public)/[slug]/page.tsx` | Add `ingredientCustomizationEnabled` + `productIngredientsByProductId` fetch; pass both to `MenuPage` |
| `src/app/(public)/[slug]/[menuSlug]/page.tsx` | Same as above (parallel to existing `optionGroupsByProductId` block) |
| `src/components/menu/MenuPage.tsx` | 1. Add `ingredientCustomizationEnabled`, `productIngredientsByProductId` to Props; 2. Pass both to `ProductModal`; 3. Add `ingredientModifications` arg to `addToCart` + `CartItem`; 4. Extend `submitOrder` items map; 5. Extend `ProductModal` props + state + UI + price logic + `onAddToCart` call |
| `src/app/api/orders/route.ts` | Extend `OrderItem` interface + `orderItems` map to pass `ingredient_modifications` |
| `src/app/(admin)/orders/OrdersClient.tsx` | Add ingredient_modifications rendering in `OrderCard` (KDS card) and in `selectedOrder` detail modal |

### Files NOT to modify

- `src/types/database.ts` — all types already present (Phase 23)
- `supabase/migrations/` — all schema already present (Phase 23)
- Admin product pages — out of scope for Phase 25

---

## Recommended Project Structure (no new files)

All Phase 25 changes live in existing files. No new files are needed. The customization panel is inlined into `ProductModal` (which is already a large inline function in `MenuPage.tsx`). If the file grows too large, the planner may optionally split `ProductModal` into a separate file — but this is not required for the phase to work.

---

## UI Specification: Ingredient Customization Panel

Appears below option groups and above item notes. Gated on `ingredientCustomizationEnabled && (productIngredients?.length ?? 0) > 0`.

### Default ingredients (stepper chips)

Each `is_default=true` ingredient renders a chip row:

```
[ Queijo ]  [−] [0] [+]   (+R$2,00)   ← badge only when extra_price > 0
[ Tomate ]  [−] [0] [+]
[ Cebola ]  [−] [0] [+]
```

- Stepper state: −1 (SEM), 0 (padrão), +1 (extra)
- Removal (−1) is always free, no badge
- Extra (+1) shows `+R$X,XX` badge only when `extra_price_override ?? ingredient.default_extra_price > 0`
- Chip button active state: selected button gets `bg-zinc-900 text-white`, others get `bg-zinc-100 text-zinc-600`
- Min touch target: 36px (consistent with existing modal buttons)

### "Adicionar ingrediente" button

Appears after default ingredients when there are `is_default=false` available ingredients for this product.

```
[ + Adicionar ingrediente ]
```

Clicking opens an inline list (not a separate modal — avoid z-index conflicts inside the existing modal) showing the non-default available ingredients. Each row: ingredient name + price badge (if add_price > 0) + "Adicionar" button. Tapping "Adicionar" moves the ingredient into the selected list and removes it from the picker.

### Selected added ingredients

Render below the picker as removable chips:

```
[ Bacon +R$4,00 ✕ ]  [ Ovo frito +R$3,00 ✕ ]
```

---

## Validation Architecture

> `nyquist_validation` is `false` in `.planning/config.json`. This section is SKIPPED.

---

## Environment Availability

> Phase 25 is a code-only change with no new external dependencies. All tooling (Next.js, Supabase, Tailwind) already confirmed operational in prior phases. This section is SKIPPED.

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Fetch option groups only when orders enabled | Fetch option groups in `[menuSlug]/page.tsx` conditional block | Phase 25 mirrors this pattern for ingredients |
| `addToCart` 4-arg signature | Needs 5-arg | Extend, do not replace |

---

## Open Questions

1. **Should `[slug]/page.tsx` (default menu route) also fetch product_ingredients?**
   - What we know: this page currently passes no `optionGroupsByProductId` to `MenuPage` at all (it passes nothing for the `optionGroupsByProductId` prop, so the default `{}` applies)
   - What's unclear: whether the ingredient customization experience is expected on the default menu URL or only on the per-menu URL
   - Recommendation: Add ingredient fetching to BOTH pages for consistency. The default menu page already shows a "no direct orders" experience, but if `ingredient_customization_enabled` is true, the user should still see the customization panel. However, since `onAddToCart` is only passed when `directOrdersEnabled`, the panel may be informational only on the default route. Safest: fetch on both pages; let `onAddToCart` control whether adding to cart is possible.

2. **"Adicionar ingrediente" picker: inline vs separate modal?**
   - What we know: the phase is inside a fixed-overlay modal; the existing modal has `overflow-hidden` and a constrained height
   - Recommendation: Inline expandable section below the stepper chips (not a new modal). Use a `showAddIngredient` boolean to toggle a scrollable ingredient list within the existing modal scroll area. This avoids z-index stacking and is simpler.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/components/menu/MenuPage.tsx` (lines 62–1187)
- Direct code inspection of `src/app/(public)/[slug]/page.tsx`
- Direct code inspection of `src/app/(public)/[slug]/[menuSlug]/page.tsx`
- Direct code inspection of `src/app/api/orders/route.ts`
- Direct code inspection of `src/app/(admin)/orders/OrdersClient.tsx`
- Direct code inspection of `src/types/database.ts`
- Phase 23 SUMMARY (`23-01-SUMMARY.md`) — confirmed all types present
- Phase 24 SUMMARY (`24-02-SUMMARY.md`) — confirmed price override contract

### Secondary (MEDIUM confidence)
- `IngredientModifications` JSONB structure defined in `REQUIREMENTS.md` (`{removed, extras, added}`)

---

## Metadata

**Confidence breakdown:**
- Data flow / file change map: HIGH — sourced from direct code inspection
- UI stepper pattern: HIGH — consistent with existing option group chip patterns in codebase
- Price computation logic: HIGH — mirrors existing `computedUnitPrice` IIFE
- API extension: HIGH — route code read directly
- KDS/admin rendering: HIGH — both rendering loops read directly

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable codebase)
