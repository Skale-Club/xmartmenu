/**
 * backfill/route.ts - BKF-01: superadmin-only, throttled, resumable, idempotent
 * one-time (re-runnable) Xphere CRM hydration of EXISTING tenants.
 *
 * v2.4 Phase 53 / BKF-01: this route does NOT contain any CRM sync logic. It
 * paginates the `tenants` table and fans out the SAME Phase 52 producer
 * (`enqueueXphereSync(id, 'backfill')`) once per tenant, so the backfill inherits
 * every idempotency/retry/fail-open guarantee of the existing
 * producer -> worker path with zero new sync code.
 *
 * - Resumable: keyset pagination on `created_at` (ascending). A `?cursor=` param
 *   starts AFTER that value; the response returns `{ nextCursor, done }` so a
 *   re-invocation continues exactly where it left off (no OFFSET drift, no gap,
 *   no dup).
 * - Throttled: a small delay between per-tenant enqueues so the fan-out never
 *   stampedes the rate-limited `/api/v1/sync` worker.
 * - Idempotent: the worker upserts by `external_id` (= tenants.id), and reason
 *   'backfill' emits NO timeline note (mapping.ts omits the note dedup_id), so
 *   re-running the backfill never double-posts.
 * - Per-tenant fail-open: `enqueueXphereSync` already swallows, and the loop
 *   guards too so one failing tenant never aborts the batch.
 * - Ships dark: when QSTASH/XPHERE env is unset, `enqueueXphereSync` is a silent
 *   no-op, so running the backfill before credentials land is harmless.
 *
 * Superadmin-only (SEC-03 `assertSuperadmin`). Code + comments in English.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { enqueueXphereSync } from '@/lib/xphere/queue'

const BATCH_SIZE = 100 // tenants enqueued per invocation page
const THROTTLE_MS = 50 // delay between per-tenant enqueues to avoid stampeding /api/v1/sync

/** Minimal tenant row the backfill needs — id to enqueue, created_at as cursor. */
interface BackfillTenant {
  id: string
  created_at: string
}

/** Keyset page reader — returns up to `limit` tenants after `cursor` (ascending). */
type TenantFetcher = (
  cursor: string | null,
  limit: number,
) => Promise<BackfillTenant[]>

/** Single-tenant enqueue — the real impl is enqueueXphereSync(id, 'backfill'). */
type Enqueuer = (tenantId: string) => Promise<void>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * PURE, dependency-injected backfill seam — the unit the offline gate exercises.
 * No Supabase, no QStash inside: callers inject `fetchTenants` + `enqueue`.
 *
 * Enqueues once per tenant in the page (in `created_at` order), advancing the
 * cursor to the last processed tenant. A short page (< batchSize) means there
 * are no more tenants -> `done: true`. A full page means a re-invocation with
 * `?cursor=nextCursor` continues after the last tenant.
 *
 * Per-tenant fail-open: a rejecting enqueue for one tenant is swallowed so the
 * remaining tenants are still processed and the batch never aborts.
 */
export async function runBackfillBatch(opts: {
  fetchTenants: TenantFetcher
  enqueue: Enqueuer
  cursor: string | null
  batchSize?: number
  throttleMs?: number
}): Promise<{
  enqueued: number
  skipped: number
  nextCursor: string | null
  done: boolean
}> {
  const batchSize = opts.batchSize ?? BATCH_SIZE
  const throttleMs = opts.throttleMs ?? THROTTLE_MS
  const tenants = await opts.fetchTenants(opts.cursor, batchSize)

  let enqueued = 0
  // No opt-out/internal/test/marketing-consent flag exists on `tenants` (verified
  // src/types/database.ts) — per the Phase 53 CONTEXT decision we do NOT invent a
  // column this phase; we sync ALL tenants and flag to product before live PII
  // flow. `skipped` stays 0 until such a flag exists (kept for forward compat).
  const skipped = 0
  let nextCursor: string | null = opts.cursor

  for (const t of tenants) {
    // Per-tenant fail-open: enqueueXphereSync already swallows, but guard here
    // too so a stubbed/real rejection for one tenant never aborts the batch.
    try {
      await opts.enqueue(t.id)
      enqueued++
    } catch {
      /* swallow — continue the batch */
    }
    nextCursor = t.created_at // resumable cursor advances to the last processed tenant
    if (throttleMs > 0) await sleep(throttleMs) // THROTTLE between enqueues
  }

  const done = tenants.length < batchSize // short page = no more tenants
  return { enqueued, skipped, nextCursor, done }
}

/**
 * POST /api/superadmin/xphere/backfill[?cursor=<created_at>]
 *
 * Superadmin-gated. Wires the pure seam to the real superadmin guard, a
 * service-role keyset read of `tenants`, and the real enqueueXphereSync
 * (reason 'backfill'). Returns { enqueued, skipped, nextCursor, done }.
 */
export async function POST(request: Request) {
  const guard = await assertSuperadmin()
  if (!guard) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cursor = new URL(request.url).searchParams.get('cursor')

  // Service-role client paginates ALL tenants regardless of RLS.
  const service = createServiceClient()
  const fetchTenants: TenantFetcher = async (afterCursor, limit) => {
    let q = service
      .from('tenants')
      .select('id, created_at')
      .order('created_at', { ascending: true })
      .limit(limit)
    // Keyset pagination: resumable and avoids OFFSET drift across re-invocations.
    if (afterCursor) q = q.gt('created_at', afterCursor)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as BackfillTenant[]
  }

  const result = await runBackfillBatch({
    fetchTenants,
    enqueue: (tenantId) => enqueueXphereSync(tenantId, 'backfill'),
    cursor,
  })

  return NextResponse.json(result)
}
