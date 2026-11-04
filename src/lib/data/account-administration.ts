import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { UUID } from '../auth/owned-principal'

export type AccountAdminContext = { actorId: string; sessionHash: string; tenantId?: string; platformOnly?: boolean }
export type StaffProof = { userId: string; projectId: string; subject: string; authenticatedAt: number; checkedAt: number }
const HASH = /^[a-f0-9]{64}$/, CODE = /^[A-Za-z0-9_-]{43}$/
const sameId = (left: string,right: string) => left.toLowerCase() === right.toLowerCase()
const roleColumn = "CASE WHEN p.role='admin' THEN 'store-admin' WHEN p.role='super-admin' THEN 'superadmin' ELSE p.role END"
export const accessCodeHash = (code: string) => createHash('sha256').update(code).digest('hex')
export const accountAdministrationSelected = (env: Record<string,string|undefined> = process.env) => env.OWNED_ACCOUNT_ADMIN_ENABLED === 'true'
const denied = (status = 403, message = 'Current account authority is required'): never => { throw new AdminMenuError(status,message) }
const one = (rows: Record<string,unknown>[]) => rows.length === 1 ? rows[0] : null
const date = (value: unknown) => { const parsed = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(parsed.getTime())) denied(503,'Account information is unavailable'); return parsed.toISOString() }

