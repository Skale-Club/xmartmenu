# Phase 5: Admin Product Options UI - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Store admins can configure option groups and individual options per product — the management UI for sizes, toppings, and half-and-half configurations. This phase is admin-only; the public customer-facing display of options is Phase 6.

Scope: create/edit/delete option groups and options, toggle option availability, reorder groups and options by position.

</domain>

<decisions>
## Implementation Decisions

### Entry Point
- **D-01:** Create a dedicated product detail page at `/admin/menu/products/[id]` (Next.js App Router route). The existing product list row's "Edit" button navigates to this page rather than opening the existing modal.
- **D-02:** The new product detail page hosts both the existing product fields (name, description, price, images, tags) AND the new option groups section below. This consolidates product editing into one full-page layout.
- **D-03:** The existing inline modal flow on the products list page (`ProductsClient.tsx`) may remain for quick edits, but the primary option group management path is the detail page.

### Creation Flow
- **D-04:** Option groups and options are created via inline expand-forms — no sub-modals. Clicking "+ Add group" expands an inline form row within the groups section; same pattern for "+ Add option" within a group. Forms collapse after save.
- **D-05:** Groups and options are listed as rows with edit (pencil/inline) and delete (trash/ConfirmDialog) actions. Inline editing: clicking "Edit" on a row expands it for editing in place.

### Position Ordering
- **D-06:** Reordering uses simple ↑↓ arrow buttons on each group row and each option row. No drag-and-drop library required (none currently installed). Position values are saved to the `position` field on submit/after each reorder action.

### Price Field Design
- **D-07:** Each option has a single adaptive price field:
  - For groups with type `single` or `half_and_half` → show **"Base price"** field (writes `base_price`, sets `price_modifier = 0`). Label: "Base price (full size price)".
  - For groups with type `multiple` → show **"+/- Modifier"** field (writes `price_modifier`, keeps `base_price = null`). Label: "Price modifier (+/-)".
  - The field label and hint update reactively when the group type changes.

### General UI Conventions
- **D-08:** Follow existing admin styling: zinc palette, `rounded-xl`, `border border-zinc-200`, `shadow-xl` for cards/sections, `bg-zinc-900 text-white` primary buttons.
- **D-09:** Use the existing `ConfirmDialog` component (`src/components/ui/ConfirmDialog.tsx`) for destructive confirmations (delete group, delete option).
- **D-10:** Data fetching on the detail page follows the existing App Router pattern: server component fetches data, passes to a client component for interactivity. Supabase client-side calls for mutations.

### Claude's Discretion
- Visual layout of the option groups section within the product detail page (card per group vs. flat list)
- Loading/saving state indicators within inline forms
- Empty state when a product has no option groups yet
- Whether to show option count summary on the group header row

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Product UI (patterns to follow)
- `src/app/(admin)/menu/products/ProductsClient.tsx` — existing product list + edit modal; establishes styling, Supabase call patterns, Modal component, ConfirmDialog usage
- `src/components/ui/ConfirmDialog.tsx` — reusable confirmation dialog used for delete actions

### Database Schema
- `supabase/migrations/021_orders_v11_schema.sql` — defines `product_option_groups` and `product_options` tables with all columns, constraints, and RLS policies
- `src/types/database.ts` — TypeScript types for `ProductOptionGroup`, `ProductOption`, `OptionGroupType`, `PriceRule`

### Requirements
- `.planning/REQUIREMENTS.md` §ORD-05, ORD-06, ORD-07 — acceptance criteria for admin option group management

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfirmDialog` (`src/components/ui/ConfirmDialog.tsx`) — use for delete group / delete option confirmations
- Inline `Modal` pattern in `ProductsClient.tsx` — max-w-4xl, overflow-y-auto, title bar with close button; can be referenced for style but the detail page won't need this modal
- Supabase client pattern (`createClient()` from `@/lib/supabase/client`) — established in ProductsClient, replicate for option group mutations

### Established Patterns
- Server component (page.tsx) fetches data → passes to `*Client.tsx` for interactivity
- Zinc palette Tailwind styling throughout admin
- `border border-zinc-200 rounded-xl` card style
- `bg-zinc-900 text-white px-4 py-2 rounded-lg` primary button style
- Price displayed via `formatPrice()` from `@/lib/utils`

### Integration Points
- New route: `src/app/(admin)/menu/products/[id]/page.tsx` + `[id]/ProductDetailClient.tsx`
- Must receive `tenantId` and `menuId` from existing session/context (same pattern as products list page)
- Product list row "Edit" button needs updating to `router.push(/admin/menu/products/${id})` instead of opening the modal

</code_context>

<specifics>
## Specific Ideas

No specific references or examples provided — open to standard implementation approaches following the patterns above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-admin-product-options-ui*
*Context gathered: 2026-05-06*
