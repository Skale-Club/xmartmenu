# Phase 24: Admin Catalog - Research

**Researched:** 2026-05-08
**Domain:** Next.js App Router admin UI, Supabase client CRUD, drag-to-reorder, feature-flag gating
**Confidence:** HIGH — all findings derived from direct source-code inspection of the existing codebase

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGR-05 | `/admin/menu/ingredients` page — CRUD (create/edit/delete), drag-to-reorder, gated by `ingredient_customization_enabled` | Admin page pattern confirmed; reorder pattern confirmed (up/down arrows); flag-gating pattern confirmed via sidebar + page redirect |
| INGR-06 | "Ingredientes" tab in product editor — multi-select picker, `is_default` toggle, per-product price overrides | `ProductDetailClient.tsx` tab pattern confirmed; Supabase joined query pattern confirmed |
</phase_requirements>

---

## Summary

Phase 24 builds two UI surfaces: a standalone ingredients catalog page at `/admin/menu/ingredients`, and a new "Ingredientes" tab added to the existing product editor at `/admin/menu/products/[id]`. Both surfaces are gated by `ingredient_customization_enabled` on `tenant_settings`.

The codebase has a single, consistent admin UI pattern: a Next.js Server Component page fetches data from Supabase and passes it as props to a `*Client.tsx` component. CRUD mutations go directly through the Supabase browser client — no API routes are needed for ingredients or product-ingredient associations. The product editor at `ProductDetailClient.tsx` currently has no tab switcher; it uses two distinct card sections. The "Ingredientes" tab will need a tab-bar UI added to the component, or a separate card section following the "Option Groups" card pattern.

Drag-to-reorder is already implemented throughout the project using **up/down arrow buttons** (ChevronUp/ChevronDown from lucide-react), not a drag library. There is no `@dnd-kit` or any drag library installed. The reorder strategy swaps `position` values between two adjacent records with two parallel Supabase `update` calls and optimistic local state, with silent rollback on error. This pattern must be replicated for ingredients; it does NOT need to be applied to `product_ingredients` (explicitly out of scope per REQUIREMENTS.md).

**Primary recommendation:** Follow ProductDetailClient/ProductsClient patterns exactly. No new libraries needed. Use up/down arrows for ingredient catalog reorder. Add `ingredient_customization_enabled` to the product detail page's server-side query; pass as prop to the client; conditionally render the "Ingredientes" tab section.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.101.1 | DB queries from client components | Already the project's data layer |
| `@supabase/ssr` | ^0.10.0 | Server-side Supabase for page.tsx | Used in every admin page |
| `lucide-react` | ^1.7.0 | Icons (ChevronUp, ChevronDown, Pencil, Trash2, Plus) | Already used in ProductDetailClient |
| `next` | 16.2.2 | App Router pages + `force-dynamic` | Project framework |
| `tailwindcss` | ^4 | Styling | Project CSS framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `framer-motion` | ^12.38.0 | Animations | NOT needed here — existing UI uses no animation on admin CRUD |
| `clsx` / `cn` | via tailwind-merge | Conditional class merging | Use `cn()` from `@/lib/utils` for conditional Tailwind classes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Up/down arrow reorder | @dnd-kit/core | @dnd-kit is NOT installed; adding it for a simple ordered list is overengineering; up/down buttons are consistent with existing ProductDetailClient pattern |
| Supabase client direct | API routes | Categories uses API routes (PATCH /api/admin/categories), Products uses Supabase direct. For ingredients, follow the Products/StoreClient pattern — Supabase direct |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(admin)/menu/
│   ├── ingredients/
│   │   ├── page.tsx              # Server Component — fetches ingredients + tenant flag
│   │   └── IngredientsClient.tsx # Client Component — CRUD list + reorder
│   └── products/[id]/
│       ├── page.tsx              # MODIFIED — add ingredient_customization_enabled + ingredients to fetch
│       ├── ProductDetailClient.tsx  # MODIFIED — add "Ingredientes" tab/section
│       └── IngredientsTab.tsx    # New sub-component — ingredient multi-select + overrides
├── components/admin/
│   └── AdminSidebar.tsx          # MODIFIED — add "Ingredientes" menu item gated by flag
```

### Pattern 1: Server Component Page + Client Component

Every admin page follows this split:

```typescript
// page.tsx — Server Component
export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { notFound, redirect } from 'next/navigation'
import IngredientsClient from './IngredientsClient'