async function serialize(query: AdminMenuQuery) {
  await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
}
async function actor(query: AdminMenuQuery, context: AccountAdminContext, platform = false, lock = false) {
  if (!UUID.test(context.actorId) || !HASH.test(context.sessionHash) || (context.tenantId !== undefined && !UUID.test(context.tenantId))) denied()
  const row = one((await query(`SELECT p.id,${roleColumn} AS role,p.tenant_id,p.must_change_password,a.disabled_at,s.authenticated_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id JOIN public.app_sessions s ON s.user_id=a.id
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject
    WHERE p.id=$1 AND s.token_hash=$2 AND s.session_version=a.session_version AND s.expires_at>now()
      AND a.disabled_at IS NULL AND b.disabled_at IS NULL ${lock ? 'FOR SHARE OF p,a,s,b' : ''}`,[context.actorId,context.sessionHash])).rows)
  if (!row || row.must_change_password || !['superadmin','store-admin'].includes(String(row.role))) denied()
  if ((platform || context.platformOnly) && row.role !== 'superadmin') denied()
  if (!platform && (!context.tenantId || (row.role !== 'superadmin' && row.tenant_id !== context.tenantId))) denied()
  if (context.tenantId && !(await query('SELECT id FROM public.tenants WHERE id=$1',[context.tenantId])).rows.length) denied(404,'Tenant not found')
  return row
}
async function audit(query: AdminMenuQuery, actorId: string, targetId: string, tenantId: string|null, operation: string, recordId = targetId) {
  const values = [tenantId,actorId,recordId,JSON.stringify({ operation,target_user_id:targetId })]
  const rows = (await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
    VALUES($1,$2,'server','app_accounts',$3,'update',$4::jsonb) RETURNING id`,values)).rows
  if (rows.length !== 1 || !(await query('SELECT id FROM public.audit_events WHERE id=$1 AND actor_id=$2 AND record_id=$3',[rows[0].id,actorId,recordId])).rows.length) denied(503,'Account audit is unavailable')
}
async function revoke(query: AdminMenuQuery, userId: string) {
  const rows = (await query('UPDATE public.app_accounts SET session_version=session_version+1 WHERE id=$1 AND disabled_at IS NULL RETURNING session_version',[userId])).rows
  if (rows.length !== 1) denied(409,'Account is unavailable')
  await query('DELETE FROM public.app_sessions WHERE user_id=$1',[userId])
  return Number(rows[0].session_version)
}
async function staffCapacity(query: AdminMenuQuery, tenantId: string, userId: string) {
  const row = one((await query(`SELECT count(*)::int AS count FROM (SELECT p.id FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
    WHERE p.tenant_id=$1 AND p.role='store-staff' AND a.disabled_at IS NULL AND p.id<>$2 LIMIT 1000) bounded`,[tenantId,userId])).rows)
  if (!row || Number(row.count) >= 1000) denied(409,'This store has reached the supported staff limit')
}
async function target(query: AdminMenuQuery, id: string, tenantId?: string) {
  if (!UUID.test(id)) denied(404,'Account not found')
  const row = one((await query(`SELECT p.id,p.role,p.tenant_id,p.full_name,p.phone,p.created_at,p.must_change_password,a.session_version,a.disabled_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1 FOR UPDATE OF p,a`,[id])).rows)
  if (!row || row.disabled_at || (tenantId && (row.tenant_id !== tenantId || row.role !== 'store-staff'))) denied(404,'Account not found')
  return row
}

export async function listAdminAccounts(query: AdminMenuQuery, context: AccountAdminContext) {
  await actor(query,context,true)
  const rows = (await query(`SELECT p.id,${roleColumn} AS role,p.tenant_id,p.full_name,p.phone,p.created_at,a.disabled_at,
    CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug) END AS tenant,
    (SELECT string_agg(DISTINCT b.provider,', ' ORDER BY b.provider) FROM public.app_identity_bindings b WHERE b.user_id=p.id AND b.disabled_at IS NULL) AS provider,
    (SELECT max(s.created_at) FROM public.app_sessions s WHERE s.user_id=p.id) AS last_sign_in_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id LEFT JOIN public.tenants t ON t.id=p.tenant_id
    WHERE a.disabled_at IS NULL ORDER BY p.created_at DESC,p.id LIMIT 1001`)).rows
  if (rows.length > 1000) denied(409,'Account list exceeds the supported limit')
  return rows.map(row => ({ ...row,email:null,provider:row.provider ?? 'unlinked',created_at:date(row.created_at),last_sign_in_at:row.last_sign_in_at ? date(row.last_sign_in_at) : null }))
}
export async function listStaffAccounts(query: AdminMenuQuery, context: AccountAdminContext) {
  await actor(query,context)
  const rows = (await query(`SELECT p.id,p.full_name,p.phone,p.created_at,p.must_change_password FROM public.profiles p
    JOIN public.app_accounts a ON a.id=p.id WHERE p.tenant_id=$1 AND p.role='store-staff' AND a.disabled_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1001`,[context.tenantId])).rows
  if (rows.length > 1000) denied(409,'Staff list exceeds the supported limit')
  return rows.map(row => ({ ...row,email:null,created_at:date(row.created_at) }))
}
export async function changeAccountAccess(query: AdminMenuQuery, context: AccountAdminContext, userId: string, input: unknown) {
  await serialize(query); await actor(query,context,true,true)
  if (sameId(userId,context.actorId)) denied(400,'You cannot change your own access')
  const current = await target(query,userId)
  if (!input || typeof input !== 'object' || Array.isArray(input)) denied(400,'Invalid account update')
  const body = input as Record<string,unknown>
  if (!Object.keys(body).length || Object.keys(body).some(key => !['role','tenant_id'].includes(key))) denied(400,'Invalid account update')
  const role = typeof body.role === 'string' ? body.role.trim() : null
  if (!['superadmin','store-admin','store-staff','customer'].includes(String(role))) denied(400,'Choose an explicit account role')
  const tenantId = ['store-admin','store-staff'].includes(String(role)) && typeof body.tenant_id === 'string' ? body.tenant_id.trim() : null
  if (['store-admin','store-staff'].includes(String(role)) && (!tenantId || !UUID.test(tenantId))) denied(400,'Store Admin/Staff must be linked to a tenant')
  if (tenantId && !(await query('SELECT id FROM public.tenants WHERE id=$1 FOR SHARE',[tenantId])).rows.length) denied(404,'Tenant not found')
  if (role === 'store-staff') await staffCapacity(query,tenantId!,userId)
  await revoke(query,userId)
  await query('UPDATE public.app_staff_access_codes SET revoked_at=now() WHERE recipient_user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[userId])
  const rows = (await query('UPDATE public.profiles SET role=$2,tenant_id=$3 WHERE id=$1 RETURNING id,role,tenant_id,full_name',[userId,role,tenantId])).rows
  await audit(query,context.actorId,userId,tenantId ?? current.tenant_id as string|null,'access-changed')
  return rows[0]
}
export async function disableAccount(query: AdminMenuQuery, context: AccountAdminContext, userId: string) {
  await serialize(query); await actor(query,context,true,true)
  if (sameId(userId,context.actorId)) denied(400,'You cannot disable your own account')
  const current = await target(query,userId)
  await revoke(query,userId)
  await query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1',[userId])
  await query('UPDATE public.app_staff_access_codes SET revoked_at=now() WHERE recipient_user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[userId])
  await audit(query,context.actorId,userId,current.tenant_id as string|null,'disabled')
  return { success:true,disabled:true }
}
export async function removeStaffAccount(query: AdminMenuQuery, context: AccountAdminContext, userId: string) {
  await serialize(query); await actor(query,context,false,true)
  await target(query,userId,context.tenantId); await revoke(query,userId)
  await query("UPDATE public.profiles SET role='customer',tenant_id=NULL WHERE id=$1",[userId])
  await query('UPDATE public.app_staff_access_codes SET revoked_at=now() WHERE recipient_user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[userId])
  await audit(query,context.actorId,userId,context.tenantId!,'staff-revoked')
  return { ok:true }
}

export async function issueStaffAccess(query: AdminMenuQuery, context: AccountAdminContext, recipientId: string, kind: 'invite'|'recovery') {
  await serialize(query); await actor(query,context,false,true)
  const user = await target(query,recipientId,kind === 'recovery' ? context.tenantId : undefined)
  if (sameId(recipientId,context.actorId)) denied(400,'Choose another account')
  if (kind === 'invite' && (user.role !== 'customer' || user.tenant_id || user.must_change_password)) denied(409,'Invite an independent verified customer account without existing company access')
  if (!(await query('SELECT user_id FROM public.app_identity_bindings WHERE user_id=$1 AND disabled_at IS NULL LIMIT 1',[recipientId])).rows.length) denied(409,'The recipient must first register and verify their own phone or Google account')
  if (kind === 'recovery' && user.must_change_password) {
    const ownCase = (await query(`SELECT id FROM public.app_staff_access_codes WHERE recipient_user_id=$1 AND tenant_id=$2 AND kind='recovery'
      AND expected_session_version=$3 AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE`,[recipientId,context.tenantId,user.session_version])).rows
    if (ownCase.length !== 1) denied(409,'Historical recovery restrictions require independent reviewed recovery')
  }
  const version = kind === 'recovery' ? await revoke(query,recipientId) : Number(user.session_version)
  if (kind === 'recovery') await query('UPDATE public.profiles SET must_change_password=true,password_changed_at=NULL WHERE id=$1',[recipientId])
  await query('UPDATE public.app_staff_access_codes SET revoked_at=now() WHERE recipient_user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[recipientId])
  const id = randomUUID(),code = randomBytes(32).toString('base64url')
  const rows = (await query(`INSERT INTO public.app_staff_access_codes(id,kind,token_hash,recipient_user_id,tenant_id,issued_by,expected_session_version,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '30 minutes') RETURNING expires_at`,[id,kind,accessCodeHash(code),recipientId,context.tenantId,context.actorId,version])).rows
  await audit(query,context.actorId,recipientId,context.tenantId!,kind === 'invite' ? 'staff-invited' : 'staff-reset-issued',id)
  return { id,code,expires_at:date(rows[0]?.expires_at),kind,recipient_user_id:recipientId }
}

export async function completeStaffAccess(query: AdminMenuQuery, proof: StaffProof, kind: 'invite'|'recovery', code: string) {
  if (!UUID.test(proof.userId) || !CODE.test(code) || !Number.isSafeInteger(proof.authenticatedAt) || !Number.isSafeInteger(proof.checkedAt) || proof.checkedAt<=0 || Date.now()/1000-proof.authenticatedAt>300
    || Date.now()/1000-proof.authenticatedAt < -5 || Date.now()-proof.checkedAt>5000 || proof.checkedAt>Date.now()+5000) denied(401,'A fresh verified phone or Google sign-in is required')
  await serialize(query)
  const request = one((await query(`SELECT * FROM public.app_staff_access_codes WHERE token_hash=$1 AND kind=$2 AND recipient_user_id=$3
    AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE`,[accessCodeHash(code),kind,proof.userId])).rows)
  if (!request) denied(409,'This access link is invalid, expired or already used. Sign in if you already accepted it.')
  if (kind === 'recovery' && proof.authenticatedAt*1000 < new Date(String(request.created_at)).getTime()-5000) denied(401,'Verify your phone or Google account again after this reset')
  const current = await target(query,proof.userId)
  if (Number(current.session_version) !== Number(request.expected_session_version)) denied(409,'Account access changed; request a new link')
  const issuer = one((await query(`SELECT ${roleColumn} AS role,p.tenant_id,p.must_change_password,a.disabled_at FROM public.profiles p
    JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1 FOR SHARE OF p,a`,[request.issued_by])).rows)
  if (!issuer || issuer.disabled_at || issuer.must_change_password || (issuer.role !== 'superadmin' && (issuer.role !== 'store-admin' || issuer.tenant_id !== request.tenant_id))) denied()
  if (!(await query('SELECT id FROM public.tenants WHERE id=$1 FOR SHARE',[request.tenant_id])).rows.length) denied(404,'Tenant not found')
  if (!(await query(`SELECT user_id FROM public.app_identity_bindings WHERE user_id=$1 AND project_id=$2 AND subject=$3 AND disabled_at IS NULL FOR SHARE`,[proof.userId,proof.projectId,proof.subject])).rows.length) denied()
  if (kind === 'invite') {
    if (current.role !== 'customer' || current.tenant_id || current.must_change_password) denied(409,'Account access changed')
    await staffCapacity(query,request.tenant_id as string,proof.userId)
    await query("UPDATE public.profiles SET role='store-staff',tenant_id=$2 WHERE id=$1",[proof.userId,request.tenant_id])
  } else {
    if (current.role !== 'store-staff' || current.tenant_id !== request.tenant_id || !current.must_change_password) denied(409,'This exact recovery restriction is no longer active')
    await query('UPDATE public.profiles SET must_change_password=false WHERE id=$1',[proof.userId])
  }
  await revoke(query,proof.userId)
  await query('UPDATE public.app_staff_access_codes SET used_at=now() WHERE id=$1',[request.id])
  await audit(query,proof.userId,proof.userId,request.tenant_id as string,kind === 'invite' ? 'staff-invite-accepted' : 'staff-recovery-completed',request.id as string)
  if (Date.now()-proof.checkedAt>5000) denied(401,'Verification expired; sign in again')
  return { userId:proof.userId }
}
