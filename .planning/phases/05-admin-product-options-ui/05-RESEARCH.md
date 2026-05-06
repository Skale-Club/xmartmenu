# Phase 5: Admin Product Options UI — Research

**Researched:** 2026-05-06
**Domain:** Next.js App Router admin UI — inline CRUD with Supabase, position reordering
**Confidence:** HIGH

## Summary

Phase 5 is a pure admin UI phase built entirely within the existing admin shell. No new libraries are needed. The database schema (`product_option_groups` and `product_options`) is fully in place from Phase 4. TypeScript types (`ProductOptionGroup`, `ProductOption`, `OptionGroupType`, `PriceRule`) exist in `src/types/database.ts`. The implementation follows the exact same stack patterns already present in `ProductsClient.tsx` and `CategoriesClient.tsx`.

The central architectural challenge is state management for a two-level nested list (groups → options) with inline expand/collapse forms at both levels. The plan must provide a clear pattern for representing this in React state without reaching for complex reducers: a flat `groups` array with each group carrying its own `options` array is the standard approach for this depth. State updates use array map/filter/spread — no libraries needed.

Position reordering is simpler than it appears: swapping adjacent items by position field, persisting immediately to Supabase, and keeping local state in sync. The implementation must guard against race conditions by disabling reorder arrows while an in-flight update completes.

**Primary recommendation:** Build `ProductDetailClient.tsx` as the single client boundary owning all groups/options state. Extract `OptionGroupRow`, `OptionGroupForm`, `OptionRow`, and `OptionForm` as co-located sub-components (same file or same directory) — not as separate reusable library components.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Create a dedicated product detail page at `/admin/menu/products/[id]` (Next.js App Router route). The existing product list row's "Edit" button navigates to this page rather than opening the existing modal.
- **D-02:** The new product detail page hosts both the existing product fields (name, description, price, images, tags) AND the new option groups section below. This consolidates product editing into one full-page layout.
- **D-03:** The existing inline modal flow on the products list page (`ProductsClient.tsx`) may remain for quick edits, but the primary option group management path is the detail page.
- **D-04:** Option groups and options are created via inline expand-forms — no sub-modals. Clicking "+ Add group" expands an inline form row within the groups section; same pattern for "+ Add option" within a group. Forms collapse after save.
- **D-05:** Groups and options are listed as rows with edit (pencil/inline) and delete (trash/ConfirmDialog) actions. Inline editing: clicking "Edit" on a row expands it for editing in place.
- **D-06:** Reordering uses simple ↑↓ arrow buttons on each group row and each option row. No drag-and-drop library required (none currently installed). Position values are saved to the `position` field on submit/after each reorder action.
- **D-07:** Each option has a single adaptive price field — group type `single`/`half_and_half` shows "Base price (full size price)" writing `base_price` + `price_modifier=0`; group type `multiple` shows "+/- Modifier" writing `price_modifier` + `base_price=null`. The field label and hint update reactively when the group type changes.
- **D-08:** Follow existing admin styling: zinc palette, `rounded-xl`, `border border-zinc-200`, `shadow-xl` for cards/sections, `bg-zinc-900 text-white` primary buttons.
- **D-09:** Use the existing `ConfirmDialog` component (`src/components/ui/ConfirmDialog.tsx`) for destructive confirmations.
- **D-10:** Server component fetches data, passes to `*Client.tsx`. Supabase client-side calls for mutations.

### Claude's Discretion

- Visual layout of the option groups section within the product detail page (card per group vs. flat list)
- Loading/saving state indicators within inline forms
- Empty state when a product has no option groups yet
- Whether to show option count summary on the group header row

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORD-05 | Store admin can add option groups to a product (name, type, required, min/max_selections) | Inline expand-form pattern. `product_option_groups` table accepts all fields. Supabase `.insert()` call from client. |
| ORD-06 | Store admin can add/edit/delete individual options within a group (name, base_price or price_modifier, availability) | Adaptive price field (D-07). `product_options` table. Availability toggle reuses same pill pattern as products list. |
| ORD-07 | Store admin can reorder option groups and options via position field | ↑↓ swap pattern: read current array, swap positions, `supabase.from(...).update({ position: newPos }).eq('id', ...)`. Two sequential updates per swap. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 16.2.2 | Server component page, `[id]` dynamic route | Already in use across entire admin |
| Supabase JS | ^2.101.1 | Client-side CRUD mutations | Established pattern in ProductsClient, CategoriesClient |
| React | 19.2.4 | Client component state + interactivity | Project baseline |
| Tailwind v4 | (postcss plugin) | All styling via inline classes | No CSS files used in this project |
| lucide-react | 1.7.0 | Icons: ChevronUp, ChevronDown, Pencil, Trash2 | Already installed, used across admin |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/ssr` | ^0.10.0 | Server-side client creation | Used in `page.tsx` via `createClient` from `@/lib/supabase/server` |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^3.5.0 | Conditional class merging | Already imported via `@/lib/utils` `cn()` helper |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ↑↓ arrow reordering | dnd-kit or react-beautiful-dnd | D-06 locks arrow buttons; no drag lib installed |
| Inline forms | Sub-modals | D-04 locks inline expand-forms |
| Supabase client direct calls | API routes | ProductsClient already calls Supabase directly from client — consistent |

**Installation:** No new packages required. All dependencies are present.

---

## Architecture Patterns

### Recommended Project Structure

```
src/app/(admin)/menu/products/
├── page.tsx                     # EXISTING — update Edit button to navigate
├── ProductsClient.tsx            # EXISTING — update Edit button
└── [id]/
    ├── page.tsx                 # NEW — server component: fetch product + groups + options
    └── ProductDetailClient.tsx  # NEW — client component: all state + interactions