export default async function IngredientsPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  if (!effective) notFound()

  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'

  // Gate: redirect or 404 when flag is disabled
  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('ingredient_customization_enabled, currency')
    .eq('tenant_id', tenantId)
    .single()

  if (!settings?.ingredient_customization_enabled) redirect('/admin/dashboard')

  const { data: ingredients } = await supabase
    .from('ingredients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position')

  return (
    <IngredientsClient
      ingredients={ingredients ?? []}
      tenantId={tenantId}
      currency={settings?.currency ?? 'BRL'}
      canManage={canManage}
    />
  )
}
```

### Pattern 2: Supabase Direct Client CRUD (no API routes)

```typescript
// IngredientsClient.tsx — Client Component
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Ingredient } from '@/types/database'

export default function IngredientsClient({ ingredients: initial, tenantId, currency, canManage }) {
  const [ingredients, setIngredients] = useState(initial)
  const supabase = createClient()

  async function handleCreate(formData) {
    const { data, error } = await supabase
      .from('ingredients')
      .insert({ tenant_id: tenantId, ...formData, position: ingredients.length })
      .select()
      .single()
    if (!error && data) setIngredients(prev => [...prev, data])
  }

  async function handleUpdate(id: string, formData) {
    const { data, error } = await supabase
      .from('ingredients')
      .update(formData)
      .eq('id', id)
      .select()
      .single()
    if (!error && data) setIngredients(prev => prev.map(i => i.id === id ? data : i))
  }

  async function handleDelete(id: string) {
    await supabase.from('ingredients').delete().eq('id', id)
    setIngredients(prev => prev.filter(i => i.id !== id))
  }
  // ...
}
```

### Pattern 3: Reorder (Up/Down Arrows, Optimistic)

Copied directly from `ProductDetailClient.tsx` `moveGroup` pattern:

```typescript
async function moveIngredient(ingredientId: string, direction: 'up' | 'down') {
  const idx = ingredients.findIndex(i => i.id === ingredientId)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= ingredients.length) return

  const current = ingredients[idx]
  const swap = ingredients[swapIdx]
  const prevIngredients = ingredients

  // Optimistic update
  const reordered = ingredients
    .map(i => {
      if (i.id === current.id) return { ...i, position: swap.position }
      if (i.id === swap.id) return { ...i, position: current.position }
      return i
    })
    .sort((a, b) => a.position - b.position)
  setIngredients(reordered)
  setReorderInFlight(true)

  try {
    await Promise.all([
      supabase.from('ingredients').update({ position: swap.position }).eq('id', current.id),
      supabase.from('ingredients').update({ position: current.position }).eq('id', swap.id),
    ])
  } catch {
    setIngredients(prevIngredients) // silent rollback
  } finally {
    setReorderInFlight(false)
  }
}
```

### Pattern 4: Sidebar Feature-Flag Gating

The current `AdminSidebar.tsx` does NOT receive `tenantSettings` as a prop — it receives `role`, `menus`, `tenantName`, `tenantSlug`. Item visibility is currently gated only by `role` (staff vs admin), using static arrays filtered by role.

To gate "Ingredientes" by `ingredient_customization_enabled`, two options:

**Option A (recommended) — Pass flag as prop to AdminSidebar:**
- Admin layout (`layout.tsx`) already fetches tenant data; add `tenant_settings` query there
- Pass `ingredientCustomizationEnabled: boolean` prop to `AdminSidebar`
- Filter `mainItems` similarly to how `isStaff` filters items

**Option B — Simpler, no sidebar change:**
- Add "Ingredientes" to `mainItems` always visible
- The page itself redirects when flag is off (still satisfies success criterion 1)
- Sidebar item remains but navigating to the page 404s/redirects

Option A is cleaner UX (item is truly hidden). Option B is simpler to implement. Given that the requirement says "hidden when flag is false", Option A is correct.

```typescript
// AdminSidebar.tsx — modified signature
export default function AdminSidebar({
  tenantName,
  tenantSlug,
  role,
  appName,
  menus,
  activeMenuId,
  ingredientCustomizationEnabled = false,  // NEW
}: { ... ingredientCustomizationEnabled?: boolean }) {

  const ingredientItem = { href: '/menu/ingredients', label: 'Ingredientes', icon: '🥗' }

  const visibleMainItems = [
    ...baseMainItems,
    ...(ingredientCustomizationEnabled ? [ingredientItem] : []),
  ].filter(item => isStaff ? item.href !== '/menus' : true)
```

The layout `layout.tsx` must be updated to fetch `ingredient_customization_enabled` from `tenant_settings` and pass it down.

### Pattern 5: "Ingredientes" Tab in Product Editor

`ProductDetailClient.tsx` currently has NO tab system — it uses two full-width card sections stacked vertically:
1. Product fields card (`<form>` in a white rounded-xl)
2. Option Groups card (separate white rounded-xl)

The "Ingredientes" section should follow the same card-section approach — add a third white rounded-xl card below Option Groups, conditionally rendered when `ingredientCustomizationEnabled` prop is true.

**Alternative:** Convert to a tab bar. This is more effort (adds tab state management, changes visual structure) and is inconsistent with current design. Stick with the card-section approach unless the roadmap hint requires tabs.

The product editor `page.tsx` currently selects only `custom_tags, currency` from `tenant_settings`. It must be extended to also select `ingredient_customization_enabled`.

```typescript
// page.tsx — extended query
const [{ data: product }, { data: groups }, { data: settings }, { data: ingredients }, { data: productIngredients }] = await Promise.all([
  supabase.from('products').select('*, category:categories(id, name)').eq('id', id).eq('tenant_id', tenantId).single(),
  supabase.from('product_option_groups').select('*, options:product_options(*)').eq('product_id', id).order('position').order('position', { referencedTable: 'product_options' }),
  supabase.from('tenant_settings').select('custom_tags, currency, ingredient_customization_enabled').eq('tenant_id', tenantId).single(),
  // Only fetch if flag is on — conditional but safe to always fetch (RLS will limit to tenant)
  supabase.from('ingredients').select('*').eq('tenant_id', tenantId).order('position'),
  supabase.from('product_ingredients').select('*').eq('product_id', id).eq('tenant_id', tenantId),
])
```

### Pattern 6: product_ingredients CRUD

Saving ingredient associations on the product is an upsert pattern (insert or update on conflict):

```typescript
// Associate ingredient with product (insert)
await supabase.from('product_ingredients').insert({
  product_id: productId,
  ingredient_id: ingredientId,
  tenant_id: tenantId,
  is_default: false,
  extra_price_override: null,
  add_price_override: null,
  position: currentAssociations.length,
})

// Remove association (delete)
await supabase.from('product_ingredients').delete()
  .eq('product_id', productId)
  .eq('ingredient_id', ingredientId)

// Update override / is_default
await supabase.from('product_ingredients').update({
  is_default: newValue,
  extra_price_override: override ?? null,
  add_price_override: addOverride ?? null,
}).eq('product_id', productId).eq('ingredient_id', ingredientId)
```

The join table has PRIMARY KEY `(product_id, ingredient_id)`, so upsert with `onConflict: 'product_id,ingredient_id'` also works.

### Anti-Patterns to Avoid

- **Dynamic Tailwind class interpolation:** Never build class names from string concatenation (e.g., `'bg-' + color`). Tailwind v4 uses a content scanner — dynamically constructed strings are not statically detectable. Use full class names in conditionals: `condition ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'`.
- **Creating API routes for simple CRUD:** Categories uses API routes but Products and StoreClient use Supabase direct. Ingredients should use Supabase direct (consistent with the simpler pattern).
- **Fetching all ingredients on every render without memoization:** The multi-select picker in the product editor needs both the full ingredient catalog and the current product's associations. Fetch both in the server `page.tsx` and pass as props — avoid client-side fetching on mount for initial state.
- **Forgetting `position` on insert:** All ordered entities assign `position: items.length` on insert. Missing this causes items to appear at position 0 and break ordering.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-to-reorder | Custom DnD event handlers | Up/down arrow buttons (existing project pattern) | @dnd-kit not installed; arrows are already in ProductDetailClient; consistent UX |
| Optimistic reorder | Custom queue/mutex | `setReorderInFlight` boolean guard + silent rollback (existing pattern) | Proven pattern in the codebase |
| Feature flag check | Middleware / client guard | Server Component redirect in `page.tsx` | Simplest, securest — rendering never reaches client if flag is off |
| Confirm dialogs | Custom modal | `ConfirmDialog` from `@/components/ui/ConfirmDialog` | Already used in ProductsClient and ProductDetailClient |
| Price input with currency prefix | Custom component | Inline flex `<span>R$</span><input>` pattern (existing in forms) | Consistent with all existing price fields |

**Key insight:** The project deliberately avoids abstraction — each page is self-contained. Don't extract shared hooks unless they already exist.

---

## Common Pitfalls

### Pitfall 1: Sidebar doesn't receive tenant settings
**What goes wrong:** "Ingredientes" item appears (or doesn't appear) regardless of flag because `AdminSidebar` has no access to `ingredient_customization_enabled`.
**Why it happens:** The admin layout passes minimal props to the sidebar; tenant settings are not currently fetched there.
**How to avoid:** Add `ingredient_customization_enabled` to the `tenant_settings` query in `layout.tsx`; pass as `ingredientCustomizationEnabled` prop to `AdminSidebar`.
**Warning signs:** Sidebar item visible for all tenants, or never visible.

### Pitfall 2: Product editor page.tsx doesn't pass the flag down
**What goes wrong:** "Ingredientes" section never renders in the product editor even when flag is on.
**Why it happens:** `page.tsx` currently selects only `custom_tags, currency` — `ingredient_customization_enabled` is not fetched.
**How to avoid:** Extend the settings `.select()` to include `ingredient_customization_enabled`.

### Pitfall 3: Tailwind v4 dynamic class purge
**What goes wrong:** A class like `bg-green-100` doesn't appear in the output CSS because it was built from string interpolation.
**Why it happens:** Tailwind v4 scans source files for complete class strings at build time.
**How to avoid:** Always write full class names in JSX conditionals. Never: `'bg-' + color + '-100'`. Always: `color === 'green' ? 'bg-green-100' : 'bg-zinc-100'`.

### Pitfall 4: Reorder with duplicate `position` values
**What goes wrong:** After multiple reorders, items with duplicate `position` values cause inconsistent sort order.
**Why it happens:** Swapping positions between two rows can be non-atomic — if one update fails, positions diverge.
**How to avoid:** Both updates in the `moveIngredient` function must run in `Promise.all`. If the catch fires, roll back to `prevIngredients`. No need for a DB transaction for this two-row swap.

### Pitfall 5: product_ingredients multi-select — stale state after toggle
**What goes wrong:** Toggling `is_default` or price overrides fires a DB update but local state is not updated, so toggling again sends incorrect values.
**Why it happens:** The client component holds `productIngredients` in state; mutations must update that state after successful DB write (same pattern as `updateGroupOptions` in ProductDetailClient).
**How to avoid:** After every successful `update` on `product_ingredients`, call `setProductIngredients(prev => prev.map(...))`.

### Pitfall 6: Empty override fields vs. zero
**What goes wrong:** An override of "0.00" is stored as `0`, which overrides the catalog default of 0 — harmless but could mask intent. Worse: an empty field stores `null` (correct fallback) vs. `0` (explicit zero).
**Why it happens:** `parseFloat('') === NaN`, and `parseFloat('0') === 0`.
**How to avoid:** Treat empty string as `null` (fallback to catalog default): `override !== '' ? parseFloat(override) : null`. This matches the `extra_price_override: number | null` type.

---

## Code Examples

### Ingredient form fields

```typescript
// Based on existing price field pattern (ProductsClient.tsx, ProductDetailClient.tsx)
<div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
  <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
    {CURRENCY_SYMBOL[currency] ?? currency}
  </span>
  <input
    type="number"
    step="0.01"
    min="0"
    value={form.default_extra_price}
    onChange={e => setForm(f => ({ ...f, default_extra_price: e.target.value }))}
    placeholder="0.00"
    className="flex-1 px-3 py-2 text-sm focus:outline-none"
  />
</div>
```

### Availability toggle (consistent with StoreClient)

```typescript
// StoreClient.tsx pattern — inline toggle button
<button
  type="button"
  onClick={() => setForm(f => ({ ...f, is_available: !f.is_available }))}
  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
    form.is_available ? 'bg-zinc-900' : 'bg-zinc-200'
  }`}
>
  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
    form.is_available ? 'translate-x-6' : 'translate-x-1'
  }`} />
</button>
```

