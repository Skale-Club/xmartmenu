# Phase 21: KDS Dashboard - Research

**Researched:** 2026-05-08
**Domain:** React client component patterns — localStorage persistence, setInterval timer hook, optimistic UI, Tailwind CSS 4 grid, Next.js App Router client/server boundary
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KDS-01 | Admin vê pedidos em grid de cards — uma card por pedido com status colorido (pending=azul, preparing=amarelo, ready=verde, done=cinza, cancelled=vermelho) | Card grid layout patterns, status color mapping |
| KDS-02 | Cada card exibe: número do pedido, lista resumida de itens, total, tempo decorrido desde `created_at` | OrderWithItems type already satisfies all fields; elapsed-time computation from ISO string |
| KDS-03 | Timer de tempo decorrido atualiza a cada ~30s; chip fica âmbar >10min, vermelho >20min | useElapsedTime hook design, setInterval + cleanup, SSR-safe init |
| KDS-04 | Admin avança status do pedido diretamente no card (Pendente → Em preparo → Pronto → Concluído / Cancelado) | Existing PATCH /api/orders/[id] endpoint, optimistic UI pattern from existing updateStatus() |
| KDS-05 | Toggle grid/lista — grid = tablet de cozinha (cards grandes), lista = tabela atual mantida; preferência persiste em localStorage por tenant | localStorage init pattern for Next.js SSR, per-tenant key construction from tenantId prop |
</phase_requirements>

---

## Summary

Phase 21 is an almost pure frontend upgrade of `OrdersClient.tsx`. The server-side data pipeline (page.tsx → Supabase query → `initialOrders` prop), the PATCH API (`/api/orders/[id]`), and all TypeScript types are already in place. No new API endpoints or DB migrations are needed.

The three novel runtime behaviours are: (1) a self-ticking elapsed-time chip driven by `setInterval` inside a custom hook, (2) a grid/list toggle whose preference is saved to `localStorage` keyed by `tenantId`, and (3) inline status-advance buttons on each card that call the existing `updateStatus()` with an optimistic local update. All three patterns are standard React and have no framework-specific gotchas beyond SSR initialisation of `localStorage`.

**Primary recommendation:** Keep `OrdersClient.tsx` as the single component file. Extract a `useElapsedTime` hook into a co-located `useElapsedTime.ts`, add an `OrderCard` sub-component in the same file or as a sibling, and introduce a `KDS_VIEW_KEY` localStorage helper. Do not reach for external libraries for any of these; the codebase already satisfies all dependencies.

---

## Standard Stack

### Core (already installed — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.4 | `useState`, `useEffect`, `useCallback`, `useRef` | Already installed |
| Next.js | 16.2.2 | App Router client boundary (`'use client'`) | Already installed |
| TypeScript | ^5 | Type-safe `Order`, `OrderItem` from `@/types/database` | Already installed |
| Tailwind CSS | ^4 | Utility classes for grid, colors, animation | Already installed |
| lucide-react | ^1.7.0 | Icons (grid icon, list icon, clock icon) | Already installed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `setInterval` in `useEffect` | `requestAnimationFrame` | RAF is for animation frames (~16ms); 30s interval does not benefit from RAF; setInterval is simpler and lower CPU |
| Inline status buttons on card | Dropdown or swipe gesture | Swipe gesture adds touch-handler complexity; dropdown adds a UI layer; single primary action button matches existing modal pattern and tablet ergonomics |
| localStorage directly in component body | `useSyncExternalStore` | useSyncExternalStore eliminates SSR mismatch but adds complexity; a simple `useEffect` init pattern is sufficient for a single preference flag |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended File Structure

```
src/app/(admin)/orders/
├── page.tsx               # Server component — existing, pass tenantId as prop (add)
├── OrdersClient.tsx       # 'use client' — extend with grid/list toggle, card view
└── useElapsedTime.ts      # 'use client' hook — setInterval, returns minutes + color class
```

No additional directories. The `OrderCard` sub-component can live in `OrdersClient.tsx` directly.

