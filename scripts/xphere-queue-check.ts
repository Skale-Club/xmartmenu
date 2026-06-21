/**
 * xphere-queue-check.ts - Offline gate for the Phase 52 producer choke point.
 *
 * v2.4 FND-03: every Phase 52 producer (onboarding, Stripe webhooks, Connect,
 * backfill) funnels through `enqueueXphereSync` (src/lib/xphere/queue.ts). The
 * repo has no test runner; this `tsx` assertion script locks the producer's
 * riskiest invariants behind a runnable gate, mirroring the convention in
 * scripts/xphere-client-check.ts (node:assert/strict, fetch stubbed,
 * main().catch(...process.exit(1)) wrapper, non-zero exit on any failure).
 *
 * It runs with NO real QStash/Xphere credentials and NO real network: dummy
 * QSTASH_TOKEN + XPHERE_WORKER_URL are set in-process BEFORE queue.ts is
 * dynamically imported (queue.ts reads QSTASH_TOKEN at module load to build the
 * client), and globalThis.fetch is replaced — the QStash SDK publishes via
 * fetch, so stubbing fetch intercepts the publish at the network seam.
 *
 * It proves the three FND-03 invariants:
 *   1. Success path builds the THIN { tenantId, reason, eventId?, tags? } message
 *      with deduplicationId = `xphere:<tenantId>:<reason>` and retries = 5. The
 *      SDK carries deduplicationId/retries as the `Upstash-Deduplication-Id` /
 *      `Upstash-Retries` request HEADERS (the JSON body is exactly the thin
 *      payload), so we assert against where they actually land.
 *   2. Fail-open: a thrown publish is swallowed — enqueueXphereSync RESOLVES
 *      (never rejects) so a CRM/QStash outage cannot block onboarding or flip a
 *      Stripe webhook 200 -> 500.
 *   3. Silent no-op when no destination URL resolves (XPHERE_WORKER_URL /
 *      NEXT_PUBLIC_APP_URL unset) -> ZERO fetch calls, no throw.
 *
 * Run: npx tsx scripts/xphere-queue-check.ts  (or `npm run xphere:check:queue`)
 *
 * Code + comments in English.
 */

import assert from 'node:assert/strict'

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

/** Read a header off the recorded request whether it arrived as a Headers
 *  instance (the SDK builds one) or a plain object — defensive for SDK changes. */
function header(init: RequestInit, name: string): string | null {
  const h = init.headers
  if (h instanceof Headers) return h.get(name)
  if (Array.isArray(h)) {
    const found = h.find(([k]) => k.toLowerCase() === name.toLowerCase())
    return found ? found[1] : null
  }
  if (h && typeof h === 'object') {
    const rec = h as Record<string, string>
    const key = Object.keys(rec).find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    )
    return key ? rec[key]! : null
  }
  return null
}

async function main(): Promise<void> {
  // queue.ts reads QSTASH_TOKEN at MODULE LOAD to construct its client, so set
  // dummy creds + a destination URL BEFORE the dynamic import. No real account.
  process.env.QSTASH_TOKEN = 'dummy-token-not-real'
  process.env.XPHERE_WORKER_URL =
    'https://example.test/api/internal/xphere-sync'
  // Enable the producer kill switch (added in phase 54-02) so the publish-path
  // assertions exercise a real enqueue. Without this, enqueueXphereSync is a
  // silent no-op and the "publishes once" assertions fail.
  process.env.XPHERE_SYNC_ENABLED = 'true'
  delete process.env.NEXT_PUBLIC_APP_URL

  const { enqueueXphereSync } = await import('@/lib/xphere/queue')

  // --- 1. Success path: thin message + dedup id + retries -------------------
  {
    const { calls } = stubFetch(() => publishOk())

    await enqueueXphereSync('tenant-uuid-1', 'plan_changed', {
      eventId: 'evt_123',
      tags: ['upgrade'],
    })

    assert.equal(calls.length, 1, 'success path -> exactly one fetch call')

    const { init } = calls[0]!

    // The JSON request body is the THIN payload the worker fat-reads from.
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    assert.deepEqual(
      body,
      {
        tenantId: 'tenant-uuid-1',
        reason: 'plan_changed',
        eventId: 'evt_123',
        tags: ['upgrade'],
      },
      'published body = thin { tenantId, reason, eventId, tags }',
    )

    // deduplicationId is carried by the SDK as the Upstash-Deduplication-Id
    // request header — assert the EXACT value `xphere:<tenantId>:<reason>`.
    assert.equal(
      header(init, 'Upstash-Deduplication-Id'),
      'xphere:tenant-uuid-1:plan_changed',
      'deduplicationId header = xphere:tenant-uuid-1:plan_changed',
    )

    // retries = 5 lands in the Upstash-Retries header.
    assert.equal(
      header(init, 'Upstash-Retries'),
      '5',
      'retries = 5 (Upstash-Retries header)',
    )

    globalThis.fetch = originalFetch
  }

  // --- 2. Optional fields omitted when absent ------------------------------
  // Proves the spread-only-when-present logic keeps the worker's optional zod
  // fields truly optional (no eventId/tags keys leak through as undefined).
  {
    const { calls } = stubFetch(() => publishOk())

    await enqueueXphereSync('tenant-uuid-2', 'onboarded')

    assert.equal(calls.length, 1, 'no-opts path -> one fetch call')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >
    assert.deepEqual(
      body,
      { tenantId: 'tenant-uuid-2', reason: 'onboarded' },
      'no opts -> body omits eventId/tags entirely',
    )

    globalThis.fetch = originalFetch
  }

  // --- 3. Fail-open: a thrown publish is swallowed -------------------------
  // The core FND-03 invariant: a CRM/QStash outage must NEVER throw into the
  // caller (onboarding / Stripe webhooks keep working).
  {
    stubFetch(() => {
      throw new TypeError('qstash down')
    })

    let threw = false
    try {
      await enqueueXphereSync('t2', 'onboarded')
    } catch {
      threw = true
    }
    assert.equal(
      threw,
      false,
      'fail-open: thrown publish swallowed -> enqueue resolves, never rejects',
    )

    globalThis.fetch = originalFetch
  }

  // --- 4. Silent no-op when no destination URL resolves --------------------
  // With XPHERE_WORKER_URL and NEXT_PUBLIC_APP_URL unset, resolveWorkerUrl()
  // returns null and the `if (!client || !url) return` guard short-circuits:
  // ZERO fetch calls, no throw. (The token-unset half of the guard is exercised
  // at module load — the client is built only when QSTASH_TOKEN is present,
  // mirroring the rate-limit.ts `client = token ? ... : null` pattern.)
  {
    delete process.env.XPHERE_WORKER_URL
    delete process.env.NEXT_PUBLIC_APP_URL

    const { calls } = stubFetch(() => {
      throw new Error('fetch must not be called when no URL resolves')
    })

    let threw = false
    try {
      await enqueueXphereSync('t3', 'manual')
    } catch {
      threw = true
    }
    assert.equal(threw, false, 'no-op path does not throw')
    assert.equal(calls.length, 0, 'no destination URL -> zero fetch calls')

    globalThis.fetch = originalFetch
  }

  // --- Result --------------------------------------------------------------
  globalThis.fetch = originalFetch
  console.log('xphere-queue-check: all assertions passed')
}

main().catch((err) => {
  globalThis.fetch = originalFetch
  console.error(err)
  process.exit(1)
})
