/**
 * POST /api/internal/xphere-sync
 *
 * The keystone QStash worker: turns a thin `{ tenantId, reason }` message into a
 * verified, idempotent, retry-classified CRM upsert. Mirrors the Stripe webhook
 * discipline (src/app/api/stripe/webhooks/route.ts): verify-first on the RAW body,
 * service-role fat-read of canonical state, record success ONLY after the business
 * logic succeeds, else non-2xx so the queue retries.
 *
 * Security & runtime (Pitfall 4 / 10):
 * - `runtime = 'nodejs'`: the QStash Receiver needs Node crypto; the worker needs
 *   the service-role key and a real fetch budget. Never Edge.
 * - Raw body read ONCE via `req.text()`; the same string feeds the verifier and
 *   `JSON.parse` — never re-stringify, never read the body twice.
 * - Signature verified with BOTH current + next signing keys against a PINNED
 *   public URL (`XPHERE_WORKER_URL` / `NEXT_PUBLIC_APP_URL`), NOT `req.url`
 *   (Coolify's reverse proxy rewrites the host), BEFORE any parse or DB read.
 *   Unsigned/invalid → 401.
 *
 * Retry classification (FND-06):
 * - transient (XphereTransientError / unexpected throw) → 500 (QStash retries)
 * - permanent (XpherePermanentError / bad payload / no subscription) → 489 +
 *   `Upstash-NonRetryable-Error: true` (straight to DLQ)
 * - disabled (env gate closed) / genuinely-missing tenant → 2xx (no retry)
 *
 * Idempotency: the Xphere endpoint upserts by `external_id = tenants.id`, and the
 * thin-message + fat-read makes redelivery / out-of-order self-correct (a late
 * retry re-sends current truth). No local dedup ledger here — the QStash
 * deduplicationId is the Phase 52 producer's job.
 *
 * Code + comments in English.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Receiver } from '@upstash/qstash'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'
import { buildSyncPayload, type SyncMapInput } from '@/lib/xphere/mapping'
import { postXphereSync } from '@/lib/xphere/client'
import { XpherePermanentError } from '@/lib/xphere/errors'
import {
  classifyWorkerOutcome,
  nonRetryableHeaders,
} from '@/lib/xphere/classify'
import { captureSecurityEvent } from '@/lib/observability'

// The QStash Receiver needs Node crypto; the route needs the service-role key and
// a real fetch budget for the outbound Xphere call. Never Edge.
export const runtime = 'nodejs'

/**
 * Thin queue message. The `reason` enum MUST match the SyncReason union in
 * src/lib/xphere/types.ts (the mapper drives stage selection off it).
 */
const bodySchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.enum([
    'onboarded',
    'plan_activated',
    'plan_changed',
    'past_due',
    'churned',
    'connect_changed',
    'backfill',
    'manual',
  ]),
  eventId: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest) {
  // 1. Read the raw body ONCE. The same string feeds the verifier and JSON.parse —
  //    re-stringifying a parsed object would change the bytes QStash hashed.
  const rawBody = await req.text()
  // Lower-case header name; some platforms lower-case all header keys.
  const signature = req.headers.get('upstash-signature') ?? ''

  // 2. Verify the QStash signature BEFORE any parse or DB read. Verify against a
  //    PINNED public URL constant (not req.url — Coolify's proxy rewrites the
  //    host, Pitfall 10) with BOTH signing keys so a key rotation never drops sync.
  const workerUrl =
    process.env.XPHERE_WORKER_URL ??
    `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/xphere-sync`

  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
  })

  let valid = false
  try {
    valid = await receiver.verify({ signature, body: rawBody, url: workerUrl })
  } catch {
    valid = false
  }
  if (!valid) {
    captureSecurityEvent('Xphere worker: QStash signature verification failed')
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // 3. Parse only AFTER verify. A malformed message is permanent — retrying a bad
  //    payload is pure waste, so send it straight to the DLQ (489 + non-retryable).
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawBody)
  } catch {
    const v = classifyWorkerOutcome({ kind: 'bad_payload' })
    return NextResponse.json(
      { error: 'bad payload' },
      { status: v.status, headers: nonRetryableHeaders(v) },
    )
  }
  const parsed = bodySchema.safeParse(parsedJson)
  if (!parsed.success) {
    const v = classifyWorkerOutcome({ kind: 'bad_payload' })
    return NextResponse.json(
      { error: 'bad payload' },
      { status: v.status, headers: nonRetryableHeaders(v) },
    )
  }
  const { tenantId, reason, eventId, tags } = parsed.data

  // 4. Business logic. Any throw here is classified in the catch below.
  try {
    const supabase = createServiceClient()

    // Fat-read the live tenant (canonical truth — never a stale enqueued snapshot).
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, slug, name, custom_domain, xphere_sync_error')
      .eq('id', tenantId)
      .single()

    if (!tenant) {
      // A genuinely deleted tenant is not a transient failure — no retry.
      const v = classifyWorkerOutcome({ kind: 'tenant_gone' })
      return NextResponse.json(
        { skipped: 'tenant not found' },
        { status: v.status, headers: nonRetryableHeaders(v) },
      )
    }

    // Store-admin owner profile (the CRM Contact). null is tolerated by the mapper.
    const { data: ownerRow } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('tenant_id', tenantId)
      .eq('role', 'store-admin')
      .limit(1)
      .maybeSingle()

    // The owner email lives in auth.users (NOT on profiles) and is REQUIRED for
    // the CRM Contact — the identity invariant needs phone OR email and XmartMenu
    // collects no phone. Resolve it via the service-role auth admin API.
    let owner: SyncMapInput['owner'] = null
    if (ownerRow) {
      let email: string | null = null
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(ownerRow.id)
        email = authUser?.user?.email ?? null
      } catch {
        email = null // non-fatal: mirror still upserts Account + Opportunity
      }
      owner = { full_name: ownerRow.full_name, role: ownerRow.role, email }
    }

    // Currency lives on tenant_settings; default to BRL when unset.
    const { data: settings } = await supabase
      .from('tenant_settings')
      .select('currency')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const currency = settings?.currency ?? 'brl'

    // Override/grandfather-resolved plan → the normalized MRR source. No
    // subscription means there is no deal to sync — permanent, send to DLQ.
    const plan = await getTenantPlan(tenantId, supabase)
    if (!plan) {
      // No subscription = no deal to sync. Reuse the permanent 489 path so the
      // classification table stays the single source of truth.
      const v = classifyWorkerOutcome({
        kind: 'error',
        error: new XpherePermanentError('no subscription'),
      })
      return NextResponse.json(
        { error: 'no subscription' },
        { status: v.status, headers: nonRetryableHeaders(v) },
      )
    }

    // Pure map (Phase 50) → the upsert payload keyed on external_id = tenant.id.
    const payload = buildSyncPayload({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        custom_domain: tenant.custom_domain,
      },
      owner,
      plan,
      currency,
      reason,
      occurredAt: new Date().toISOString(),
      eventId,
      tags,
    })

    // The ONLY network seam (Plan 01). Idempotency key lets the endpoint dedup a
    // redelivery of the same logical sync.
    const result = await postXphereSync(payload, {
      idempotencyKey: `${tenantId}:${reason}`,
    })

    // Env gate closed — the feature ships dark. Treat as a permanent no-op.
    if (result.disabled) {
      const v = classifyWorkerOutcome({ kind: 'disabled' })
      return NextResponse.json(
        { skipped: 'xphere disabled' },
        { status: v.status, headers: nonRetryableHeaders(v) },
      )
    }

    // Success: persist the CRM ids + the sync watermark and clear any prior error
    // (FND-05). xphere_synced_at only ever advances past a SUCCESSFUL call.
    await supabase
      .from('tenants')
      .update({
        xphere_account_id: result.response.account_id,
        xphere_contact_id: result.response.contact_id,
        xphere_opportunity_id: result.response.opportunity_id,
        xphere_synced_at: new Date().toISOString(),
        xphere_sync_error: null,
      })
      .eq('id', tenantId)

    const v = classifyWorkerOutcome({ kind: 'success' })
    return NextResponse.json(
      { ok: true },
      { status: v.status, headers: nonRetryableHeaders(v) },
    )
  } catch (err) {
    // Scrub before persisting — NEVER store headers / API key / signed JWT in
    // xphere_sync_error. Only the error name + message, truncated.
    const msg =
      err instanceof Error
        ? `${err.name}: ${err.message}`.slice(0, 500)
        : 'unknown error'

    // Record the error WITHOUT advancing xphere_synced_at (fail closed). Best
    // effort — a failure to write the error must not change the retry contract.
    try {
      await createServiceClient()
        .from('tenants')
        .update({ xphere_sync_error: msg })
        .eq('id', tenantId)
    } catch {
      // ignore — the classification below still drives the queue correctly.
    }

    // Classify for QStash (FND-06) through the shared table: permanent → 489 +
    // non-retryable (DLQ); transient or any unexpected throw → 500 (QStash
    // retries with backoff). Single source of truth shared with the offline gate.
    const v = classifyWorkerOutcome({ kind: 'error', error: err })
    return NextResponse.json(
      { error: msg },
      { status: v.status, headers: nonRetryableHeaders(v) },
    )
  }
}
