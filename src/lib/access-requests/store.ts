import type { AdminMenuQuery } from '../data/admin-menus'
import { UUID } from '../auth/owned-principal'
import { createTenant, requireTenantAdministrator, type TenantAdminContext } from '../data/tenant-administration'
import {
  ACCESS_REQUEST_STEPS, ANSWERS_SCHEMA_VERSION, SUBMITTED_STEP, approveSchema, declineSchema, draftAnswersSchema,
  saveDraftSchema, submitSchema, type AccessRequestAnswers, type AccessRequestStatus, type AccessRequestStep, type ApplicantState,
} from './contract'

/**
 * Access requests on the owned database (docs/product/access-request-onboarding.md).
 * Every function runs inside one ownedAdminTransaction. Submitting never grants
 * access; only approve*() links the account to a restaurant, as a verified
 * platform administrator, under the shared account-authority lock.
 */

export class AccessRequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const refuse = (status: number, message: string): never => { throw new AccessRequestError(status, message) }

/** A table that does not exist yet (code deployed before the schema step) reads as unavailable. */
export function isMissingAccessRequestsTable(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '42P01'
}

export type ApplicantContext = { userId: string; sessionHash: string }
type ApplicantRow = { tenant_id: string | null; role: string; full_name: string | null; phone: string | null }

const AUTHORITY_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))"

/** The real, current, server-selected business account. Never a client-supplied id. */
async function applicant(query: AdminMenuQuery, context: ApplicantContext, write: boolean): Promise<ApplicantRow> {
  if (!UUID.test(context.userId) || !/^[a-f0-9]{64}$/.test(context.sessionHash)) refuse(403, 'Current browser session required')
  if (write) await query(AUTHORITY_LOCK)
  const row = (await query(`SELECT p.tenant_id,p.role,p.full_name,p.phone,p.must_change_password,a.disabled_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
    JOIN public.app_sessions s ON s.user_id=a.id AND s.token_hash=$2 AND s.session_version=a.session_version AND s.expires_at>clock_timestamp()
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject AND b.disabled_at IS NULL
    WHERE p.id=$1 ${write ? 'FOR UPDATE OF p,a FOR SHARE OF s,b' : ''}`, [context.userId, context.sessionHash])).rows[0]
  if (!row || row.disabled_at || row.must_change_password) refuse(403, 'Account cannot request access')
  if (!['store-admin', 'admin'].includes(String(row!.role))) refuse(403, 'Only business accounts request access')
  return { tenant_id: (row!.tenant_id as string | null) ?? null, role: String(row!.role),
    full_name: (row!.full_name as string | null) ?? null, phone: (row!.phone as string | null) ?? null }
}