### Pattern 1: Pass tenantId from Server Component

**What:** `page.tsx` currently only passes `initialOrders`. It must also pass `tenantId` for the localStorage key.

**Current page.tsx (lines 8-14):**
```typescript
// page.tsx — existing
const { tenantId } = (await getEffectiveTenant())!
const { data: orders } = await supabase
  .from('orders')
  .select('*, order_items(*)')
  .eq('tenant_id', tenantId)
  .order('created_at', { ascending: false })
return <OrdersClient initialOrders={orders ?? []} />
```

**Required change:**
```typescript
return <OrdersClient initialOrders={orders ?? []} tenantId={tenantId} />
```

Add `tenantId: string` to `OrdersClientProps`. This is the only change to `page.tsx`.

### Pattern 2: localStorage Toggle with SSR-Safe Init

**What:** `useState` initialised to a fallback value (`'grid'`); `useEffect` runs only in the browser to read from `localStorage`.

**Why SSR-safe init matters:** Next.js App Router renders client components on the server for the HTML shell. Accessing `localStorage` during render throws `ReferenceError: localStorage is not defined`. The `useEffect` pattern is the correct guard.

```typescript
// Source: React docs — useEffect for browser-only APIs
const KDS_VIEW_KEY = (tenantId: string) => `kds_view_${tenantId}`

const [view, setView] = useState<'grid' | 'list'>('grid')

useEffect(() => {
  const saved = localStorage.getItem(KDS_VIEW_KEY(tenantId))
  if (saved === 'grid' || saved === 'list') setView(saved)
}, [tenantId])

function toggleView(next: 'grid' | 'list') {
  setView(next)
  localStorage.setItem(KDS_VIEW_KEY(tenantId), next)
}
```

**Hydration note:** The initial server render always outputs `'grid'`. If the user previously chose `'list'`, they will see a brief flash of grid before `useEffect` runs. This is acceptable — it is identical to how every Next.js app handles persisted UI preferences. Do NOT use `suppressHydrationWarning` or `typeof window` checks in render; the `useEffect` pattern is sufficient.

### Pattern 3: useElapsedTime Hook

**What:** A custom hook that takes `createdAt: string` (ISO 8601) and returns `{ minutes: number; chipClass: string }`. It sets up a 30-second interval that re-computes elapsed time and triggers a re-render of just the chip.

**Design decisions:**
- The hook lives in `useElapsedTime.ts`, not inline, so `OrderCard` can import it cleanly.
- The interval is per-card (each `OrderCard` mounts its own hook). This is fine for typical KDS load (< 50 concurrent orders) — a single shared tick from a context provider would be premature optimisation.
- The interval ID is stored in a `useRef` (not `useState`) to avoid extra renders when setting/clearing it.

```typescript
// src/app/(admin)/orders/useElapsedTime.ts
'use client'

import { useEffect, useRef, useState } from 'react'

const AMBER_MINUTES = 10
const RED_MINUTES = 20

function computeMinutes(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)
}

export function useElapsedTime(createdAt: string) {
  const [minutes, setMinutes] = useState(() => computeMinutes(createdAt))
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Re-compute immediately in case server render used stale value
    setMinutes(computeMinutes(createdAt))

    intervalRef.current = setInterval(() => {
      setMinutes(computeMinutes(createdAt))
    }, 30_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [createdAt])

  const chipClass =
    minutes >= RED_MINUTES
      ? 'bg-red-100 text-red-700'
      : minutes >= AMBER_MINUTES
        ? 'bg-amber-100 text-amber-700'
        : 'bg-zinc-100 text-zinc-600'

  return { minutes, chipClass }
}
```

**SSR safety:** `useState(() => computeMinutes(createdAt))` runs during server render (fine — it only reads `Date.now()` and parses a string; no browser API). The `setInterval` only starts inside `useEffect` which is browser-only.

**React 19 note:** No change to this pattern in React 19. `useEffect` cleanup behaviour is unchanged.

