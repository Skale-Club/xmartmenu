/**
 * mapping.ts - Pure Xphere entity/stage/MRR mapper.
 *
 * v2.4 FND-02 / 2026-06-21 realignment: turns a tenant + store-admin owner +
 * override-resolved plan + subscription status + reason into the generic
 * `POST /api/v1/sync` `company` envelope (source='xmartmenu', keyed on
 * `company.id = tenants.id`).
 *
 * PURE module: no I/O, no network/queue imports, no `getTenantPlan()` call
 * (that is I/O — the worker resolves the plan and passes it in). Every value is
 * derived from inputs — no Date.now() (the worker passes `occurredAt`), no random,
 * no env reads — so the mapper is fully deterministic and offline-testable.
 *
 * Code + comments in English.
 */

import {
  XPHERE_STAGES,
  XPHERE_PIPELINE,
  XPHERE_SOURCE,
  type SyncReason,
  type XphereStage,
  type XphereSyncRequest,
} from './types'
import type { EffectivePlan, Profile } from '@/types/database'

/**
 * Input to the mapper. A minimal, decoupled shape (does NOT import the DB
 * `Tenant` type) so the mapper stays fixture-friendly. The worker assembles this
 * from its fat-read; `owner.email` comes from auth.users (not on `profiles`).
 */
export interface SyncMapInput {
  tenant: { id: string; slug: string; name: string; custom_domain: string | null }
  owner: (Pick<Profile, 'full_name' | 'role'> & { email: string | null }) | null
  plan: Pick<EffectivePlan, 'monthly_price' | 'annual_price' | 'billing_cycle' | 'status'>
  currency: string // e.g. 'brl'
  reason: SyncReason
  occurredAt: string // ISO — the worker's fat-read moment (last-write-wins anchor)
  eventId?: string // Stripe event.id; absent for onboarding
  tags?: string[] // status/direction tags from the producer
}

/**
 * Normalized MRR. The ONLY MRR computation in the codebase: annual billing is
 * normalized to a monthly figure (annual_price / 12); otherwise the resolved
 * monthly_price. Always reads the override-resolved EffectivePlan values that
 * the caller passed in — never raw `plans.monthly_price`.
 */
export function normalizeMrr(
  plan: Pick<EffectivePlan, 'monthly_price' | 'annual_price' | 'billing_cycle'>,
): number {
  return plan.billing_cycle === 'annual' ? plan.annual_price / 12 : plan.monthly_price
}

/**
 * Pick the pipeline stage. `reason` takes priority; otherwise fall back on the
 * subscription `status`. Driven entirely by XPHERE_STAGES so stage names live in
 * exactly one place (types.ts).
 */
export function selectStage(
  reason: SyncReason,
  status: EffectivePlan['status'],
): XphereStage {
  switch (reason) {
    case 'onboarded':
      return XPHERE_STAGES.ONBOARDING
    case 'plan_activated':
      return XPHERE_STAGES.ACTIVE
    case 'past_due':
      return XPHERE_STAGES.AT_RISK
    case 'churned':
      return XPHERE_STAGES.CHURNED
    default:
      break
  }

  // Reason did not pin a stage (plan_changed, connect_changed, backfill,
  // manual) — derive it from the live subscription status.
  switch (status) {
    case 'active':
      return XPHERE_STAGES.ACTIVE
    case 'past_due':
      return XPHERE_STAGES.AT_RISK
    case 'cancelled':
      return XPHERE_STAGES.CHURNED
    case 'trial':
      return XPHERE_STAGES.ONBOARDING
    default:
      // Exhaustive over the known statuses; safe default for forward-compat.
      return XPHERE_STAGES.ONBOARDING
  }
}

/** Human-readable note body for the CRM timeline. Derived only from inputs. */
function describeReason(reason: SyncReason, tenantName: string): string {
  switch (reason) {
    case 'onboarded':
      return `Tenant onboarded: ${tenantName}`
    case 'plan_activated':
      return `Plan activated for ${tenantName}`
    case 'plan_changed':
      return `Plan changed for ${tenantName}`
    case 'past_due':
      return `Subscription past due for ${tenantName}`
    case 'churned':
      return `Subscription churned for ${tenantName}`
    case 'connect_changed':
      return `Stripe Connect status changed for ${tenantName}`
    case 'backfill':
      return `Backfill sync for ${tenantName}`
    case 'manual':
      return `Manual sync for ${tenantName}`
  }
}

/**
 * Assemble the `company`-envelope upsert payload. The business + owner collapse
 * into one `company` object (external_id = tenant.id, source = 'xmartmenu'); the
 * opportunity amount is the normalized MRR; status/direction tags ride on the
 * company (→ Contact). The owner email is REQUIRED for the Contact to be created.
 *
 * Note inclusion: when an `eventId` is supplied (Stripe-driven), the note dedups
 * on that event id; for `reason === 'onboarded'` with no event, it dedups on
 * `onboarding:<tenant.id>`; otherwise the note is omitted.
 */
export function buildSyncPayload(input: SyncMapInput): XphereSyncRequest {
  const { reason } = input

  const payload: XphereSyncRequest = {
    source: XPHERE_SOURCE,
    event: reason,
    occurred_at: input.occurredAt,
    company: {
      id: input.tenant.id,
      name: input.tenant.name,
      owner_name: input.owner?.full_name ?? null,
      email: input.owner?.email ?? null,
      website: input.tenant.custom_domain,
      tags: input.tags ?? [],
      custom_fields: {
        slug: input.tenant.slug,
        reason,
        subscription_status: input.plan.status,
      },
    },
    opportunity: {
      stage: selectStage(reason, input.plan.status),
      value: normalizeMrr(input.plan),
      currency: input.currency.toUpperCase(),
      pipeline: XPHERE_PIPELINE,
    },
  }

  const dedupId =
    input.eventId ??
    (reason === 'onboarded' ? `onboarding:${input.tenant.id}` : undefined)
  if (dedupId !== undefined) {
    payload.note = {
      content: describeReason(reason, input.tenant.name),
      dedup_id: dedupId,
    }
  }

  return payload
}
