---
phase: 22-realtime-per-item-notes
verified: 2026-05-08T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 22: Realtime + Per-Item Notes Verification Report

**Phase Goal:** New orders appear automatically on the KDS without manual refresh, and customers can attach per-item notes that flow through to the kitchen card and admin orders table
**Verified:** 2026-05-08
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A new order appears on KDS within 15s without manual refresh | VERIFIED | `OrdersClient.tsx` line 138–170: Realtime `postgres_changes` INSERT subscription on `orders` table filtered by `tenant_id`; `removeChannel` cleanup on unmount. Line 172–182: `setInterval(15_000)` polling fallback via `/api/orders?tenant_id=` with `clearInterval` cleanup. |
| 2 | KDS OrderCard shows per-item notes with MessageSquare icon + italic styling when notes exist | VERIFIED | `OrdersClient.tsx` lines 79–89: `{item.notes && (<span className="text-xs text-zinc-500 italic flex items-center gap-1"><MessageSquare size={10} .../>{item.notes}</span>)}` inside `<li>` flex-column per item. `MessageSquare` imported line 7. |
| 3 | Admin list-view modal shows per-item notes with same icon+italic treatment | VERIFIED | `OrdersClient.tsx` lines 333–338: identical `{item.notes && (<span className="text-xs text-zinc-500 italic flex items-center gap-1 mt-0.5"><MessageSquare size={10} .../>{item.notes}</span>)}` inside the `selectedOrder.order_items?.map()` modal block. |
| 4 | Customer sees Observações textarea (max 140, live counter) gated by item_notes_enabled, note flows to API | VERIFIED | `MenuPage.tsx`: `CartItem.note?: string` field (line 68); `addToCart` accepts 4th `note` arg (line 144); `submitOrder` maps `notes: item.note \|\| undefined` (line 201); `ProductModal` accepts `itemNotesEnabled` prop (line 754/759), renders textarea conditionally (lines 1109–1125) with `maxLength={140}`, `{itemNote.length}/140` counter, PT-BR label "Observações"; `itemNote` state resets in `useEffect([product.id])` (line 782); Add-to-cart button passes `itemNote \|\| undefined` as 3rd arg (line 1172). |
| 5 | Admin can toggle item_notes_enabled in Store Settings; flag persists to DB | VERIFIED | `StoreClient.tsx`: `item_notes_enabled: settings?.item_notes_enabled ?? false` in form state (line 52); "Ordering" section with toggle button renders `translate-x-6`/`translate-x-1` literal classes (lines 176–193); `handleSave` upserts `...form` spread at line 74, which includes `item_notes_enabled` automatically. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/025_notes_and_realtime.sql` | Migration with 3 ALTER statements | VERIFIED | All three present: `ADD COLUMN IF NOT EXISTS item_notes_enabled BOOLEAN NOT NULL DEFAULT false` (line 11), `ADD COLUMN IF NOT EXISTS notes TEXT` (line 15), `ALTER PUBLICATION supabase_realtime ADD TABLE orders` (line 19). |
| `src/types/database.ts` | `TenantSettings.item_notes_enabled: boolean` | VERIFIED | Line 32: `item_notes_enabled: boolean  // NOTE-01: per-item notes feature flag (migration 025)` inserted after `direct_orders_enabled: boolean`. |
| `src/app/(admin)/orders/OrdersClient.tsx` | Realtime sub + 15s polling + notes display + removeChannel | VERIFIED | Substantive: 398 lines. Wired: `MessageSquare` imported and used in 2 locations (OrderCard + modal). Realtime channel `orders-realtime-${tenantId}` lines 138–170. Polling `setInterval(15_000)` lines 172–182. Notes display in both OrderCard (line 82–87) and modal (lines 333–338). |
| `src/app/(admin)/settings/store/StoreClient.tsx` | item_notes_enabled toggle in Ordering section | VERIFIED | Substantive: 206 lines. Form state includes `item_notes_enabled` (line 52). Ordering section toggle button at lines 176–193 with PT-BR labels. Upsert via `...form` spread at line 74. |
| `src/components/menu/MenuPage.tsx` | CartItem.note, textarea UI, addToCart wiring, submitOrder notes mapping | VERIFIED | `CartItem.note?: string` (line 68); `addToCart` 4th arg (line 144); `submitOrder` notes mapping (line 201); `ProductModal` textarea gated by `itemNotesEnabled` (lines 1109–1125); call site passes `itemNotesEnabled={settings?.item_notes_enabled ?? false}` (line 604); `onAddToCart` forwards `note` (lines 605–609). |
| `src/app/api/orders/route.ts` | sanitizeNote function applied to item.notes | VERIFIED | `sanitizeNote` defined lines 20–27: strips `\x00-\x08\x0B-\x1F\x7F`, trims, caps at 140. Applied at line 90: `notes: sanitizeNote(item.notes)`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| OrdersClient Realtime INSERT handler | `supabase.from('orders').select('*, order_items(*)')` | Follow-up query on `payload.new.id` before prepending to state | WIRED | Lines 151–155: `supabase.from('orders').select('*, order_items(*)')` fetched on INSERT payload, result prepended idempotently. |
| OrdersClient polling useEffect | `/api/orders?tenant_id=` | `setInterval(15_000)` fetch with `clearInterval` cleanup | WIRED | Lines 173–182: `setInterval(async () => { const res = await fetch('/api/orders?tenant_id=${tenantId}') ... }, 15_000)` with `clearInterval(id)` in cleanup. |
| ProductModal onAddToCart callback | `addToCart(product, selectedOptions, unitPrice, note)` | 4th arg added to callback at call site | WIRED | Lines 605–609: `(selectedOptions, unitPrice, note) => { addToCart(selectedProduct, selectedOptions, unitPrice, note) }` — note forwarded correctly. |
| addToCart function | CartItem.note | note stored on cart slot, replaces existing note on same cartKey | WIRED | Lines 144–155: new slot gets `note` (line 154); existing slot gets `note: note ?? item.note` (line 151). note excluded from `buildCartKey`. |
| submitOrder items mapping | `notes: item.note` | Each cart item's note passed as notes field in POST body | WIRED | Line 201: `notes: item.note \|\| undefined  // NOTE-02: pass note to API` inside `cart.map(item => ({...}))`. |
| orders POST route | `sanitizeNote(item.notes)` | sanitizeNote helper strips control chars, trims, caps at 140 | WIRED | Line 90: `notes: sanitizeNote(item.notes)` in `orderItems.map`. sanitizeNote defined lines 20–27. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| OrdersClient.tsx (Realtime) | `orders` state | Realtime INSERT → follow-up `supabase.from('orders').select('*, order_items(*)')` | Yes — DB query on real order id from payload | FLOWING |
| OrdersClient.tsx (polling) | `orders` state | `fetch('/api/orders?tenant_id=')` → GET handler queries `orders` with `select('*, order_items(*)')` | Yes — DB query returns real rows | FLOWING |
| MenuPage.tsx (textarea) | `itemNote` state | `useState('')` + `setItemNote(e.target.value.slice(0, 140))` → passed as arg to `addToCart` → `CartItem.note` → `submitOrder` POST body | Yes — user input flows through cart and POST | FLOWING |
| StoreClient.tsx (toggle) | `form.item_notes_enabled` | `useState(settings?.item_notes_enabled ?? false)` → toggle click → `supabase.from('tenant_settings').upsert({...form})` | Yes — DB upsert with real value | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — the app requires a running Next.js dev server and Supabase connection. No runnable entry points testable without starting services. Manual verification steps provided in Human Verification section.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| KDS-06 | 22-01 | Novos pedidos aparecem sem reload manual — Realtime subscription ou polling 15s como fallback | SATISFIED | Realtime `postgres_changes` subscription + `setInterval(15_000)` both active in OrdersClient; `removeChannel` and `clearInterval` cleanups present. |
| NOTE-01 | 22-02 | Tenant habilita notas por item via `item_notes_enabled` boolean | SATISFIED | `item_notes_enabled` in StoreClient form state; Ordering toggle section persists via upsert; TenantSettings type has `item_notes_enabled: boolean`; migration 025 adds DB column. |
| NOTE-02 | 22-02 | Cliente vê textarea "Observações" no modal de produto, max 140 chars com contador, quando flag ativada | SATISFIED | `ProductModal` renders textarea conditionally on `itemNotesEnabled`; `maxLength={140}`; `.slice(0,140)` client guard; `{itemNote.length}/140` counter; PT-BR label "Observações". Call site passes `settings?.item_notes_enabled ?? false`. |
| NOTE-03 | 22-02 | Nota salva em `order_items.notes TEXT` — validada e truncada server-side; strip de control chars | SATISFIED | Migration 025 adds `notes TEXT` column; `sanitizeNote` strips `\x00-\x08\x0B-\x1F\x7F`, trims, caps at 140; applied at `notes: sanitizeNote(item.notes)` in POST route. |
| NOTE-04 | 22-01 | KDS card e tabela admin orders renderizam nota por item de forma visualmente destacada | SATISFIED | OrderCard: italic + `MessageSquare size={10}` per item. Admin modal: same treatment. Both conditional on `item.notes` being truthy. |