```

### Pattern 1: Server Component Data Fetch

**What:** `page.tsx` fetches product, its option groups (ordered by position), and each group's options (ordered by position). Passes all data to `ProductDetailClient`.

**When to use:** Consistent with existing `products/page.tsx` and `categories/page.tsx` — server fetches, client renders.

```typescript
// Source: existing products/page.tsx pattern
export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import ProductDetailClient from './ProductDetailClient'

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const tenantId = effective!.tenantId

  const [{ data: product }, { data: groups }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:categories(id, name)')
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .eq('product_id', params.id)
      .order('position')
      // NOTE: product_options must also be ordered — use embedded filter:
      // .order('position', { referencedTable: 'product_options' })
  ])

  return (
    <ProductDetailClient
      product={product}
      initialGroups={groups ?? []}
      tenantId={tenantId}
    />
  )
}
```

**Supabase nested query for options:** Use `.select('*, options:product_options(*)')` with embedded order. Verified pattern: Supabase JS v2 supports `{ referencedTable: 'product_options' }` in `.order()` for ordering embedded relations.

### Pattern 2: Two-Level Nested State Shape

**What:** Client component holds `groups` array where each element carries its options inline. This avoids separate state maps and keeps position logic co-located.

**When to use:** Any time you have parent-child lists where child operations (add/edit/delete/reorder option) must re-render only the relevant group.

```typescript
// Derived from database.ts types
interface GroupWithOptions extends ProductOptionGroup {
  options: ProductOption[]
}

// State in ProductDetailClient
const [groups, setGroups] = useState<GroupWithOptions[]>(initialGroups)

// Mutate a specific group's options
function updateGroupOptions(groupId: string, updater: (opts: ProductOption[]) => ProductOption[]) {
  setGroups(prev => prev.map(g =>
    g.id === groupId ? { ...g, options: updater(g.options) } : g
  ))
}
```

### Pattern 3: Inline Expand/Collapse Form State

**What:** Each group row and each option row tracks its own expand state. One `expandedGroupId` and per-group `expandedOptionId` avoids multiple open forms simultaneously.

**When to use:** When D-04 requires that "+ Add group" button is disabled while a form is open (only one form open at a time per level).

```typescript
// Group-level form state
const [expandedGroup, setExpandedGroup] = useState<'new' | string | null>(null)
// 'new' = add form; string (group id) = edit form; null = all collapsed

// Per-group option form state — stored as a map keyed by group id
const [expandedOption, setExpandedOption] = useState<Record<string, 'new' | string | null>>({})
```

### Pattern 4: Position Swap Reordering

**What:** When user clicks ↑ on a row, swap `position` values with the row above, update both rows in Supabase, update local state optimistically.

**When to use:** D-06 ↑↓ arrows, applies to both groups and options.

```typescript
async function moveGroup(groupId: string, direction: 'up' | 'down') {
  const idx = groups.findIndex(g => g.id === groupId)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= groups.length) return

  const current = groups[idx]
  const swap = groups[swapIdx]

  // Optimistic update
  const reordered = groups.map(g => {
    if (g.id === current.id) return { ...g, position: swap.position }
    if (g.id === swap.id) return { ...g, position: current.position }
    return g
  }).sort((a, b) => a.position - b.position)
  setGroups(reordered)

  // Persist (two updates — no transaction needed for position swaps)
  const supabase = createClient()
  await Promise.all([
    supabase.from('product_option_groups').update({ position: swap.position }).eq('id', current.id),
    supabase.from('product_option_groups').update({ position: current.position }).eq('id', swap.id),
  ])
  // On error: restore previous state (silent retry per UI-SPEC)
}
```

### Pattern 5: Adaptive Price Field

**What:** Option form renders different label and writes different field based on parent group's `type`. The group type is available in the component through props.

```typescript
// Inside OptionForm, receiving parentGroupType prop
const isAbsolutePrice = parentGroupType === 'single' || parentGroupType === 'half_and_half'

