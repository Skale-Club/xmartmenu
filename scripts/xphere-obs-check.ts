/**
 * xphere-obs-check.ts - Offline gate for the Phase 54 observability invariants.
 *
 * v2.4 Phase 54 / OBS-01 + OBS-02: the repo has no test runner; this `tsx`
 * assertion script locks the two riskiest OBS invariants behind a runnable gate,
 * mirroring the convention in scripts/xphere-queue-check.ts (node:assert/strict,
 * fetch stubbed, a single async main(), main().catch(...process.exit(1)) wrapper,
 * non-zero exit on any failed assertion).
 *
 * It runs with NO real QStash/Xphere credentials and NO real network: dummy
 * QSTASH_TOKEN + XPHERE_WORKER_URL are set in-process BEFORE queue.ts is
 * dynamically imported (queue.ts reads QSTASH_TOKEN at module load to build the
 * QStash client), and globalThis.fetch is replaced — the QStash SDK publishes
 * via fetch, so stubbing fetch intercepts the publish at the network seam.
 *
 * It proves the two OBS invariants:
 *   OBS-02 (producer kill switch): with XPHERE_SYNC_ENABLED disabled
 *     (unset / 'false' / '0'), enqueueXphereSync makes ZERO publish (no fetch)
 *     and never throws; with the flag ON, it still publishes EXACTLY once with
 *     the thin { tenantId, reason } body (no regression to fail-open).
 *   OBS-01 (resync route): structurally asserts the superadmin re-sync route
 *     gates on assertSuperadmin and calls enqueueXphereSync(id, 'manual') and
 *     returns { ok: true } (the real guard needs cookies/Supabase, so the guard
 *     contract is verified by reading the route source).
 *
 * Run: npx tsx scripts/xphere-obs-check.ts  (or `npm run xphere:check:obs`)
 *
 * Code + comments in English.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch

/** Install a fake fetch and return the list of calls it recorded. */
function stubFetch(
  impl: (url: string, init: RequestInit) => Promise<Response> | Response,
): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, init: init ?? {} })
    return impl(u, init ?? {})
  }) as typeof fetch
  return { calls }
}

/** A 200 JSON response — the QStash SDK parses this and resolves on the first
 *  attempt (no internal retry loop), so the producer makes exactly one fetch. */
function publishOk(): Response {
  return new Response(JSON.stringify({ messageId: 'msg_test_1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function main(): Promise<void> {
  // queue.ts reads QSTASH_TOKEN at MODULE LOAD to construct its client, so set
  // dummy creds + a destination URL BEFORE the dynamic import. No real account.
  // The kill switch (XPHERE_SYNC_ENABLED) gate runs BEFORE the client/url gate,
  // so with valid token+url present, the ONLY thing that suppresses a publish in
  // these blocks is the kill switch itself — exactly what OBS-02 asserts.
  process.env.QSTASH_TOKEN = 'dummy-token-not-real'
  process.env.XPHERE_WORKER_URL =
    'https://example.test/api/internal/xphere-sync'
  delete process.env.NEXT_PUBLIC_APP_URL

  const { enqueueXphereSync } = await import('@/lib/xphere/queue')

  // --- 1. Kill switch DISABLED (unset) -> zero publish, no throw (OBS-02) ----
  // The safe-dark default: with no XPHERE_SYNC_ENABLED, producing is a silent
  // no-op BEFORE publish even though token + url ARE configured. Fetch is
  // stubbed to throw if ever called, proving the early return wins.
  {
    delete process.env.XPHERE_SYNC_ENABLED

    const { calls } = stubFetch(() => {
      throw new Error('fetch must not be called when kill switch is disabled')
    })

    let threw = false
    try {
      await enqueueXphereSync('t1', 'manual')
    } catch {
      threw = true
    }
    assert.equal(threw, false, 'disabled kill switch (unset) does not throw')
    assert.equal(
      calls.length,
      0,
      'disabled kill switch (unset) -> zero publish (no fetch)',
    )

    globalThis.fetch = originalFetch
  }

  // --- 2. Kill switch DISABLED (explicit 'false' / '0') -> zero publish ------
  // The flag truthiness in isSyncEnabled() treats the strings 'false' and '0'
  // as disabled — assert both suppress the publish exactly like unset does.
  {
    for (const value of ['false', '0'] as const) {
      process.env.XPHERE_SYNC_ENABLED = value

      const { calls } = stubFetch(() => publishOk())

      await enqueueXphereSync('t1', 'manual')

      assert.equal(
        calls.length,
        0,
        `disabled kill switch ('${value}') -> zero publish (no fetch)`,
      )

      globalThis.fetch = originalFetch
    }
  }

  // --- 3. Kill switch ENABLED -> exactly one publish (no fail-open regression)
  // Turning the flag on must restore publishing: exactly one fetch with the
  // thin { tenantId, reason } body (the worker fat-reads everything else).
  {
    process.env.XPHERE_SYNC_ENABLED = 'true'

    const { calls } = stubFetch(() => publishOk())

    await enqueueXphereSync('t-enabled', 'manual')

    assert.equal(
      calls.length,
      1,
      'enabled kill switch -> exactly one publish (no fail-open regression)',
    )

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >
    assert.deepEqual(
      body,
      { tenantId: 't-enabled', reason: 'manual' },
      'enabled path publishes thin { tenantId, reason: manual } body',
    )

    globalThis.fetch = originalFetch
  }

  // --- 4. Resync route structural assertion (OBS-01) ------------------------
  // The real assertSuperadmin needs cookies/Supabase, so this gate cannot call
  // it. Assert STRUCTURALLY that the route gates on assertSuperadmin, calls the
  // single producer with reason 'manual', and returns { ok: true }.
  {
    const src = readFileSync(
      new URL(
        '../src/app/api/superadmin/tenants/[id]/xphere-resync/route.ts',
        import.meta.url,
      ),
      'utf8',
    )
    assert.match(src, /assertSuperadmin/, 'resync route gates on assertSuperadmin')
    assert.match(
      src,
      /enqueueXphereSync\([^)]*'manual'/,
      "resync route calls enqueueXphereSync(id, 'manual')",
    )
    assert.match(
      src,
      /\{\s*ok:\s*true\s*\}/,
      'resync route returns { ok: true }',
    )
    assert.match(
      src,
      /export\s+async\s+function\s+POST/,
      'resync route exports an async POST handler',
    )
  }

  globalThis.fetch = originalFetch
  console.log('xphere-obs-check: all assertions passed')
}

main().catch((err) => {
  globalThis.fetch = originalFetch
  console.error(err)
  process.exit(1)
})