### Pattern 4: Optimistic Status Advance on Card

**What:** Each card has a single "next status" button. Clicking it calls the existing `updateStatus(orderId, nextStatus)` from the component. The existing `updateStatus` already does optimistic update via `setOrders(prev => prev.map(...))`.

**Status transition map (PT-BR labels and next status):**

```typescript
const STATUS_LABELS: Record<string, string> = {
  pending:   'Pendente',
  preparing: 'Em preparo',
  ready:     'Pronto',
  done:      'Concluído',
  cancelled: 'Cancelado',
}

const NEXT_STATUS: Record<string, string | null> = {
  pending:   'preparing',
  preparing: 'ready',
  ready:     'done',
  done:      null,       // terminal — no advance button
  cancelled: null,       // terminal — no advance button
}

const ADVANCE_LABEL: Record<string, string> = {
  pending:   'Iniciar preparo',
  preparing: 'Marcar pronto',
  ready:     'Concluir',
}
```

Cancel button appears for `pending` and `preparing` only (matches existing modal logic).

**Button UX on card:** One primary `Advance` button (full-width at card bottom) + a small `Cancelar` link/button visible only for `pending`/`preparing`. Matching the existing modal action pattern but surfaced directly on the card — no modal required.

**Loading state:** The existing `loading` boolean in `OrdersClient` is shared across all orders. This works but blocks all buttons while one PATCH is in-flight. The safer pattern per card is a `loadingId: string | null` state (set to `orderId` while patching, reset to `null` when done). This prevents blocking unrelated cards.

```typescript
const [loadingId, setLoadingId] = useState<string | null>(null)

async function updateStatus(orderId: string, status: string) {
  setLoadingId(orderId)
  const res = await fetch(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, status }),
  })
  const data = await res.json()
  if (res.ok) {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: data.status } : o))
    )
  }
  setLoadingId(null)
}
```

### Pattern 5: Status Color System for Cards

**What:** The existing `statusColors` maps to light pill styles (`bg-yellow-100 text-yellow-800`). For KDS cards, the color system should use a card-level accent (left border or card background tint) rather than only a badge, to make status legible at a glance from a distance (kitchen environment).

**Recommended approach:** Left border accent (4px) + light background tint on the card + a pill badge. This is the standard KDS pattern.

```typescript
const STATUS_COLORS: Record<string, {
  border: string    // card left border
  bg: string        // card background tint
  badge: string     // pill badge
  label: string     // PT-BR
}> = {
  pending:   { border: 'border-l-blue-500',   bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-800',   label: 'Pendente' },
  preparing: { border: 'border-l-yellow-500', bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800', label: 'Em preparo' },
  ready:     { border: 'border-l-green-500',  bg: 'bg-green-50',  badge: 'bg-green-100 text-green-800',  label: 'Pronto' },
  done:      { border: 'border-l-zinc-400',   bg: 'bg-zinc-50',   badge: 'bg-zinc-100 text-zinc-600',    label: 'Concluído' },
  cancelled: { border: 'border-l-red-500',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-800',      label: 'Cancelado' },
}
```

**REQUIREMENTS.md note:** KDS-01 specifies `pending=azul, preparing=amarelo, ready=verde, done=cinza, cancelled=vermelho`. The mapping above satisfies this. The existing `statusColors` has `preparing=blue` and `pending=yellow` which is inverted from the requirements — Phase 21 must correct this inversion.

**Contrast for kitchen environments:** Kitchen tablets are often in bright/ambient light. Use `border-l-4` (not `border-l-2`) so the accent is clearly visible.

### Pattern 6: Tailwind CSS 4 Grid — Responsive Breakpoints for Tablet

**What:** Tailwind CSS 4 uses the same responsive prefix syntax as v3 (`sm:`, `md:`, `lg:`). No config file — breakpoints use CSS media queries directly.

**Default breakpoints (unchanged from v3):**
- `sm` = 640px
- `md` = 768px
- `lg` = 1024px
- `xl` = 1280px