const priceLabel = isAbsolutePrice
  ? 'Base price (full size price)'
  : 'Price modifier (+/-)'

const priceHint = isAbsolutePrice
  ? 'Absolute price for this option size'
  : 'Amount added to or subtracted from the product\'s base price'

// On save:
const optionPayload = isAbsolutePrice
  ? { base_price: parseFloat(priceValue), price_modifier: 0 }
  : { base_price: null, price_modifier: parseFloat(priceValue) }
```

### Pattern 6: Updating "Edit" Button in ProductsClient

**What:** The "Edit" button currently calls `startEdit(product)` which opens a modal. Decision D-01 requires it to navigate to `/admin/menu/products/[id]` instead.

```typescript
// Before (existing):
<button onClick={() => startEdit(product)}>Edit</button>

// After (D-01 compliant):
import { useRouter } from 'next/navigation'
const router = useRouter()
// ...
<button onClick={() => router.push(`/admin/menu/products/${product.id}`)}>Edit</button>
```

`useRouter` is already imported in `ProductsClient.tsx` (line 6). The modal and its form state can remain intact per D-03.

### Anti-Patterns to Avoid

- **Separate state for options outside groups:** Keeping `options` in a `Map<groupId, ProductOption[]>` instead of inline in the group object creates dual-source-of-truth bugs during reorder.
- **Opening a modal for add/edit:** D-04 explicitly forbids modals for group/option CRUD. Use inline expand.
- **Global "saving" boolean:** One saving flag for the whole page prevents concurrent product field save + group save. Use per-form `saving` state.
- **Re-fetching from server after each mutation:** The existing pattern (ProductsClient, CategoriesClient) does optimistic local state update, not router.refresh(). Follow this pattern.
- **Unguarded double-click on reorder:** Without `disabled` state on in-flight arrows, rapid clicking sends multiple conflicting Supabase updates.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirmation before delete | Custom modal JSX | `ConfirmDialog` from `src/components/ui/ConfirmDialog.tsx` | Already wired for accessibility, backdrop click, confirmLabel prop |
| Price formatting | Manual Intl.NumberFormat | `formatPrice(value, currency)` from `@/lib/utils` | Already handles all project currencies |
| Conditional class merging | String concatenation | `cn()` from `@/lib/utils` (clsx + tailwind-merge) | Handles Tailwind class conflicts |
| Supabase browser client | `createBrowserClient(...)` inline | `createClient()` from `@/lib/supabase/client` | Standard project import |
| tenantId resolution | Re-reading profile in client | Pass from server component | Pattern in all existing admin pages |

---

## Common Pitfalls

### Pitfall 1: Supabase Nested Order for Embedded Relations

**What goes wrong:** Calling `.order('position')` after a nested `.select('*, options:product_options(*)')` only orders the outer table (groups), not the inner array (options). Options come back in insertion order.

**Why it happens:** Supabase PostgREST requires `{ referencedTable: 'product_options' }` to target inner order.

**How to avoid:**
```typescript
supabase
  .from('product_option_groups')
  .select('*, options:product_options(*)')
  .eq('product_id', params.id)
  .order('position')
  .order('position', { referencedTable: 'product_options' })