### Supabase joined query for product_ingredients tab

```typescript
// page.tsx — fetch both catalogs
const { data: allIngredients } = await supabase
  .from('ingredients')
  .select('*')
  .eq('tenant_id', tenantId)
  .order('position')

const { data: productIngredients } = await supabase
  .from('product_ingredients')
  .select('*')
  .eq('product_id', id)
  .eq('tenant_id', tenantId)

// Pass both as props; client derives "selected set" from productIngredients
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| N/A — new feature | Direct Supabase client CRUD | No API routes needed |
| N/A | Up/down arrow reorder (no drag library) | No @dnd-kit install needed |

---

## Open Questions

1. **Tab bar vs card sections in product editor**
   - What we know: Current editor uses stacked card sections (no tab bar)
   - What's unclear: The roadmap says "UI hint: yes" and success criterion 4 says "shows 'Ingredientes' tab" — implies a real tab bar
   - Recommendation: Add a tab bar (`useState<'options' | 'ingredients'>('options')`) above the section cards; render Option Groups card or Ingredientes card based on active tab. This is a small addition and satisfies the spec literally.

2. **Sidebar: where to fetch `ingredient_customization_enabled` in layout.tsx**
   - What we know: `layout.tsx` does not currently query `tenant_settings`
   - What's unclear: Whether to add a separate settings query to `layout.tsx` or reuse data already fetched there
   - Recommendation: Add a targeted query `.select('ingredient_customization_enabled')` from `tenant_settings` in `layout.tsx` for both the superadmin preview path and the regular tenant path. Cost is minimal (single row, single field).

3. **Inline editing vs modal for ingredient CRUD**
   - What we know: ProductDetailClient uses inline expand forms; ProductsClient uses a modal overlay
   - What's unclear: Which pattern is better for ingredients
   - Recommendation: Use the modal pattern (like ProductsClient) for ingredient create/edit — ingredients have 4 fields + availability toggle, which is manageable in a modal. The inline pattern is better for many nested items (option groups have their own inline structure).

---

## Environment Availability

Step 2.6: SKIPPED — Phase 24 is purely code changes within the existing Next.js/Supabase stack. No new external dependencies, CLIs, or services are introduced.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection: `src/app/(admin)/menu/products/ProductsClient.tsx` — CRUD pattern, modal pattern, Supabase direct
- Direct inspection: `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` — reorder pattern (moveGroup/moveOption), inline forms, option groups section
- Direct inspection: `src/app/(admin)/menu/products/[id]/page.tsx` — server component pattern, multi-query Promise.all, prop passing
- Direct inspection: `src/components/admin/AdminSidebar.tsx` — item arrays, role-based filtering, no flag-based filtering currently
- Direct inspection: `src/app/(admin)/layout.tsx` — what props are passed to AdminSidebar, what is currently fetched
- Direct inspection: `src/app/(admin)/settings/store/StoreClient.tsx` — availability toggle pattern, Supabase upsert pattern
- Direct inspection: `src/types/database.ts` — `Ingredient`, `ProductIngredient`, `TenantSettings.ingredient_customization_enabled`
- Direct inspection: `package.json` — confirmed no @dnd-kit, framer-motion present, lucide-react present

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — confirmed drag-to-reorder for ingredients only (not product_ingredients)
- `.planning/phases/23-ingredient-schema/23-01-SUMMARY.md` — confirmed RLS policies, composite PK on product_ingredients

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package.json inspected directly
- Architecture: HIGH — all patterns derived from existing source code, not from external docs
- Pitfalls: HIGH — derived from understanding the existing codebase conventions
- Reorder mechanism: HIGH — implemented identically in ProductDetailClient, no library needed

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable internal codebase, no external library dependencies)
