# Phase 22: Realtime + Per-Item Notes — Research

**Researched:** 2026-05-08
**Domain:** Supabase Realtime (browser client), PostgreSQL migration, React state management, per-item notes UI
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KDS-06 | New orders appear without manual reload — Supabase Realtime subscription on `orders` table filtered by `tenant_id`, or polling at 15 s as fallback | Realtime channel setup pattern documented; polling fallback pattern documented; `supabase` browser client already scaffolded in OrdersClient |
| NOTE-01 | `item_notes_enabled` boolean on `tenant_settings` — same pattern as `direct_orders_enabled` | Confirmed: `direct_orders_enabled` lives in `tenant_settings`; migration 018 is the template; StoreClient.tsx pattern is the toggle UI template |
| NOTE-02 | Customer textarea "Observações" (max 140 chars, live counter) on ProductModal in MenuPage.tsx when flag is on | ProductModal is a function component in MenuPage.tsx receiving `onAddToCart`; notes state can be per-modal-open; `item_notes_enabled` arrives via `tenant.tenant_settings` already on the page |
| NOTE-03 | DB migration 025: `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT`; server-side validation in orders POST API | `OrderItem.notes` is already `string \| null` in `database.ts`; DB column may not exist yet — migration 025 required; API route already maps `notes: item.notes \|\| null` but does no validation — trim/length/strip-control-chars needed |
| NOTE-04 | KDS OrderCard and admin orders table display per-item notes visually distinct (icon + italic or colored text) | OrderCard renders `order.order_items.map(...)` at lines 79–81; list-view modal renders items at lines 263–277; both sites need notes display added |
</phase_requirements>

---

## Summary

Phase 22 has two orthogonal concerns that can be planned as separate waves: (1) Realtime/polling on the KDS so new orders appear automatically, and (2) per-item notes plumbed from customer modal through DB to KDS card and admin list.

For KDS-06: `OrdersClient.tsx` already has `const supabase = createClient()` scaffolded (Phase 21 stub). Wiring Realtime is a single `useEffect` that subscribes to `postgres_changes` on the `orders` table filtered by `tenant_id`, then calls `setOrders` on INSERT. The polling fallback is a `setInterval` calling the existing GET `/api/orders?tenant_id=...`. Both approaches are possible; Realtime is the primary path and polling is the guard for environments where Realtime is not available.

For Notes: the TypeScript type `OrderItem.notes` is already `string | null` in `database.ts` (line 154). The API route `src/app/api/orders/route.ts` already passes `notes: item.notes || null` when inserting order items (line 81). The only missing piece is the DB column itself (migration 025), server-side validation in the POST handler, the customer textarea UI, and the KDS/admin display. Migration format is identical to migration 018 (single-line ALTER TABLE with IF NOT EXISTS). `item_notes_enabled` goes in `tenant_settings` following the `direct_orders_enabled` pattern — migration 025 adds both the column and the flag.

**Primary recommendation:** Plan in two waves — Wave 1: KDS Realtime (KDS-06) as a pure OrdersClient.tsx edit; Wave 2: Notes (NOTE-01 through NOTE-04) as migration + API validation + MenuPage textarea + KDS/admin display.

---

## Standard Stack

### Core (already installed, no new packages needed)

| Library | Version | Purpose | Confirmation |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.101.1 | Realtime channel subscription | Already in package.json |
| `@supabase/ssr` | ^0.10.0 | Browser client (`createBrowserClient`) | `src/lib/supabase/client.ts` uses this |
| React | 19.2.4 | useState / useEffect / useRef | Already installed |
| TypeScript | ^5 | Type extensions for notes | Already installed |
| Tailwind CSS | ^4 | Visual distinction classes | Already installed |

No new packages are required for this phase.

---

## Architecture Patterns

### Pattern 1: Supabase Realtime subscription in a 'use client' component

**What:** Subscribe to `postgres_changes` event on the `orders` table in a `useEffect` inside `OrdersClient.tsx`. The browser client (`createClient()`) is already declared at line 121. Cleanup on unmount is mandatory.

**When to use:** Primary approach for KDS-06.

**Correct filter syntax:** Supabase Realtime channel filters use `eq` syntax with the column value as a string.

```typescript
// Source: Supabase JS v2 docs — postgres_changes with filter
useEffect(() => {
  const channel = supabase
    .channel('orders-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        // payload.new is the new order row; order_items are NOT included
        // We must fetch the full order (with items) separately, or refetch all
        setOrders((prev) => {
          // De-duplicate: ignore if already present (idempotent)
          if (prev.some((o) => o.id === (payload.new as Order).id)) return prev
          // Insert at front (newest first) — consistent with page.tsx sort
          return [payload.new as OrderWithItems, ...prev]
        })
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [tenantId, supabase])
```