All 5 requirement IDs from plan frontmatter accounted for. No orphaned requirements found in REQUIREMENTS.md for Phase 22.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No stubs, placeholders, or empty implementations found in any phase 22 file. |

Checked all modified files for: TODO/FIXME/PLACEHOLDER comments, `return null`, empty handler bodies, hardcoded empty arrays/objects passed to rendering paths. None found. The `note?: string` optional field on CartItem defaults to `undefined` (not an empty stub — `addToCart` populates it from user input).

---

### Human Verification Required

#### 1. Realtime delivery end-to-end

**Test:** With migration 025 applied in Supabase and KDS open in one browser tab, submit a new order from the public menu in another tab.
**Expected:** The new order card appears on the KDS within ~3 seconds (Realtime) without any page refresh. If Realtime is not configured in the Supabase project, it should appear within 15 seconds (polling fallback).
**Why human:** Requires live Supabase Realtime connection and cannot be verified statically.

#### 2. Realtime publication confirmed in Supabase dashboard

**Test:** Open Supabase Dashboard > Database > Replication and check the `supabase_realtime` publication.
**Expected:** The `orders` table appears in the publication list.
**Why human:** Migration 025 must be manually applied via SQL Editor; cannot be verified from codebase alone.

#### 3. Per-item notes visible on KDS card and admin modal