```

**Warning signs:** Options appear in random order on first load even though position values are correct in DB.

### Pitfall 2: Stale Position Values After Reorder

**What goes wrong:** After a swap, two groups end up with the same `position` value if the DB update fails silently or if positions were not unique to begin with.

**Why it happens:** Positions in product_option_groups are not constrained to be unique per product. Initial inserts use `groups.length` as position, which can produce ties if rows were deleted.

**How to avoid:** On save of a new group, assign `position = groups.length` (correct per current pattern). After any reorder, re-normalize positions server-side or ensure swap logic uses actual `position` values from state, not array indices.

**Warning signs:** ↑ arrow on row 2 of 3 does nothing visible (positions were already equal).

### Pitfall 3: Next.js Dynamic Route Params in App Router

**What goes wrong:** In Next.js 15+, dynamic route params (`params.id`) are async — accessing `params.id` synchronously in `page.tsx` will cause a TypeScript warning and may not work in future versions.

**Why it happens:** App Router's `params` object is now a Promise in newer Next.js versions.

**How to avoid:** Use `await params` pattern (Next.js 15 style) even though current project is 16.2.2:
```typescript
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // ...
}
```

**Warning signs:** Build warnings about synchronous param access; TypeScript type errors on `params.id`.

### Pitfall 4: Inline Form "Edit" State Conflict

**What goes wrong:** If user clicks "Edit" on group A while group B's add-form is open, both forms render simultaneously causing layout overflow and state confusion.

**Why it happens:** Expand state initialized independently per button click without checking global form state.

**How to avoid:** Use a single `expandedGroup` discriminated union (`'new' | groupId | null`). Opening any form first closes any previously open form:
```typescript
function openGroupEdit(id: string) {
  setExpandedGroup(id)      // implicitly closes 'new' and other edits
  setExpandedOption({})     // also close any open option forms
}
```

**Warning signs:** Two inline forms visible simultaneously; "+ Add group" button doesn't disable when edit form is open.

### Pitfall 5: price_modifier Type Handling

**What goes wrong:** `price_modifier` accepts negative numbers (for discounts). `<input type="number" min="0">` silently prevents negative values, breaking the "Price modifier (+/-)" use case.

**Why it happens:** Reusing the same input constraints as `base_price`.

**How to avoid:** Do NOT use `min="0"` on the price field when `parentGroupType === 'multiple'`. Only `base_price` inputs should have `min="0"`.

**Warning signs:** Negative modifiers (e.g., -2.00) cannot be typed; input resets to 0.

### Pitfall 6: RLS Policy Context on Client Mutations

**What goes wrong:** Supabase client-side mutations against `product_option_groups` and `product_options` fail with `permission denied` if the anon user doesn't have the admin role context.

**Why it happens:** The RLS policy `option_groups_admin` uses `auth_tenant_id()` — requires an authenticated session, not just anon key.

**How to avoid:** The existing `createClient()` from `@/lib/supabase/client` uses the browser session cookie automatically. As long as the admin is authenticated (which the admin layout enforces), mutations will carry the session. Do not use the service client from client components.

**Warning signs:** 403/permission denied errors on insert/update/delete in browser console despite admin being logged in — means session cookie is missing (unlikely in normal flow but check if cookies are being cleared).

---

## Code Examples

### Example 1: Page Server Component

```typescript
// src/app/(admin)/menu/products/[id]/page.tsx
// Source: adapted from existing products/page.tsx
export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { notFound } from 'next/navigation'
import ProductDetailClient from './ProductDetailClient'

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  if (!effective) notFound()

  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'

  const [{ data: product }, { data: groups }, { data: settings }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:categories(id, name)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .eq('product_id', id)
      .order('position')
      .order('position', { referencedTable: 'product_options' }),
    supabase
      .from('tenant_settings')
      .select('custom_tags, currency')
      .eq('tenant_id', tenantId)
      .single(),
  ])

  if (!product) notFound()

  return (
    <ProductDetailClient
      product={product}
      initialGroups={(groups ?? []) as GroupWithOptions[]}
      tenantId={tenantId}
      currency={settings?.currency ?? 'BRL'}
      canManage={canManage}
    />
  )
}
```

### Example 2: ConfirmDialog Usage

```typescript
// Source: existing ProductsClient.tsx lines 290-296
<ConfirmDialog
  open={!!confirmGroupId}
  title="Delete option group"
  message="Delete this option group and all its options? This action cannot be undone."
  confirmLabel="Delete group"
  onConfirm={confirmDeleteGroup}
  onCancel={() => setConfirmGroupId(null)}
/>
```

### Example 3: Type Badge Rendering

```typescript
// Source: 05-UI-SPEC.md Interaction Contract
const TYPE_BADGE: Record<OptionGroupType, string> = {
  single:         'bg-blue-100   text-blue-700   text-xs px-2 py-0.5 rounded-full',
  multiple:       'bg-purple-100 text-purple-700  text-xs px-2 py-0.5 rounded-full',
  half_and_half:  'bg-orange-100 text-orange-700  text-xs px-2 py-0.5 rounded-full',
}
const TYPE_LABEL: Record<OptionGroupType, string> = {
  single: 'single', multiple: 'multiple', half_and_half: 'half & half'
}

<span className={TYPE_BADGE[group.type]}>{TYPE_LABEL[group.type]}</span>
```

### Example 4: Availability Toggle (options)

```typescript
// Source: adapted from ProductsClient.tsx toggleAvailable (lines 269-272)
async function toggleOptionAvailability(groupId: string, optionId: string, current: boolean) {
  const supabase = createClient()
  await supabase.from('product_options').update({ is_available: !current }).eq('id', optionId)
  updateGroupOptions(groupId, opts =>
    opts.map(o => o.id === optionId ? { ...o, is_available: !current } : o)
  )
}

