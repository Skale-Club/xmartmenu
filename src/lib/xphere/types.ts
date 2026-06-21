/**
 * types.ts - Xphere /api/v1/sync contract (single source of truth)
 *
 * v2.4 FND-02: This file is the ONE place that encodes the documented
 * `POST /api/v1/sync` request/response shape, the `SyncReason` union, and the
 * `XPHERE_STAGES` pipeline constant.
 *
 * CONTRACT NOT FINALIZED by Xtimator — the exact field names of the
 * /api/v1/sync payload are not yet locked by the separate Xtimator effort.
 * This file is the ONLY place to change when the real shape lands; keep every
 * wire-level field name isolated here so a contract change touches one file.
 *
 * No network/queue imports. The only runtime value here is the XPHERE_STAGES
 * constant; everything else is types. Code + comments in English.
 */

/**
 * Why a sync was enqueued. Drives stage selection (see mapping.selectStage) and
 * the human-readable note body. `reason` takes priority over subscription status
 * when picking a stage.
 */
export type SyncReason =
  | 'onboarded'
  | 'plan_activated'
  | 'plan_changed'
  | 'past_due'
  | 'churned'
  | 'connect_changed'
  | 'backfill'
  | 'manual'

/**
 * Single source of truth for Xphere pipeline stage names.
 *
 * Lifecycle: Onboarding -> Active (Won) -> At Risk (open, re-openable on
 * past_due — dunning often recovers, so NOT Lost) -> Churned (Lost).
 *
 * Stage names are configured data-only in the Xphere org and MUST match these
 * literals exactly. Never hard-code a stage string elsewhere — reference
 * XPHERE_STAGES so a rename happens in one place.
 */
export const XPHERE_STAGES = {
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Active', // Won
  AT_RISK: 'At Risk', // open, re-openable on past_due
  CHURNED: 'Churned', // Lost
} as const

export type XphereStage = (typeof XPHERE_STAGES)[keyof typeof XPHERE_STAGES]

// ---------------------------------------------------------------------------
// CONTRACT NOT FINALIZED by Xtimator — this file is the ONLY place to change
// when the real /api/v1/sync shape lands. Keep field names isolated here.
// ---------------------------------------------------------------------------

/** Account = the tenant. Keyed on the immutable external_id = tenants.id. */
export interface XphereAccountInput {
  external_id: string // = tenants.id (immutable idempotency key — never email/phone)
  name: string
  slug: string
  website: string | null
}

/** Contact = the store-admin owner only, never staff. One owner per account. */
export interface XphereContactInput {
  external_id: string // = tenants.id (one owner contact per account)
  name: string | null
  role: 'store-admin' // owner only, never staff
}

/** Opportunity = the subscription (one per tenant — the subscription is the deal). */
export interface XphereOpportunityInput {
  external_id: string // = tenants.id (the subscription is the deal)
  stage: XphereStage
  amount: number // normalized MRR (annual_price/12 for annual, else monthly_price)
  currency: string // e.g. 'brl'
  tags: string[] // e.g. ['status:active', 'upgrade'] — status/direction tags
}

/**
 * Optional append-only timeline note. `dedup_id` lets the CRM drop redelivered
 * events: the Stripe `event.id` for webhook-driven syncs, or
 * `onboarding:<tenant_id>` for the onboarding event which has no Stripe event.
 */
export interface XphereNoteInput {
  dedup_id: string // Stripe event.id or `onboarding:<tenant_id>` — dedupes redelivery
  body: string
}

/**
 * The full upsert payload. Every entity upserts on `external_id`, and
 * `source: 'xmartmenu'` identifies the producing system inside the shared org.
 */
export interface XphereSyncRequest {
  source: 'xmartmenu'
  reason: SyncReason
  account: XphereAccountInput
  contact: XphereContactInput
  opportunity: XphereOpportunityInput
  note?: XphereNoteInput
}

/** CRM-side ids returned on a successful sync — persisted to detect drift. */
export interface XphereSyncResponse {
  account_id: string
  contact_id: string
  opportunity_id: string
}