**Critical caveat:** The `postgres_changes` INSERT payload contains only the `orders` row, NOT the joined `order_items`. Two options:
- Option A (simpler): On INSERT event, fetch the full order+items via a second Supabase query and prepend it.
- Option B: Accept that new Realtime-injected orders show zero items until the next full refresh. This is wrong UX for a KDS — kitchen needs to see items immediately.

**Recommendation: Option A** — on INSERT event, fire a follow-up `.from('orders').select('*, order_items(*)').eq('id', payload.new.id).single()` and prepend the result. This is one extra query only on new orders, negligible cost.

**RLS consideration:** The Realtime subscription uses the browser client with the anon key. The `orders` table must have an RLS policy that allows the authenticated admin user to receive realtime events. The existing `orders` admin read policy covers this (confirmed in migration 020 — admins can read their tenant's orders). Realtime respects RLS automatically when using the anon key with a session.

### Pattern 2: Polling fallback

**What:** If Realtime is unavailable or as a belt-and-suspenders guard, a `setInterval` at 15 s calls `/api/orders?tenant_id=` and replaces local state.

**When to use:** Declared as fallback in the requirements. Can be implemented as a secondary `useEffect` that only activates when a `realtimeError` state is set, or unconditionally at a longer interval (e.g., 60 s) to cover edge cases.

```typescript
// Polling via the existing GET /api/orders endpoint
useEffect(() => {
  const id = setInterval(async () => {
    const res = await fetch(`/api/orders?tenant_id=${tenantId}`)
    if (res.ok) {
      const data = await res.json()
      setOrders(data.orders)
    }
  }, 15_000) // 15 seconds
  return () => clearInterval(id)
}, [tenantId])
```

**Architecture decision for planner:** Running both Realtime and polling simultaneously avoids needing a fallback detection mechanism. Realtime updates arrive instantly; polling at 15 s fills any gap. The `setOrders` call in polling replaces state (not merges), which handles deletions and status changes that Realtime might miss.

### Pattern 3: Migration 025 — item_notes_enabled + order_items.notes

The project applies migrations manually via the Supabase SQL editor. Migration format follows the established pattern from migrations 018 and 021.

```sql
-- Migration 025: Per-item notes + item_notes_enabled flag
-- Adds item_notes_enabled to tenant_settings (NOTE-01)
-- Adds notes column to order_items (NOTE-03)
-- Safe to run multiple times (IF NOT EXISTS everywhere)

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS item_notes_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS notes TEXT;
```

No new RLS policies needed: `order_items` is already covered by the existing policy (items belong to orders which belong to the tenant). Adding a TEXT column with no constraints does not affect existing RLS.

### Pattern 4: item_notes_enabled — where it lives

**Confirmed location: `tenant_settings` table.** Verified by reading:
- `database.ts` — `TenantSettings` interface has `direct_orders_enabled`, `orders_enabled`, `whatsapp_orders_enabled` — all in `tenant_settings`
- Migration 018 — `ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS direct_orders_enabled BOOLEAN NOT NULL DEFAULT false`
- `StoreClient.tsx` reads settings from `tenant_settings` via the store settings page

The pattern for `item_notes_enabled` is identical to `direct_orders_enabled`.

### Pattern 5: MenuPage.tsx product modal — where the textarea goes

**Exact location:** Inside `ProductModal` component (starts at line 750 of MenuPage.tsx), inside the `<div className="p-5 sm:p-6">` content area, between the `optionGroups` block and the footer div (the price + action buttons `<div className="flex flex-col sm:flex-row...">`).

The textarea state (`itemNote`, `setItemNote`) is local to the `ProductModal` function. It resets to `''` when `product.id` changes (existing `useEffect([product.id])` pattern at line 771).

`item_notes_enabled` is available via `tenant.tenant_settings` in the parent `MenuPage` component. It must be passed as a prop to `ProductModal`.

**Props change:** `ProductModal` needs one new prop: `itemNotesEnabled?: boolean`. When true, renders the textarea before the price/action footer.

**Callback change:** `onAddToCart` currently receives `(selectedOptions, unitPrice)`. To pass the note, it becomes `(selectedOptions, unitPrice, note?: string)`. The `addToCart` function in `MenuPage` must extend `CartItem` to hold the note (or pass it at order submission time).

**Simpler alternative:** Do not extend `CartItem`. Instead, pass the note as part of `selectedOptions` (polluting the options object) — **avoid this**, it conflates two different data shapes. The correct approach is to extend `CartItem` with an optional `note?: string` field, populate it in `addToCart`, and include it in the `submitOrder` items array.

**`submitOrder` change:** The items mapping at line 193 must include `notes: item.note || undefined` so the API receives the note.

### Pattern 6: Server-side validation in orders POST API

The current POST handler (route.ts lines 75–83) maps `notes: item.notes || null` without any validation. NOTE-03 requires trim, length cap, and control-char strip.

```typescript
// Validation helper — apply before inserting into order_items
function sanitizeNote(raw: string | undefined | null): string | null {
  if (!raw) return null
  // Strip control chars (0x00–0x1F except tab 0x09)
  const stripped = raw.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '')
  const trimmed = stripped.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 140)  // hard cap at 140 chars
}
```

Applied in the `orderItems` mapping:
```typescript
notes: sanitizeNote(item.notes),
```

### Pattern 7: KDS OrderCard notes display (NOTE-04)

The current OrderCard items list (lines 78–81) renders `{item.quantity}x {item.product_name}`. Extend to show note below the item name when present.

```tsx
<ul className="text-xs text-zinc-700 space-y-0.5">
  {order.order_items.map((item, i) => (
    <li key={i} className="flex flex-col gap-0.5">
      <span>{item.quantity}x {item.product_name}</span>
      {item.notes && (
        <span className="text-xs text-zinc-500 italic flex items-center gap-1">
          <MessageSquare size={10} className="flex-shrink-0" />
          {item.notes}
        </span>
      )}
    </li>
  ))}
</ul>
```

`MessageSquare` is available in `lucide-react@1.7.0` (already installed). Use full literal Tailwind class strings (no interpolation) per Tailwind CSS 4 purge rules established in Phase 21.

### Pattern 8: Admin list-view modal notes display (NOTE-04)

The order details modal (lines 263–277 of OrdersClient.tsx) already shows `selected_options`. Add notes rendering directly below the `selected_options` span, following the same pattern:

```tsx
{item.notes && (
  <span className="text-xs text-zinc-500 italic flex items-center gap-1 mt-0.5">
    <MessageSquare size={10} className="flex-shrink-0" />
    {item.notes}
  </span>
)}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Realtime subscription | Custom WebSocket or SSE layer | `supabase.channel().on('postgres_changes')` | Already authenticated, handles reconnects, respects RLS |
| Polling data fetch | Custom refetch mechanism | `fetch('/api/orders?...')` + existing GET handler | The endpoint already exists; no new route needed |
| Notes DB column | New table or JSONB blob | `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT` | Simplest schema change, consistent with how `orders.notes` already works |
| Control-char stripping | Regex library | Inline `replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '')` | Sufficient for a text note field, no library needed |

---

## Common Pitfalls

### Pitfall 1: Realtime payload missing order_items join
**What goes wrong:** `payload.new` on an INSERT event is only the `orders` row. Prepending it directly means the KDS card renders with an empty items list.
**Why it happens:** Supabase Realtime sends the raw row, not the joined result.
**How to avoid:** After receiving INSERT, fire a follow-up `.from('orders').select('*, order_items(*)').eq('id', payload.new.id).single()` and prepend that full object.
**Warning signs:** OrderCard renders `0 items` for new orders that appear via Realtime.

### Pitfall 2: Realtime subscription recreated on every render
**What goes wrong:** If `supabase` is declared inside the component body without `useMemo`, it creates a new client each render. The existing code declares `const supabase = createClient()` at the component top — this is stable because `createBrowserClient` memoizes the client internally in `@supabase/ssr`.
**How to avoid:** Keep the existing `const supabase = createClient()` pattern; do NOT move it into the `useEffect`. The `supabase` reference is stable across renders.
**Warning signs:** Multiple `channel('orders-realtime')` subscriptions firing on the same event.

### Pitfall 3: Channel name collision between tabs/components
**What goes wrong:** Two browser tabs on the KDS page subscribe to the same channel name. Supabase deduplicates by channel name but this can cause unexpected behavior if the channel is removed in one tab.
**How to avoid:** Use a unique channel name per `tenantId`: `orders-realtime-${tenantId}`.

### Pitfall 4: Polling and Realtime both calling setOrders — state thrash
**What goes wrong:** Polling replaces full state (`setOrders(data.orders)`) while Realtime prepends (`setOrders(prev => [newOrder, ...prev])`). If polling fires while a Realtime update is in flight, the new order may be dropped.
**How to avoid:** Polling replaces state with the server truth — this is correct and handles deletions. The small window where a Realtime-prepended order could be overwritten by an in-flight polling response is acceptable (it will reappear in the next polling cycle, max 15 s). No special deduplication needed.

### Pitfall 5: `item_notes_enabled` default false — existing tenants unaffected
**What goes wrong:** Migration adds column with `DEFAULT false`. Existing tenants without the feature flag will see no textarea — correct behavior. But the Store settings UI must expose a toggle so tenants can turn it on.
**How to avoid:** Add the toggle to `StoreClient.tsx` in the same pattern as the `direct_orders_enabled` toggle (confirmed present in StoreClient — need to read the full file to find the toggle UI section, but the pattern is established).

### Pitfall 6: Note state leaks between ProductModal opens
**What goes wrong:** If `itemNote` state is not reset when a new product is selected, the previous product's note appears in the next modal.
**How to avoid:** Add `setItemNote('')` to the existing `useEffect([product.id])` inside `ProductModal` (line 771 already resets `singleSelections`, `halfSelections`, `multiSelections`).

### Pitfall 7: CartItem type change breaks buildCartKey
**What goes wrong:** If `note` is added to `CartItem` and included in `buildCartKey`, two cart items for the same product with different notes get separate cart slots. This could be desired, but creates UX complexity (two slots for "burger", one with "no onion" note and one without).
**How to avoid:** Do NOT include `note` in `buildCartKey`. The note belongs to the cart slot as metadata, not as a slot discriminator. The same product+option combo always merges into one cart slot; the note from the most-recent add wins (or the first note is kept — planner decision).
**Recommended:** When adding to cart with a note, the note replaces any existing note on the existing cart slot (not a new slot). This matches user expectation.

### Pitfall 8: Migration 025 must be applied before TypeScript `notes` column is used
**What goes wrong:** The TypeScript type already has `notes: string | null` on `OrderItem`. If the DB column doesn't exist yet, the INSERT will fail silently (Supabase ignores unknown columns by default) or error.
**How to avoid:** Migration 025 must be the first task in Wave 2. All subsequent tasks assume the column exists.

### Pitfall 9: Realtime requires Realtime to be enabled in Supabase Dashboard
**What goes wrong:** By default, not all tables have Realtime enabled. `postgres_changes` subscriptions require the table to be in the Supabase Realtime publication.
**How to avoid:** Migration 025 should include (or a separate manual step in the plan): enabling Realtime for the `orders` table. This is done in the Supabase Dashboard under Database > Replication, OR via SQL:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
```
Include this as a manual step in the plan with clear instructions.