function storedAnswers(value: unknown): AccessRequestAnswers {
  const parsed = draftAnswersSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value ? String(value) : null

async function audit(query: AdminMenuQuery, actorId: string, recordId: string, action: 'insert' | 'update', operation: string, tenantId: string | null = null) {
  const rows = (await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
    VALUES($1,$2,'server','access_requests',$3,$4,jsonb_build_object('operation',$5::text)) RETURNING id`, [tenantId, actorId, recordId, action, operation])).rows
  if (rows.length !== 1) refuse(503, 'Access request audit is unavailable')
}

export async function readApplicantState(query: AdminMenuQuery, context: ApplicantContext): Promise<ApplicantState> {
  const row = await applicant(query, context, false)
  if (row.tenant_id) return { status: 'has_restaurant' }
  const request = (await query('SELECT status,step,answers,submitted_at FROM public.access_requests WHERE user_id=$1', [context.userId])).rows[0]
  const step = String(request?.step ?? 'language')
  return {
    status: (request?.status as AccessRequestStatus | undefined) ?? 'none',
    step: step === SUBMITTED_STEP || (ACCESS_REQUEST_STEPS as readonly string[]).includes(step) ? step as AccessRequestStep | typeof SUBMITTED_STEP : 'language',
    answers: storedAnswers(request?.answers),
    prefill: { fullName: row.full_name, phone: row.phone },
    submittedAt: iso(request?.submitted_at),
  }
}

/** Autosave of one answer. Only a draft can change; a submitted request is final for the applicant. */
export async function saveAccessRequestDraft(query: AdminMenuQuery, context: ApplicantContext, input: unknown) {
  const parsed = saveDraftSchema.safeParse(input)
  if (!parsed.success) refuse(400, 'Invalid answers')
  const row = await applicant(query, context, true)
  if (row.tenant_id) refuse(409, 'This account already has a restaurant')
  const saved = (await query(`INSERT INTO public.access_requests(user_id,status,step,answers,schema_version,last_activity_at)
    VALUES($1,'draft',$2,$3::jsonb,$4,now())
    ON CONFLICT (user_id) DO UPDATE SET step=EXCLUDED.step,answers=EXCLUDED.answers,schema_version=EXCLUDED.schema_version,last_activity_at=now()
    WHERE public.access_requests.status='draft' RETURNING id`,
  [context.userId, parsed.data!.step, JSON.stringify(parsed.data!.answers), ANSWERS_SCHEMA_VERSION])).rows
  if (!saved.length) refuse(409, 'This request was already sent')
  return { ok: true as const }
}

export type SubmittedLead = { requestId: string; name: string | null; accountPhone: string | null; answers: AccessRequestAnswers }

/** draft -> pending. Repeating it (double submit, retry) returns the same pending request. */
export async function submitAccessRequest(query: AdminMenuQuery, context: ApplicantContext, input: unknown) {
  const parsed = submitSchema.safeParse(input)
  if (!parsed.success) refuse(400, 'Please answer the required questions')
  const row = await applicant(query, context, true)
  if (row.tenant_id) refuse(409, 'This account already has a restaurant')
  const current = (await query('SELECT id,status FROM public.access_requests WHERE user_id=$1 FOR UPDATE', [context.userId])).rows[0]
  if (current?.status === 'pending') return { status: 'pending' as const, requestId: String(current.id), lead: null }
  if (current && current.status !== 'draft') refuse(409, 'This request was already reviewed')
  const { answers, whatsappOptIn } = parsed.data!
  const saved = (await query(`INSERT INTO public.access_requests(user_id,status,step,answers,schema_version,whatsapp_opt_in_at,last_activity_at,submitted_at)
    VALUES($1,'pending',$2,$3::jsonb,$4,CASE WHEN $5::boolean THEN now() END,now(),now())
    ON CONFLICT (user_id) DO UPDATE SET status='pending',step=EXCLUDED.step,answers=EXCLUDED.answers,schema_version=EXCLUDED.schema_version,
      whatsapp_opt_in_at=EXCLUDED.whatsapp_opt_in_at,last_activity_at=now(),submitted_at=now()
    WHERE public.access_requests.status='draft' RETURNING id`,
  [context.userId, SUBMITTED_STEP, JSON.stringify(answers), ANSWERS_SCHEMA_VERSION, whatsappOptIn])).rows[0]
  if (!saved) refuse(409, 'This request was already sent')
  const requestId = String(saved!.id)
  await audit(query, context.userId, requestId, current ? 'update' : 'insert', 'access_request_submitted')
  const lead: SubmittedLead = { requestId, name: row.full_name, accountPhone: row.phone, answers }
  return { status: 'pending' as const, requestId, lead }
}

export type AccessRequestDto = {
  id: string; user_id: string; status: AccessRequestStatus; step: string; answers: AccessRequestAnswers
  full_name: string | null; phone: string | null; whatsapp_opt_in_at: string | null
  started_at: string | null; last_activity_at: string | null; submitted_at: string | null; reviewed_at: string | null
  decision_note: string | null; tenant_id: string | null; tenant_name: string | null; tenant_slug: string | null
}
const SELECT_REQUEST = `SELECT r.id,r.user_id,r.status,r.step,r.answers,r.whatsapp_opt_in_at,r.started_at,r.last_activity_at,r.submitted_at,
  r.reviewed_at,r.decision_note,r.tenant_id,p.full_name,p.phone,t.name AS tenant_name,t.slug AS tenant_slug
  FROM public.access_requests r JOIN public.profiles p ON p.id=r.user_id LEFT JOIN public.tenants t ON t.id=r.tenant_id`
const text = (value: unknown) => value === null || value === undefined ? null : String(value)
function dto(row: Record<string, unknown>): AccessRequestDto {
  return { id: String(row.id), user_id: String(row.user_id), status: row.status as AccessRequestStatus, step: String(row.step),
    answers: storedAnswers(row.answers), full_name: text(row.full_name), phone: text(row.phone), whatsapp_opt_in_at: iso(row.whatsapp_opt_in_at),
    started_at: iso(row.started_at), last_activity_at: iso(row.last_activity_at), submitted_at: iso(row.submitted_at), reviewed_at: iso(row.reviewed_at),
    decision_note: text(row.decision_note), tenant_id: text(row.tenant_id), tenant_name: text(row.tenant_name), tenant_slug: text(row.tenant_slug) }
}

/** Platform administrators only. Pending first (they need a decision), then drafts, approved, declined. */
export async function listAccessRequests(query: AdminMenuQuery, context: TenantAdminContext) {
  await requireTenantAdministrator(query, context)
  const rows = (await query(`${SELECT_REQUEST}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'draft' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
      coalesce(r.submitted_at,r.last_activity_at) DESC LIMIT 500`)).rows
  return rows.map(dto)
}

async function lockedRequest(query: AdminMenuQuery, id: string) {
  if (!UUID.test(id)) refuse(404, 'Access request not found')
  const row = (await query('SELECT id,user_id,status FROM public.access_requests WHERE id=$1 FOR UPDATE', [id])).rows[0]
  if (!row) refuse(404, 'Access request not found')
  return { id: String(row!.id), userId: String(row!.user_id), status: row!.status as AccessRequestStatus }
}
async function readOne(query: AdminMenuQuery, id: string) {
  return dto((await query(`${SELECT_REQUEST} WHERE r.id=$1`, [id])).rows[0])
}

/**
 * pending -> approved. `new` creates the restaurant through the platform's own
 * createTenant (tenant, settings, subscription on the chosen plan, main menu,
 * owner link, session revocation, audit). `existing` links the applicant to a
 * restaurant the team already built, only if it has no administrator yet.
 */
export async function approveAccessRequest(query: AdminMenuQuery, context: TenantAdminContext, id: string, input: unknown) {
  await requireTenantAdministrator(query, context, true)
  const parsed = approveSchema.safeParse(input)
  if (!parsed.success) refuse(400, 'Choose how to approve this request')
  const request = await lockedRequest(query, id)
  if (request.status !== 'pending') refuse(409, 'Only a pending request can be approved')
  let tenantId: string
  if (parsed.data!.mode === 'new') {
    const { name, slug, plan_id } = parsed.data!
    const created = await createTenant(query, context, { name, slug, plan_id, owner_user_id: request.userId })
    const createdId = created.tenant.id
    if (typeof createdId !== 'string' || !UUID.test(createdId)) refuse(503, 'Restaurant creation returned no id')
    tenantId = createdId as string
  } else {
    tenantId = parsed.data!.tenant_id
    if (!(await query('SELECT id FROM public.tenants WHERE id=$1 FOR UPDATE', [tenantId])).rows.length) refuse(404, 'Restaurant not found')
    const owner = (await query(`SELECT p.id,p.role,p.tenant_id,p.must_change_password,a.disabled_at FROM public.profiles p
      JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1 FOR UPDATE OF p,a`, [request.userId])).rows[0]
    if (!owner || owner.tenant_id || owner.must_change_password || owner.disabled_at || !['store-admin', 'admin'].includes(String(owner.role)))
      refuse(409, 'This account cannot be linked to a restaurant')
    if (!(await query('SELECT user_id FROM public.app_identity_bindings WHERE user_id=$1 AND disabled_at IS NULL FOR SHARE', [request.userId])).rows.length)
      refuse(409, 'The applicant must first verify their own phone or Google account')
    if ((await query("SELECT id FROM public.profiles WHERE tenant_id=$1 AND role IN ('store-admin','admin') LIMIT 1", [tenantId])).rows.length)
      refuse(409, 'This restaurant already has an administrator')
    await query("UPDATE public.profiles SET tenant_id=$2,role='store-admin' WHERE id=$1", [request.userId, tenantId])
    // The applicant signs in again and lands in the restaurant's panel.
    await query('UPDATE public.app_accounts SET session_version=session_version+1 WHERE id=$1', [request.userId])
    await query('DELETE FROM public.app_sessions WHERE user_id=$1', [request.userId])
  }
  await query(`UPDATE public.access_requests SET status='approved',tenant_id=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$1`,
    [request.id, tenantId, context.actorId])
  await audit(query, context.actorId, request.id, 'update', parsed.data!.mode === 'new' ? 'access_request_approved_new' : 'access_request_approved_existing', tenantId)
  return { request: await readOne(query, request.id), tenantId, createdTenant: parsed.data!.mode === 'new' }
}

/** pending or draft -> declined, with an internal note. */
export async function declineAccessRequest(query: AdminMenuQuery, context: TenantAdminContext, id: string, input: unknown) {
  await requireTenantAdministrator(query, context, true)
  const parsed = declineSchema.safeParse(input ?? {})
  if (!parsed.success) refuse(400, 'Invalid note')
  const request = await lockedRequest(query, id)
  if (request.status !== 'pending' && request.status !== 'draft') refuse(409, 'Only an open request can be declined')
  await query(`UPDATE public.access_requests SET status='declined',decision_note=$2,reviewed_at=now(),reviewed_by=$3,
    submitted_at=coalesce(submitted_at,now()) WHERE id=$1`, [request.id, parsed.data!.note || null, context.actorId])
  await audit(query, context.actorId, request.id, 'update', 'access_request_declined')
  return { request: await readOne(query, request.id) }
}

/** declined -> pending, when the team changes its mind. */
export async function reopenAccessRequest(query: AdminMenuQuery, context: TenantAdminContext, id: string) {
  await requireTenantAdministrator(query, context, true)
  const request = await lockedRequest(query, id)
  if (request.status !== 'declined') refuse(409, 'Only a declined request can be reopened')
  await query(`UPDATE public.access_requests SET status='pending',reviewed_at=NULL,reviewed_by=NULL WHERE id=$1`, [request.id])
  await audit(query, context.actorId, request.id, 'update', 'access_request_reopened')
  return { request: await readOne(query, request.id) }
}

export type AbandonedDraft = { id: string; step: string; answers: AccessRequestAnswers; full_name: string | null; phone: string | null; last_activity_at: string | null }

/** Drafts idle for `minutes`, never announced, whose account still has no restaurant. Cron only. */
export async function abandonedDrafts(query: AdminMenuQuery, minutes = 30, limit = 50): Promise<AbandonedDraft[]> {
  const rows = (await query(`SELECT r.id,r.step,r.answers,r.last_activity_at,p.full_name,p.phone
    FROM public.access_requests r JOIN public.profiles p ON p.id=r.user_id
    WHERE r.status='draft' AND r.abandoned_notified_at IS NULL AND p.tenant_id IS NULL
      AND r.last_activity_at < now() - make_interval(mins => $1::int)
    ORDER BY r.last_activity_at LIMIT $2::int`, [Math.max(1, Math.trunc(minutes)), Math.min(100, Math.max(1, Math.trunc(limit)))])).rows
  return rows.map(row => ({ id: String(row.id), step: String(row.step), answers: storedAnswers(row.answers),
    full_name: text(row.full_name), phone: text(row.phone), last_activity_at: iso(row.last_activity_at) }))
}

/** Marks one abandoned draft as announced. False when another run already did it. */
export async function markAbandonedNotified(query: AdminMenuQuery, id: string) {
  if (!UUID.test(id)) return false
  return (await query(`UPDATE public.access_requests SET abandoned_notified_at=now()
    WHERE id=$1 AND status='draft' AND abandoned_notified_at IS NULL RETURNING id`, [id])).rows.length === 1
}