**Recommended grid for a 10" tablet (768-1024px):**

```tsx
// Grid view — 1 col on mobile, 2 on tablet, 3 on desktop
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
  {orders.map((order) => <OrderCard key={order.id} order={order} ... />)}
</div>
```

This gives kitchen tablets in landscape (768–1024px wide) exactly 2 columns — large enough to read at a glance, small enough to show multiple orders.

**Card min-height:** Use `min-h-[200px]` or let content size naturally. Avoid fixed heights — order item lists vary.

**Tailwind CSS 4 gotcha:** There is no `tailwind.config.js`. All customisation goes in `globals.css` under `@theme`. The above classes are all standard Tailwind utilities and do not require configuration.

### Anti-Patterns to Avoid

- **Do not read `localStorage` in render body or `useState` initial value callback with `typeof window`.** The correct pattern is `useState('grid')` + `useEffect` read. `typeof window !== 'undefined'` checks in render can cause hydration mismatches in React 19 concurrent mode.
- **Do not use a shared `loading: boolean` state across all cards.** Replace with `loadingId: string | null` to allow parallel card interactions.
- **Do not use `requestAnimationFrame` for the 30-second tick.** RAF runs at display refresh rate (60fps); using it for a 30-second interval requires manual delta accumulation and is CPU-wasteful.
- **Do not put the setInterval in a `useCallback` without including it in `useEffect` deps.** The `useEffect` must re-run when `createdAt` changes (unlikely but possible if orders are updated with a new timestamp).
- **Do not create a new `createClient()` call for the status update.** The existing `updateStatus` uses `fetch()` to the REST API — this is correct. A direct Supabase client call from the browser would bypass the server-side RLS audit trail.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status PATCH endpoint | New API route | Existing `/api/orders/[id]` PATCH | Already validates status, updates `updated_at`, returns `{id, status}` |
| Order type definitions | Inline interfaces | `Order`, `OrderItem` from `@/types/database` | Already typed with correct union for `status` |
| Elapsed time formatting | Manual `floor/mod` arithmetic | Simple `Math.floor(ms / 60_000)` + display string | No library needed — complexity is trivial |
| Status label translation | Translation file | Inline `STATUS_LABELS` const | Only 5 values, PT-BR only, out of scope to externalise |
| Grid icon / List icon | SVG paths | `lucide-react` `LayoutGrid` and `List` icons | Already installed at ^1.7.0 |

---

## Common Pitfalls

### Pitfall 1: Status Color Inversion (existing code vs requirements)
**What goes wrong:** The existing `statusColors` in `OrdersClient.tsx` (lines 9-15) maps `pending → yellow` and `preparing → blue`. KDS-01 requires `pending=azul (blue), preparing=amarelo (yellow)`. If the planner keeps the existing mapping without correcting it, the KDS card colors will be wrong.
**Why it happens:** The existing mapping was written before the KDS requirements were formalised.
**How to avoid:** Replace `statusColors` entirely with the new `STATUS_COLORS` constant defined in Pattern 5 above. The pill badge in the existing table view should also be updated to stay consistent.
**Warning signs:** "Pedido pendente" showing yellow chip instead of blue.

### Pitfall 2: localStorage Access During SSR
**What goes wrong:** `localStorage.getItem(...)` in component body or `useState` initialiser throws `ReferenceError: localStorage is not defined` on the server.
**Why it happens:** Next.js App Router renders client components server-side for the HTML shell (RSC prerender). `localStorage` does not exist in the Node.js runtime.
**How to avoid:** Always wrap `localStorage` access in `useEffect`. Never use `typeof window !== 'undefined'` in render — it causes hydration mismatches.
**Warning signs:** `ReferenceError: localStorage is not defined` in server logs, or a console warning about hydration mismatch.