**Test:** Enable `item_notes_enabled` in Store Settings. Open a product modal on the public menu, type a note (e.g. "sem gelo"), add to cart and submit order. Then check KDS card and admin orders list modal.
**Expected:** The note appears under the item in the KDS card with MessageSquare icon and italic text. Same treatment in the admin modal.
**Why human:** Requires live UI rendering and database write to verify the full visual round-trip.

#### 4. Character counter and hard cap at 140

**Test:** In the ProductModal textarea, paste/type more than 140 characters.
**Expected:** Counter stops at 140 (shows "140/140") and no additional characters are accepted.
**Why human:** Client-side input behavior requires manual UI interaction.

#### 5. Note gate: textarea absent when flag is off

**Test:** Disable `item_notes_enabled` in Store Settings. Open a product modal on the public menu.
**Expected:** No "Observações" textarea appears.
**Why human:** Requires verifying conditional render via actual UI.

---

### Gaps Summary

No gaps found. All 5 observable truths are verified, all 6 artifacts pass all four levels (exist, substantive, wired, data flowing), all 6 key links are wired, and all 5 requirement IDs are satisfied. The implementation matches the plan specification exactly.

The only pending item is human confirmation that migration 025 has been applied to the live Supabase project — this is a deployment prerequisite, not a code gap.

---

_Verified: 2026-05-08_
_Verifier: Claude (gsd-verifier)_