// Pill render (from UI-SPEC):
<button
  onClick={() => toggleOptionAvailability(group.id, option.id, option.is_available)}
  className={option.is_available
    ? 'bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-medium hover:bg-green-200 transition-colors'
    : 'bg-zinc-100 text-zinc-500 text-xs px-2.5 py-1 rounded-full font-medium hover:bg-zinc-200 transition-colors'
  }
>
  {option.is_available ? 'Available' : 'Unavailable'}
</button>
```

### Example 5: Lucide Icons to Use

```typescript
// All available in lucide-react 1.7.0
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus } from 'lucide-react'

// Reorder buttons
<button aria-label="Move group up" disabled={idx === 0 || reorderInFlight}
  className="text-zinc-400 hover:text-zinc-700 p-1 rounded disabled:opacity-30">
  <ChevronUp size={16} />
</button>
```

---

## File Change Map

| File | Action | What Changes |
|------|--------|--------------|
| `src/app/(admin)/menu/products/ProductsClient.tsx` | MODIFY | Change "Edit" button: `startEdit(product)` → `router.push('/admin/menu/products/' + product.id)` |
| `src/app/(admin)/menu/products/[id]/page.tsx` | CREATE | Server component — fetch product + groups + options, pass to client |
| `src/app/(admin)/menu/products/[id]/ProductDetailClient.tsx` | CREATE | Main client component with all state, form handlers, reorder logic |

No other files need modification. The `ConfirmDialog`, `createClient`, `getEffectiveTenant`, and `formatPrice` imports all exist and are correct.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `params.id` synchronous access | `await params` (Next.js 15+) | Type-safe, future-proof |
| Separate fetch calls for groups + options | Supabase embedded select `*, options:product_options(*)` | Single round-trip to DB |
| Manual `Intl.NumberFormat` | `formatPrice()` from utils | Consistent currency display |

---

## Open Questions

1. **Does `product_options` need `menu_id`?**
   - What we know: `product_options` table has `tenant_id` but not `menu_id`. The `product_option_groups` table also has no `menu_id` — only `product_id`.
   - What's unclear: Not a problem for Phase 5 (admin CRUD only uses `tenant_id` for RLS). This matters for Phase 6 public display.
   - Recommendation: Ignore for Phase 5 — the existing schema is correct for this phase.

2. **How to handle `notFound()` for deleted/invalid product IDs?**
   - What we know: `createClient()` from server returns `null` data for missing rows.
   - Recommendation: Add explicit `if (!product) notFound()` in `page.tsx`. Already shown in code example above.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — phase is purely code/config changes against an already-deployed Supabase schema from Phase 4).

---

## Validation Architecture

Step 4: SKIPPED — `workflow.nyquist_validation` is explicitly set to `false` in `.planning/config.json`.

---

## Sources

### Primary (HIGH confidence)
- `src/app/(admin)/menu/products/ProductsClient.tsx` — Modal pattern, Supabase client mutation pattern, button styles, ConfirmDialog usage, loading state pattern
- `src/app/(admin)/menu/products/page.tsx` — Server component fetch + client pass pattern
- `src/app/(admin)/menu/categories/CategoriesClient.tsx` — Row list pattern with edit/delete/toggle
- `src/components/ui/ConfirmDialog.tsx` — Exact props interface: open, title, message, confirmLabel, onConfirm, onCancel
- `supabase/migrations/021_orders_v11_schema.sql` — Column definitions, constraints, RLS policies
- `src/types/database.ts` — TypeScript interfaces for ProductOptionGroup, ProductOption, OptionGroupType, PriceRule
- `src/lib/utils.ts` — formatPrice, cn helpers
- `src/lib/supabase/client.ts` — createClient browser pattern
- `src/lib/get-effective-tenant.ts` — tenantId resolution pattern
- `.planning/phases/05-admin-product-options-ui/05-UI-SPEC.md` — Full interaction contract, copy, states, color tokens

### Secondary (MEDIUM confidence)
- `.planning/phases/05-admin-product-options-ui/05-CONTEXT.md` — Locked decisions D-01 through D-10

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against package.json and existing imports
- Architecture: HIGH — direct port of existing admin patterns
- Pitfalls: HIGH — derived from actual codebase inspection and database schema review
- UI spec adherence: HIGH — 05-UI-SPEC.md is authoritative and has been read in full

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (stable Next.js/Supabase stack, 30-day window)
