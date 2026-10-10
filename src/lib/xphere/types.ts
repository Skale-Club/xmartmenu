/**
 * types.ts - Xphere POST /api/v1/sync contract (single source of truth)
 *
 * v2.4 FND-02 / 2026-06-21 realignment: the real, FINALIZED Xphere contract is
 * the generic CRM-mirror at `POST /api/v1/sync` (shared by every sibling app,
 * discriminated by `source`). It is `company`-centric: ONE `company` object
 * (the tenant business + its owner) yields Account + Contact + Opportunity in the
 * platform CRM, keyed on `external_id = company.id = tenants.id`.
 *
 * This file is the ONLY place that encodes that wire shape, the `SyncReason`
 * union, the `XPHERE_STAGES` pipeline constant, and the target pipeline name.
 *
 * No network/queue imports. The only runtime values here are constants;
 * everything else is types. Code + comments in English.
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
 * literals exactly (the "XmartMenu Lifecycle" pipeline stages). Never hard-code a
 * stage string elsewhere — reference XPHERE_STAGES so a rename happens in one place.
 */
export const XPHERE_STAGES = {
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Active', // Won
  AT_RISK: 'At Risk', // open, re-openable on past_due
  CHURNED: 'Churned', // Lost
} as const

export type XphereStage = (typeof XPHERE_STAGES)[keyof typeof XPHERE_STAGES]

/** Target pipeline in the XmartMenu org — the receiver resolves the stage by name. */
export const XPHERE_PIPELINE = 'XmartMenu Lifecycle'

/** Producing system, inside the shared org model. */
export const XPHERE_SOURCE = 'xmartmenu'

// ---------------------------------------------------------------------------
// Wire shape — the generic /api/v1/sync `company` envelope. Keep field names
// isolated here so a contract change touches one file.
// ---------------------------------------------------------------------------

/**
 * The tenant business + its store-admin owner. The receiver derives an Account
 * (the business) and a Contact (the owner) from this single object, both keyed on
 * `id`. `email` is REQUIRED for the Contact to exist — the CRM identity invariant
 * needs phone OR email and XmartMenu collects no phone, so a null email means the
 * tenant mirrors as Account+Opportunity with no person.
 */
export interface XphereCompanyInput {
  id: string // = tenants.id (immutable idempotency key — never email/phone)
  name: string
  owner_name: string | null
  email: string | null // store-admin auth email — required for the Contact
  website: string | null
  tags?: string[] // status/direction tags — land on the Contact
  custom_fields?: Record<string, unknown> // slug, reason, etc.
}

/** Opportunity = the subscription (one per tenant — the subscription is the deal). */
export interface XphereOpportunityInput {
  stage: XphereStage
  value: number // normalized MRR (annual_price/12 for annual, else monthly_price)
  currency: string // ISO 4217, e.g. 'BRL'
  pipeline: string // XPHERE_PIPELINE — target pipeline name in the org
}

/**
 * Optional append-only timeline note. `dedup_id` is the Stripe `event.id` (or
 * `onboarding:<tenant_id>` for onboarding) — sent for forward-compat; the
 * receiver accepts but does not yet enforce note idempotency.
 */
export interface XphereNoteInput {
  content: string
  dedup_id?: string
}

/**
 * The full upsert payload. `source: 'xmartmenu'` identifies the producing system
 * inside the shared org; the receiver upserts on `(source, external_id)`.
 * `occurred_at` is the observation time (the worker's fat-read moment) — drives
 * the receiver's last-write-wins ordering.
 */
export interface XphereSyncRequest {
  source: typeof XPHERE_SOURCE
  event: string // the SyncReason, as the event name
  occurred_at: string // ISO 8601 — worker-provided
  company: XphereCompanyInput
  opportunity: XphereOpportunityInput
  note?: XphereNoteInput
}

/** CRM-side ids returned on a successful sync — persisted to detect drift. */
export interface XphereSyncResponse {
  ok: boolean
  account_id: string | null
  contact_id: string | null
  opportunity_id: string | null
}