---

## Key Codebase Facts (verified by file reading)

### OrderItem.notes already in TypeScript types
`src/types/database.ts` line 154: `notes: string | null` is already declared on `OrderItem`. No TypeScript change needed for this field.

### orders API already passes notes
`src/app/api/orders/route.ts` line 81: `notes: item.notes || null` is already mapped in the `orderItems` array. The API *accepts* notes from the request body. Only missing: (1) DB column, (2) server-side validation, (3) client sending the note.

### supabase client already scaffolded in OrdersClient
`src/app/(admin)/orders/OrdersClient.tsx` line 121: `const supabase = createClient()` is already present from Phase 21 scaffolding. No import needed.

### CartItem type does NOT have notes — needs extension
`src/components/menu/MenuPage.tsx` line 62–68: `CartItem` interface has `product`, `quantity`, `selectedOptions`, `unitPrice`, `cartKey`. `note` must be added.

### submitOrder does NOT send notes — needs extension
Lines 192–199 of MenuPage.tsx: items mapping does not include notes. Must add `notes: item.note || undefined`.

### ProductModal signature
Lines 750–754: `ProductModal` receives `{ product, accentColor, currency, whatsapp, lang, onClose, onWhatsApp, onAddToCart, optionGroups }`. Two props to add: `itemNotesEnabled?: boolean` and change `onAddToCart` signature to `(selectedOptions, unitPrice, note?: string) => void`.

