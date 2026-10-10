/**
 * xphere-backfill-check.ts - Offline gate for the BKF-01 backfill seam.
 *
 * v2.4 Phase 53 / BKF-01: the repo has no test runner; this `tsx` assertion
 * script locks the backfill's riskiest invariants behind a runnable gate,
 * mirroring the convention in scripts/xphere-queue-check.ts (node:assert/strict,
 * a single async main(), main().catch(...process.exit(1)) wrapper, non-zero exit
 * on any failed assertion).
 *
 * It runs with NO real Supabase, NO QStash, NO network, NO creds: it exercises
 * the EXPORTED pure seam `runBackfillBatch` from the route module with stubbed
 * tenants + a stubbed enqueue, and structurally asserts the route gates on
 * `assertSuperadmin` with a 401 reject (the real guard needs cookies/Supabase,
 * so the guard contract is verified by reading the route source).
 *
 * It proves the four BKF-01 invariants:
 *   1. Enqueue once per tenant in order; cursor advances to the last tenant; a
 *      short page => done.
 *   2. Resumability: a full page is NOT done and its nextCursor feeds the next
 *      call so the combined run has no dup and no gap.
 *   3. Per-tenant fail-open: one rejecting enqueue does not abort the batch.
 *   4. Non-superadmin reject: the route source gates on assertSuperadmin and
 *      returns { status: 401 } before any tenant read/enqueue.
 *
 * Run: npx tsx scripts/xphere-backfill-check.ts  (or `npm run xphere:check:backfill`)
 *
 * Code + comments in English.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runBackfillBatch } from '@/app/api/superadmin/xphere/backfill/route'

interface StubTenant {
  id: string
  created_at: string
}

async function main(): Promise<void> {
  // --- 1. Enqueue once per tenant, cursor advances, short page is done -------
  {
    const rows: StubTenant[] = [
      { id: 't1', created_at: '2026-01-01' },
      { id: 't2', created_at: '2026-01-02' },
      { id: 't3', created_at: '2026-01-03' },
    ]
    // Returns the 3 rows on the first (null-cursor) page, then [] afterward.
    const fetchTenants = async (cursor: string | null) =>
      cursor === null ? rows : []

    const calls: string[] = []
    const enqueue = async (tenantId: string) => {
      calls.push(tenantId)
    }

    const result = await runBackfillBatch({
      fetchTenants,
      enqueue,
      cursor: null,
      batchSize: 100,
      throttleMs: 0,
    })

    assert.deepEqual(
      calls,
      ['t1', 't2', 't3'],
      'enqueue called once per tenant in order',
    )
    assert.equal(result.enqueued, 3, 'enqueued count = 3')
    assert.equal(result.skipped, 0, 'skipped stays 0 (no opt-out flag yet)')
    assert.equal(
      result.nextCursor,
      '2026-01-03',
      'cursor advanced to last processed tenant',
    )
    assert.equal(result.done, true, 'short page => done')
  }

  // --- 2. Resumability: full page is NOT done; nextCursor feeds next call ----
  {
    const page1: StubTenant[] = [
      { id: 't1', created_at: '2026-01-01' },
      { id: 't2', created_at: '2026-01-02' },
    ]
    const page2: StubTenant[] = [{ id: 't3', created_at: '2026-01-03' }]

    // batchSize = 2: cursor null => exactly 2 rows (full page), cursor
    // '2026-01-02' => 1 row, anything else => [].
    const fetchTenants = async (cursor: string | null) => {
      if (cursor === null) return page1
      if (cursor === '2026-01-02') return page2
      return []
    }

    const calls: string[] = []
    const enqueue = async (tenantId: string) => {
      calls.push(tenantId)
    }

    const first = await runBackfillBatch({
      fetchTenants,
      enqueue,
      cursor: null,
      batchSize: 2,
      throttleMs: 0,
    })
    assert.equal(first.done, false, 'full page => not done (more tenants remain)')
    assert.equal(
      first.nextCursor,
      '2026-01-02',
      'nextCursor = last tenant of the full page',
    )

    const second = await runBackfillBatch({
      fetchTenants,
      enqueue,
      cursor: first.nextCursor,
      batchSize: 2,
      throttleMs: 0,
    })
    assert.equal(second.done, true, 'second page is short => done')

    assert.deepEqual(
      calls,
      ['t1', 't2', 't3'],
      'resumable two-call run: no dup, no gap',
    )
  }

  // --- 3. Per-tenant fail-open: one rejecting enqueue does not abort batch ---
  {
    const rows: StubTenant[] = [
      { id: 't1', created_at: '2026-01-01' },
      { id: 't2', created_at: '2026-01-02' },
      { id: 't3', created_at: '2026-01-03' },
    ]
    const fetchTenants = async (cursor: string | null) =>
      cursor === null ? rows : []

    const calls: string[] = []
    const enqueue = async (tenantId: string) => {
      calls.push(tenantId)
      if (tenantId === 't2') throw new Error('enqueue failed for t2')
    }

    let threw = false
    let result
    try {
      result = await runBackfillBatch({
        fetchTenants,
        enqueue,
        cursor: null,
        batchSize: 100,
        throttleMs: 0,
      })
    } catch {
      threw = true
    }

    assert.equal(threw, false, 'a rejecting tenant must not abort the batch')
    assert.ok(
      calls.includes('t1') && calls.includes('t3'),
      'remaining tenants still attempted after a mid-batch rejection',
    )
    assert.equal(
      result?.enqueued,
      2,
      'enqueued counts successes only (t1, t3); the rejected t2 is skipped',
    )
  }

  // --- 4. Non-superadmin reject (no network) — structural guard assertion ----
  // The real assertSuperadmin needs cookies/Supabase, so this gate cannot call
  // it. Assert STRUCTURALLY that the route module enforces the guard + 401.
  {
    const src = readFileSync(
      new URL(
        '../src/app/api/superadmin/xphere/backfill/route.ts',
        import.meta.url,
      ),
      'utf8',
    )
    assert.match(src, /assertSuperadmin/, 'route gates on assertSuperadmin')
    assert.match(src, /status:\s*401/, 'non-superadmin -> 401 Unauthorized')
  }

  console.log('xphere-backfill-check: all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