### Pitfall 3: Memory Leak from Missing setInterval Cleanup
**What goes wrong:** Each `OrderCard` (or component that uses `useElapsedTime`) mounts an interval. If the cleanup function is not returned from `useEffect`, the interval continues firing after the card is unmounted (e.g., when an order is marked done and removed from the list, or on navigation away from the orders page).
**Why it happens:** `useEffect` does not auto-clean intervals.
**How to avoid:** Always return `() => clearInterval(intervalRef.current)` from the `useEffect`. The hook template in Pattern 3 above includes this.
**Warning signs:** React DevTools showing `Can't perform a React state update on an unmounted component` warning (React 18 removed the warning but the underlying bug still causes stale closures).

### Pitfall 4: tenantId Not Passed to OrdersClient
**What goes wrong:** `localStorage` key becomes `kds_view_undefined`, which means every tenant shares the same preference slot — or worse, the key is never written if the code checks for a truthy `tenantId`.
**Why it happens:** `page.tsx` currently does not pass `tenantId` to `<OrdersClient />`. It is only used internally for the Supabase query.
**How to avoid:** Add `tenantId={tenantId}` prop to `<OrdersClient />` in `page.tsx` (one-line change) and add `tenantId: string` to `OrdersClientProps`.
**Warning signs:** All tenants sharing the same view preference; `localStorage` key showing `kds_view_undefined`.

### Pitfall 5: Tailwind CSS 4 Purging Dynamic Class Strings
**What goes wrong:** If the status-specific Tailwind classes are assembled dynamically (e.g., `` `border-l-${color}-500` ``), Tailwind's content scanner cannot detect them and the classes are purged from the production CSS bundle.
**Why it happens:** Tailwind CSS scans source files for static class strings. Template literals that compose class names at runtime are invisible to the scanner.
**How to avoid:** Always use complete class strings in the `STATUS_COLORS` constant (as shown in Pattern 5 — all classes spelled out in full). Never interpolate color names into Tailwind class strings.
**Warning signs:** Cards showing no border color in production (`next build`) but correct colors in development (`next dev`).

### Pitfall 6: Shared `loading` State Blocks Multiple Cards
**What goes wrong:** If the user quickly taps "Iniciar preparo" on card A, then taps "Concluir" on card B before the first PATCH returns, the shared `loading: boolean` state disables card B's button even though card A's request is in-flight.
**Why it happens:** The existing `loading` boolean is global to the component.
**How to avoid:** Replace with `loadingId: string | null` (Pattern 4 above). Only the card whose PATCH is in-flight shows a disabled button.

---

## Code Examples

### Minimal OrderCard skeleton