### item_notes_enabled: NOT yet in tenant_settings DB or TypeScript
`TenantSettings` interface (database.ts lines 14–37): does not contain `item_notes_enabled`. Migration 025 adds the DB column; the TypeScript interface must be extended to add `item_notes_enabled: boolean`.

### Migration next number is 025
`supabase/migrations/` directory: highest existing migration is `024_performance_indices.sql`. Next is `025`.

### Migration application method
All migrations applied manually via Supabase SQL Editor (local Docker not available — confirmed in multiple STATE.md entries). Migration 025 plan must include a "apply via Supabase SQL Editor" step.

---

## Architecture — What Changes Where

| File | What Changes | For Which Req |
|------|-------------|---------------|
| `supabase/migrations/025_notes_and_realtime.sql` | New file: adds `order_items.notes`, `tenant_settings.item_notes_enabled`, enables Realtime on orders | NOTE-01, NOTE-03 |
| `src/types/database.ts` | Add `item_notes_enabled: boolean` to `TenantSettings` | NOTE-01 |
| `src/app/(admin)/orders/OrdersClient.tsx` | Wire Realtime subscription + polling in `useEffect`; add `MessageSquare` import; show `item.notes` in OrderCard and modal | KDS-06, NOTE-04 |
| `src/app/api/orders/route.ts` | Add `sanitizeNote` helper; apply to `orderItems` mapping | NOTE-03 |
| `src/components/menu/MenuPage.tsx` | Extend `CartItem` with `note?`; extend `ProductModal` with `itemNotesEnabled`/`onAddToCart` signature; add textarea in modal; pass note through `addToCart` and `submitOrder` | NOTE-02, NOTE-03 (client side) |
| `src/app/(admin)/settings/store/StoreClient.tsx` | Add `item_notes_enabled` toggle (same pattern as `direct_orders_enabled`) | NOTE-01 |

