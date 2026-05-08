---
phase: 14-instrumentacao
plan: 02
subsystem: instrumentation
tags: [performance, console-time, vercel-logs, temporary-probes]
status: checkpoint-pending
checkpoint_task: 2
dependency_graph:
  requires: []
  provides: [timing-values-for-14-baseline]
  affects: [14-03-PLAN]
tech_stack:
  added: []
  patterns: [console.time/timeEnd wrapping async DB calls]
key_files:
  modified:
    - src/app/(public)/[slug]/[menuSlug]/page.tsx
    - src/app/(public)/[slug]/page.tsx
    - src/app/api/orders/route.ts
decisions:
  - console.time probes placed at route-handler level (not getTenantBySlug internal) so timing includes cache miss round-trips
  - [menuSlug]/page.tsx: two probe pairs covering parallel tenant+menu fetch, then parallel categories+products fetch
  - [slug]/page.tsx: two probe pairs covering getTenantBySlug then default menu maybeSingle()
  - orders/route.ts: three probe pairs covering tenant validate, order insert, and order_items bulk insert
metrics:
  duration: partial
  completed_date: "2026-05-07"
  tasks_completed: 1
  tasks_total: 2
  files_modified: 3
---

# Phase 14 Plan 02: Timing Probes — Partial Summary (Checkpoint)

**One-liner:** Temporary `console.time()` probes deployed to 3 production server-side paths; awaiting human to capture Vercel log timings before probe removal.

## Status: CHECKPOINT — Awaiting Human Verification (Task 2)

Task 1 is complete. Task 2 requires the human to visit production routes, read Vercel function logs, and provide timing values so probes can be removed.

## Task 1 Complete: Probes Added and Deployed

**Commit:** `070cefa` — `temp(perf-02): add console.time probes for baseline measurement`

**Probes added:**

| File | Label | Wraps |
|------|-------|-------|
| `[menuSlug]/page.tsx` | `perf:menu-slug:tenant-lookup` | `Promise.all([getTenantBySlug, menus.select])` |
| `[menuSlug]/page.tsx` | `perf:menu-slug:categories-products` | `Promise.all([categories.select, products.select])` |
| `[slug]/page.tsx` | `perf:menu-tenant:lookup` | `getTenantBySlug(slug)` |
| `[slug]/page.tsx` | `perf:menu-tenant:default-menu` | `menus.select.maybeSingle()` |
| `orders/route.ts` | `perf:orders-post:tenant-validate` | `tenants.select.single()` |
| `orders/route.ts` | `perf:orders-post:insert` | `orders.insert.select.single()` |
| `orders/route.ts` | `perf:orders-post:insert-items` | `order_items.insert` |

Build verified: `npm run build` exits 0, no TypeScript errors introduced.

## Task 2 Pending: Record Timings and Remove Probes

### What the human must do

1. Wait for Vercel deploy to complete (check https://vercel.com/dashboard — xmartmenu project)

2. Trigger the public menu route in a browser:
   - Visit `https://xmartmenu.skale.club/[tenant-slug]/[menu-slug]`

3. Trigger the tenant landing route:
   - Visit `https://xmartmenu.skale.club/[tenant-slug]`

4. Optionally trigger orders:
   - Submit a test order via the public menu cart, OR send a POST to `/api/orders`
   - If not possible, note "N/A" for orders labels

5. In Vercel Logs (Functions tab), filter by "perf:" and record values:
   ```
   perf:menu-slug:tenant-lookup: NNms
   perf:menu-slug:categories-products: NNms
   perf:menu-tenant:lookup: NNms
   perf:menu-tenant:default-menu: NNms
   perf:orders-post:tenant-validate: NNms (or N/A)
   perf:orders-post:insert: NNms (or N/A)
   perf:orders-post:insert-items: NNms (or N/A)
   Speed Insights: [real data or "no data yet"]
   ```

6. Also check Vercel Speed Insights tab for real-traffic p75 CWV data.

### Resume signal

Reply with "TIMINGS RECORDED" followed by the timing values above.
Claude will then remove all PERF-PROBE lines from the 3 files, commit, and push.

## Timing Values (to be filled after Task 2)

```
perf:menu-slug:tenant-lookup: [PENDING]
perf:menu-slug:categories-products: [PENDING]
perf:menu-tenant:lookup: [PENDING]
perf:menu-tenant:default-menu: [PENDING]
perf:orders-post:tenant-validate: [PENDING]
perf:orders-post:insert: [PENDING]
perf:orders-post:insert-items: [PENDING]
Speed Insights p75: [PENDING]
```

## Deviations from Plan

None — plan executed exactly as written for Task 1.

## Known Stubs

None — this is measurement instrumentation only, no UI stubs.

## Self-Check: PASSED

- [x] `src/app/(public)/[slug]/[menuSlug]/page.tsx` — modified with 4 PERF-PROBE lines
- [x] `src/app/(public)/[slug]/page.tsx` — modified with 4 PERF-PROBE lines
- [x] `src/app/api/orders/route.ts` — modified with 6 PERF-PROBE lines
- [x] Build passes: `npm run build` exits 0
- [x] Commit `070cefa` exists: `temp(perf-02): add console.time probes for baseline measurement`
- [x] Pushed to `origin/main` — Vercel deploy triggered
- [ ] Task 2: timing values not yet recorded (checkpoint pending)
- [ ] Task 2: probes not yet removed (checkpoint pending)