```tsx
// Inside OrdersClient.tsx
function OrderCard({
  order,
  loadingId,
  onAdvance,
  onCancel,
}: {
  order: OrderWithItems
  loadingId: string | null
  onAdvance: (id: string, status: string) => void
  onCancel: (id: string) => void
}) {
  const { minutes, chipClass } = useElapsedTime(order.created_at)
  const colors = STATUS_COLORS[order.status]
  const nextStatus = NEXT_STATUS[order.status]
  const isLoading = loadingId === order.id

  return (
    <div className={`rounded-lg border border-zinc-200 border-l-4 ${colors.border} ${colors.bg} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-500">#{order.id.slice(0, 8)}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}>
          {colors.label}
        </span>
      </div>

      {/* Customer */}
      <div>
        <p className="text-sm font-semibold text-zinc-900">{order.customer_name}</p>
        <p className="text-xs text-zinc-500">{order.customer_phone}</p>
      </div>

      {/* Items summary */}
      <ul className="text-xs text-zinc-700 space-y-0.5">
        {order.order_items.map((item, i) => (
          <li key={i}>{item.quantity}x {item.product_name}</li>
        ))}
      </ul>

      {/* Footer: total + elapsed */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-zinc-200">
        <span className="text-sm font-bold text-zinc-900">R$ {order.total.toFixed(2)}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${chipClass}`}>
          {minutes}min
        </span>
      </div>

      {/* Actions */}
      {nextStatus && (
        <button
          onClick={() => onAdvance(order.id, nextStatus)}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
        >
          {isLoading ? '...' : ADVANCE_LABEL[order.status]}
        </button>
      )}
      {(order.status === 'pending' || order.status === 'preparing') && (
        <button
          onClick={() => onCancel(order.id)}
          disabled={isLoading}
          className="w-full text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      )}
    </div>
  )
}
```

### View toggle buttons

```tsx
// View toggle in OrdersClient header
<div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-0.5">
  <button
    onClick={() => toggleView('grid')}
    className={`p-1.5 rounded ${view === 'grid' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'}`}
    aria-label="Visualização em grade"
  >
    <LayoutGrid size={16} />
  </button>
  <button
    onClick={() => toggleView('list')}
    className={`p-1.5 rounded ${view === 'list' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'}`}
    aria-label="Visualização em lista"
  >
    <List size={16} />
  </button>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | Impact for Phase 21 |
|--------------|------------------|---------------------|
| Class components with `componentDidMount/componentWillUnmount` for intervals | `useEffect` with cleanup return | Use `useEffect` — no class components |
| `window.localStorage` with `typeof window` guard in render | `useEffect` for browser-only APIs | Pattern 2 above |
| Shared global loading boolean | Per-item loading ID | Pattern 4 (`loadingId` string) |
| `requestAnimationFrame` for polling | `setInterval` for coarse intervals (> 1s) | Use `setInterval` for 30s tick |

---

## Open Questions

1. **Should `done` and `cancelled` orders appear in the KDS grid?**
   - What we know: Requirements do not explicitly exclude them. The existing table shows all orders regardless of status.
   - What's unclear: In a real kitchen, completed orders cluttering the board is a usability problem.
   - Recommendation: Show all statuses in Phase 21 (no filter). Phase 22 deferred filter (out-of-scope per REQUIREMENTS.md) will address this. Planner should note this as a deferred concern.

2. **Where does `ORDER_ID` display — short UUID prefix or a sequential human-readable number?**
   - What we know: Existing table shows `order.id.slice(0, 8)` (hex UUID prefix).
   - What's unclear: Kitchen staff may prefer sequential numbers like #1, #2.
   - Recommendation: Keep `order.id.slice(0, 8)` in Phase 21. A sequential counter would require a DB sequence or order-count query — out of scope.

3. **Does `page.tsx` need to pass `tenantId` to `OrdersClient` or can `OrdersClient` derive it from Supabase auth?**
   - What we know: `page.tsx` already calls `getEffectiveTenant()` and has `tenantId` in scope. Passing it as a prop is one line.
   - Recommendation: Pass as prop (simplest, no extra client-side auth call).

---

## Environment Availability

Step 2.6: SKIPPED — Phase 21 is entirely frontend (React components, Tailwind CSS, localStorage). No external tools, CLI utilities, databases, or services beyond what is already running are required. The existing Supabase project and Next.js dev server serve all needs.

---

## Validation Architecture

Step 4: SKIPPED — `workflow.nyquist_validation` is `false` in `.planning/config.json`.

---

## Sources

### Primary (HIGH confidence)
- React docs (react.dev) — `useEffect` cleanup, interval pattern, browser-only API access
- Tailwind CSS 4 official docs — grid utilities, breakpoints, content scanning for class purging
- Direct codebase inspection — `OrdersClient.tsx`, `page.tsx`, `/api/orders/[id]/route.ts`, `database.ts` types

### Secondary (MEDIUM confidence)
- Next.js App Router docs — client component server render behaviour, hydration, `'use client'` boundary
- Tailwind CSS 4 migration guide — no config file, `@import "tailwindcss"` pattern confirmed in `globals.css`

### Tertiary (LOW confidence)
- None — all findings verified against codebase or official documentation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, versions confirmed in `package.json`
- Architecture: HIGH — patterns derived directly from existing code in the repo; no speculative choices
- Pitfalls: HIGH — each pitfall is grounded in a concrete code observation (existing status color inversion, missing tenantId prop, Tailwind purging behaviour)

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable domain — React hooks, Tailwind, Next.js App Router)