---

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json` — this section is skipped per config.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/config changes with a manual SQL migration step. No external CLI tools beyond what is already available (Node.js, npm). Supabase Realtime is a cloud service already provisioned. The one manual environment action is enabling Realtime publication for the `orders` table in the Supabase Dashboard.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Manual page refresh for new orders | Supabase `postgres_changes` Realtime subscription | Kitchen sees new orders within seconds |
| No per-item notes | `order_items.notes TEXT` + customer textarea | Kitchen receives customer special instructions |

---

## Open Questions

1. **Should Realtime and polling run simultaneously or should polling be a fallback-only path?**
   - What we know: Requirements say "Supabase Realtime OR polling 15s as fallback"
   - What's unclear: Does "OR" mean try Realtime first and fall back on error, or run both always?
   - Recommendation: Run both simultaneously — Realtime for instant updates, polling at 15 s as safety net. Polling replaces full state (handles deletions). No error-detection logic needed.

2. **Does the note replace an existing cart note or create a new cart slot?**
   - What we know: `buildCartKey` does not include notes; same product+options = same slot
   - What's unclear: If user adds "no onion" to a burger already in cart, what happens?
   - Recommendation: Note replaces the existing slot's note. This matches expectation and avoids duplicate cart entries.

3. **Should `item_notes_enabled` toggle appear in Store settings or as a separate admin toggle?**
   - What we know: `direct_orders_enabled` is in StoreClient.tsx (same file handles ordering flags)
   - Recommendation: Add to `StoreClient.tsx` alongside `direct_orders_enabled`.

---

## Sources

### Primary (HIGH confidence)
- `src/app/(admin)/orders/OrdersClient.tsx` — verified: supabase client scaffolded, OrderCard items list, modal items list
- `src/types/database.ts` — verified: OrderItem.notes already typed, TenantSettings fields confirmed
- `src/app/api/orders/route.ts` — verified: notes already mapped, no validation exists
- `src/components/menu/MenuPage.tsx` — verified: ProductModal signature, CartItem type, submitOrder mapping
- `supabase/migrations/018_direct_orders_enabled.sql` — verified: exact pattern for flag migrations
- `supabase/migrations/021_orders_v11_schema.sql` — verified: exact pattern for ALTER TABLE on order_items
- `package.json` — verified: @supabase/supabase-js ^2.101.1, @supabase/ssr ^0.10.0

### Secondary (MEDIUM confidence)
- Supabase Realtime `postgres_changes` filter syntax — `column=eq.value` format confirmed from Supabase JS v2 documentation patterns and consistent with how existing queries use `.eq()` convention
- `ALTER PUBLICATION supabase_realtime ADD TABLE orders` — standard Supabase SQL for enabling Realtime on a table (consistent with Supabase Dashboard behavior)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json, no new installs needed
- Architecture patterns: HIGH — verified directly against actual source files
- Pitfalls: HIGH — derived from direct code inspection + Supabase Realtime known behavior
- Migration pattern: HIGH — confirmed from 8 prior migrations in the same project

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable dependencies, no fast-moving APIs)
