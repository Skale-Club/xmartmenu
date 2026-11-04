import { randomUUID } from 'node:crypto'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { UUID } from '../auth/owned-principal'
import { validateTenantSlug } from '../admin/tenant-management'
import { initialSettingsForPlan, liveFeatures } from '../plan-settings'
import { planCeiling } from '../service-modes'
import { SERVICE_SETTINGS_KEYS, validateServiceSettingsPatch } from '../service-settings'

export type TenantAdminContext = { actorId: string; sessionHash: string }
export const tenantAdministrationSelected = (env: Record<string,string|undefined> = process.env) => env.OWNED_TENANT_ADMIN_ENABLED === 'true'
function refuse(status = 403,message = 'Current platform administrator access is required'): never { throw new AdminMenuError(status,message) }
const single = (rows: Record<string,unknown>[]) => rows.length === 1 ? rows[0] : null
const bounded = (rows: Record<string,unknown>[]) => { if (rows.length > 1000) refuse(409,'This list exceeds the supported limit'); return rows }
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value
function dto(row: Record<string,unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key,iso(value)]))
}
export async function requireTenantAdministrator(query: AdminMenuQuery,context: TenantAdminContext,write = false) {
  if (!UUID.test(context.actorId) || !/^[a-f0-9]{64}$/.test(context.sessionHash)) refuse()
  // Shared with account administration: a role/ownership change cannot race a
  // tenant write or remove the last administrator during this operation.
  if (write) await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
  const row = single((await query(`SELECT p.id FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
    JOIN public.app_sessions s ON s.user_id=a.id JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject
    WHERE p.id=$1 AND p.role IN ('superadmin','super-admin') AND NOT coalesce(p.must_change_password,false)
      AND a.disabled_at IS NULL AND b.disabled_at IS NULL AND s.token_hash=$2
      AND s.session_version=a.session_version AND s.expires_at>now() ${write ? 'FOR SHARE OF p,a,s,b' : ''}`,[context.actorId,context.sessionHash])).rows)
  if (!row) refuse()
}
async function audit(query: AdminMenuQuery,context: TenantAdminContext,table: 'tenants'|'plans'|'tenant_settings',id: string,action: 'insert'|'update'|'delete',tenantId: string|null = null) {
  const rows = (await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
    VALUES($1,$2,'server',$3,$4,$5,'{}'::jsonb) RETURNING id`,[tenantId,context.actorId,table,id,action])).rows
  if (rows.length !== 1 || !(await query('SELECT id FROM public.audit_events WHERE id=$1 AND actor_id=$2 AND record_id=$3',[rows[0].id,context.actorId,id])).rows.length) refuse(503,'Administration audit is unavailable')
}
function object(input: unknown,keys: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) refuse(400,'Invalid request body')
  const body = input as Record<string,unknown>
  if (!Object.keys(body).length || Object.keys(body).some(key => !keys.includes(key))) refuse(400,'Unsupported request fields')
  return body
}
const PLAN_FIELDS = ['name','description','monthly_price','annual_price','transaction_fee_pct','features','is_active','sort_order'] as const
export function validatePlan(input: unknown,current?: Record<string,unknown>) {
  const body = object(input,PLAN_FIELDS), result: Record<string,unknown> = { ...(current ?? {}),...body }
  if (typeof result.name !== 'string' || !result.name.trim() || result.name.length > 200) refuse(400,'A plan name is required')
  result.name = result.name.trim()
  if (result.description !== undefined && result.description !== null && (typeof result.description !== 'string' || result.description.length > 5000)) refuse(400,'Invalid description')
  result.description ??= null
  for (const key of ['monthly_price','annual_price','transaction_fee_pct']) {
    const value = result[key] ?? (key === 'transaction_fee_pct' ? 0 : undefined)
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'transaction_fee_pct' ? 9.9999 : 99999999.99)) refuse(400,'Invalid price or transaction fee')
    if (Math.abs(value * (key === 'transaction_fee_pct' ? 10000 : 100) - Math.round(value * (key === 'transaction_fee_pct' ? 10000 : 100))) > 0.00001) refuse(400,'Price precision exceeds storage precision')
    result[key] = value
  }
  if (Number(result.annual_price) < Number(result.monthly_price)) refuse(400,'Annual price must be >= monthly price')
  result.features ??= []; result.is_active ??= true; result.sort_order ??= 0
  if (!Array.isArray(result.features) || result.features.length > 100 || result.features.some(item => typeof item !== 'string' || !item || item.length > 100)) refuse(400,'Invalid plan features')
  if (typeof result.is_active !== 'boolean' || !Number.isInteger(result.sort_order) || Math.abs(Number(result.sort_order)) > 2147483647) refuse(400,'Invalid plan availability or sort order')
  result.slug = result.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  if (!result.slug) refuse(400,'Choose a plan name with letters or numbers')
  return Object.fromEntries([...PLAN_FIELDS,'slug'].map(key => [key,result[key]]))
}
const PLAN_SELECT = 'p.*,p.monthly_price::float8 AS monthly_price,p.annual_price::float8 AS annual_price,p.transaction_fee_pct::float8 AS transaction_fee_pct'
export async function readPlans(query: AdminMenuQuery,context: TenantAdminContext,id?: string) {
  await requireTenantAdministrator(query,context)
  if (id && !UUID.test(id)) refuse(404,'Plan not found')
  const rows = bounded((await query(`SELECT ${PLAN_SELECT} FROM public.plans p ${id ? 'WHERE p.id=$1' : ''} ORDER BY p.sort_order,p.id LIMIT 1001`,id ? [id] : [])).rows).map(dto)
  if (id && !rows.length) refuse(404,'Plan not found')
  return id ? rows[0] : rows
}
export async function mutatePlan(query: AdminMenuQuery,context: TenantAdminContext,action: 'create'|'update'|'delete',id?: string,input?: unknown) {
  await requireTenantAdministrator(query,context,true)
  if (action !== 'create' && (!id || !UUID.test(id))) refuse(404,'Plan not found')
  const current = action === 'create' ? undefined : single((await query(`SELECT ${PLAN_SELECT} FROM public.plans p WHERE p.id=$1 FOR UPDATE`,[id])).rows) ?? undefined
  if (action !== 'create' && !current) refuse(404,'Plan not found')
  const targetId = id ?? randomUUID()
  if (action === 'delete') {
    if (current?.stripe_product_id || current?.stripe_price_monthly_id || current?.stripe_price_annual_id || (await query('SELECT id FROM public.tenant_subscriptions WHERE plan_id=$1 LIMIT 1',[id])).rows.length) refuse(409,'This plan has billing dependencies. Deactivate it instead.')
    await query('DELETE FROM public.plans WHERE id=$1',[id]); await audit(query,context,'plans',targetId,'delete'); return null
  }
  const values = validatePlan(input,current)
  if ((await query('SELECT id FROM public.plans WHERE slug=$1 AND id<>$2 LIMIT 1',[values.slug,targetId])).rows.length) refuse(409,'A plan with this URL already exists')
  const keys = Object.keys(values)
  if (action === 'create') await query(`INSERT INTO public.plans(id,${keys.join(',')}) VALUES($1,${keys.map((_,index) => '$'+(index+2)).join(',')})`,[targetId,...keys.map(key => key === 'features' ? JSON.stringify(values[key]) : values[key])])
  else await query(`UPDATE public.plans SET ${keys.map((key,index) => `${key}=$${index+2}`).join(',')},updated_at=now() WHERE id=$1`,[targetId,...keys.map(key => key === 'features' ? JSON.stringify(values[key]) : values[key])])
  await audit(query,context,'plans',targetId,action === 'create' ? 'insert' : 'update')
  return dto((await query(`SELECT ${PLAN_SELECT} FROM public.plans p WHERE p.id=$1`,[targetId])).rows[0])
}
export async function readTenants(query: AdminMenuQuery,context: TenantAdminContext,id?: string) {
  await requireTenantAdministrator(query,context)
  if (id && !UUID.test(id)) refuse(404,'Restaurant not found')
  const rows = bounded((await query(`SELECT t.*,s.logo_url FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id
    ${id ? 'WHERE t.id=$1' : ''} ORDER BY t.created_at DESC,t.id LIMIT 1001`,id ? [id] : [])).rows).map(dto)
  if (id && !rows.length) refuse(404,'Restaurant not found')
  return id ? rows[0] : rows
}
export async function createTenant(query: AdminMenuQuery,context: TenantAdminContext,input: unknown) {
  await requireTenantAdministrator(query,context,true)
  const body = object(input,['name','slug','owner_user_id','plan_id'])
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 || typeof body.owner_user_id !== 'string' || !UUID.test(body.owner_user_id) || body.owner_user_id.toLowerCase() === context.actorId.toLowerCase()) refuse(400,'Choose a restaurant name and exact independent verified owner account ID')
  const slug = validateTenantSlug(body.slug); if (!slug.ok || slug.slug.length > 100) refuse(400,slug.ok ? 'Restaurant URL is too long' : slug.error)
  if (body.plan_id !== undefined && (typeof body.plan_id !== 'string' || !UUID.test(body.plan_id))) refuse(400,'Choose an active subscription plan')
  const plan = single((await query(`SELECT id,name,slug,features FROM public.plans WHERE ${body.plan_id ? 'id=$1' : "slug='menu'"} AND is_active FOR SHARE`,body.plan_id ? [body.plan_id] : [])).rows)
  if (!plan) refuse(400,'Choose an active subscription plan')
  const count = (await query('SELECT count(*)::int AS count FROM (SELECT id FROM public.tenants LIMIT 1000) bounded')).rows[0]
  if (!count || Number(count.count) >= 1000) refuse(409,'The supported restaurant limit has been reached')
  const owner = single((await query(`SELECT p.id,p.role,p.tenant_id,p.must_change_password,a.disabled_at FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id WHERE p.id=$1 FOR UPDATE OF p,a`,[body.owner_user_id])).rows)
  if (!owner || owner.tenant_id || owner.must_change_password || owner.disabled_at || !['customer','store-admin','admin'].includes(String(owner.role))) refuse(409,'Choose an independent active verified account without existing company access')
  if (!(await query('SELECT user_id FROM public.app_identity_bindings WHERE user_id=$1 AND disabled_at IS NULL FOR SHARE',[owner.id])).rows.length) refuse(409,'The owner must first verify their own phone or Google account')
  if ((await query('SELECT id FROM public.tenants WHERE slug=$1',[slug.slug])).rows.length) refuse(409,'This restaurant URL is already in use')
  const id = randomUUID()
  const tenant = (await query('INSERT INTO public.tenants(id,name,slug,plan) VALUES($1,$2,$3,$4) RETURNING *',[id,body.name.trim(),slug.slug,plan.slug])).rows[0]
  const settings = initialSettingsForPlan(plan.features as string[]|null), keys = Object.keys(settings)
  await query(`INSERT INTO public.tenant_settings(tenant_id,${keys.join(',')}) VALUES($1,${keys.map((_,index) => '$'+(index+2)).join(',')})`,[id,...Object.values(settings)])
  const subscription = (await query(`INSERT INTO public.tenant_subscriptions(tenant_id,plan_id,billing_cycle,status) VALUES($1,$2,'monthly','active') RETURNING *`,[id,plan.id])).rows[0]
  await query(`INSERT INTO public.menus(tenant_id,name,slug,language,supported_languages,purpose,is_active,is_default,position)
    VALUES($1,'Main Menu','main','en',ARRAY['en'],'restaurant',true,true,0)`,[id])
  await query("UPDATE public.profiles SET tenant_id=$2,role='store-admin' WHERE id=$1",[owner.id,id])
  await query('UPDATE public.app_accounts SET session_version=session_version+1 WHERE id=$1',[owner.id])
  await query('DELETE FROM public.app_sessions WHERE user_id=$1',[owner.id])
  // An intention only. The legacy worker reads Source data and cannot execute
  // this job. A separately reviewed native dispatcher is a cutover dependency.
  await query("INSERT INTO public.app_tenant_effects(tenant_id,kind) VALUES($1,'onboarded')",[id])
  await audit(query,context,'tenants',id,'insert',id)
  return { tenant:dto(tenant),subscription:{ ...dto(subscription),plan:{ id:plan.id,name:plan.name,slug:plan.slug } },owner_id:owner.id,sessionsRevoked:true,externalSync:'pending-native-dispatch' }
}
export async function updateTenant(query: AdminMenuQuery,context: TenantAdminContext,id: string,input: unknown) {
  await requireTenantAdministrator(query,context,true)
  if (!UUID.test(id)) refuse(404,'Restaurant not found')
  const body = object(input,['name','is_active'])
  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200)) refuse(400,'A restaurant name is required')
  if ('is_active' in body && typeof body.is_active !== 'boolean') refuse(400,'Invalid availability')
  const keys = Object.keys(body), row = single((await query(`UPDATE public.tenants SET ${keys.map((key,index) => `${key}=$${index+2}`).join(',')} WHERE id=$1 RETURNING *`,[id,...keys.map(key => typeof body[key] === 'string' ? body[key].trim() : body[key])])).rows)
  if (!row) refuse(404,'Restaurant not found')
  await audit(query,context,'tenants',id,'update',id); return dto(row)
}

/** Remove only an unused local restaurant shell. Any content, finance or
 * unrecognized FK dependency requires archive instead of a destructive cascade. */
export async function deleteTenant(query: AdminMenuQuery,context: TenantAdminContext,id: string) {
  await requireTenantAdministrator(query,context,true)
  if (!UUID.test(id)) refuse(404,'Restaurant not found')
  // Freeze FK-changing DDL while permitting unrelated tenant DML. A stronger
  // table lock here would invert the ordinary tenant-row -> settings write order.
  await query('LOCK TABLE public.tenants,public.tenant_settings,public.menus,public.tenant_subscriptions IN SHARE UPDATE EXCLUSIVE MODE')
  const tenant = single((await query('SELECT * FROM public.tenants WHERE id=$1 FOR UPDATE',[id])).rows)
  if (!tenant) refuse(404,'Restaurant not found')
  const archive = () => refuse(409,'This restaurant has content, history or external dependencies. Deactivate it instead; all records will be preserved.')
  if (Object.entries(tenant).some(([key,value]) => value && (key === 'custom_domain' || /^xphere_.*_id$/.test(key)))) archive()
  const menus = (await query('SELECT * FROM public.menus WHERE tenant_id=$1 FOR UPDATE',[id])).rows
  if (menus.length > 1 || menus.some(row => row.slug !== 'main' || row.name !== 'Main Menu')) archive()
  const subscriptions = (await query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1 FOR UPDATE',[id])).rows
  if (subscriptions.length > 1 || subscriptions.some(row => !['active','trial'].includes(String(row.status)) || Object.entries(row).some(([key,value]) => value !== null && value !== undefined && value !== false && (key.startsWith('stripe_') || key.startsWith('current_period_') || key.startsWith('override_') || ['cancelled_at','canceled_at','trial_end'].includes(key))))) archive()
  const settings = (await query('SELECT * FROM public.tenant_settings WHERE tenant_id=$1 FOR UPDATE',[id])).rows
  // Inspect actual FKs rather than assuming that all cascades in the current
  // installation are harmless. Identifiers come from pg_catalog.quote_ident.
  const dependencies = (await query(`SELECT c.convalidated,c.confdeltype,array_length(c.conkey,1) AS columns,
    parent.relname AS parent,ns.nspname AS child_schema,child.relname AS child,
    quote_ident(ns.nspname)||'.'||quote_ident(child.relname) AS qualified,
    quote_ident(ca.attname) AS child_column,pa.attname AS parent_column
    FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class parent ON parent.oid=c.confrelid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace JOIN pg_catalog.pg_class child ON child.oid=c.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_catalog.pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=c.conkey[1]
    JOIN pg_catalog.pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=c.confkey[1]
    WHERE c.contype='f' AND pn.nspname='public' AND parent.relname=ANY($1::text[])`,[['tenants','menus','tenant_settings','tenant_subscriptions']])).rows
  const parents: Record<string,Record<string,unknown>[]> = { tenants:[tenant],menus,tenant_settings:settings,tenant_subscriptions:subscriptions }
  for (const fk of dependencies) {
    if (!fk.convalidated || Number(fk.columns) !== 1) archive()
    const parent = String(fk.parent),child = String(fk.child),schema = String(fk.child_schema)
    const knownShell = schema === 'public' && parent === 'tenants' && ['tenant_settings','menus','tenant_subscriptions'].includes(child) && fk.parent_column === 'id' && fk.child_column === 'tenant_id' && fk.confdeltype === 'c'
    const preserveProfiles = schema === 'public' && parent === 'tenants' && child === 'profiles' && fk.child_column === 'tenant_id' && fk.parent_column === 'id' && fk.confdeltype === 'n'
    const preserveOutbox = schema === 'public' && parent === 'tenants' && child === 'app_tenant_effects' && fk.child_column === 'tenant_id' && fk.parent_column === 'id' && fk.confdeltype === 'n'
    if (knownShell || preserveProfiles || preserveOutbox) continue
    const values = parents[parent].map(row => row[String(fk.parent_column)]).filter(value => value !== null && value !== undefined)
    if (values.length && (await query(`SELECT 1 FROM ${fk.qualified} WHERE ${fk.child_column}::text=ANY($1::text[]) LIMIT 1`,[values.map(String)])).rows.length) archive()
  }
  // An in-flight or already-delivered job cannot be canceled by a SQL delete.
  const effects = (await query('SELECT id,status FROM public.app_tenant_effects WHERE tenant_id=$1 FOR UPDATE',[id])).rows
  if (effects.some(row => row.status !== 'pending' && row.status !== 'cancelled')) archive()
  await query("UPDATE public.app_tenant_effects SET status='cancelled' WHERE tenant_id=$1 AND status='pending'",[id])
  const accounts = (await query(`SELECT p.id,p.role FROM public.profiles p WHERE p.tenant_id=$1 LIMIT 1001 FOR UPDATE OF p`,[id])).rows
  if (accounts.length > 1000) archive()
  for (const account of accounts) {
    await query(`UPDATE public.profiles SET tenant_id=NULL,role=CASE WHEN role IN ('admin','store-admin','store-staff') THEN 'customer' ELSE role END WHERE id=$1`,[account.id])
    await query('UPDATE public.app_accounts SET session_version=session_version+1 WHERE id=$1',[account.id])
    await query('DELETE FROM public.app_sessions WHERE user_id=$1',[account.id])
  }
  await query('DELETE FROM public.tenants WHERE id=$1',[id])
  await audit(query,context,'tenants',id,'delete',id)
  return { success:true,deleted:true,accountsPreserved:true,sessionsRevoked:true,slug:tenant.slug }
}

const EXTRA_SETTINGS = ['logo_url','primary_color','accent_color','banner_url','address','phone','instagram','business_hours','custom_tags','currency','language','business_type','tagline','about','tip_percentage_1','tip_percentage_2','tip_percentage_3']
export async function tenantSettings(query: AdminMenuQuery,context: TenantAdminContext,id: string,input?: unknown) {
  await requireTenantAdministrator(query,context,input !== undefined)
  if (!UUID.test(id)) refuse(404,'Restaurant not found')
  const tenant = single((await query(`SELECT * FROM public.tenants WHERE id=$1 ${input !== undefined ? 'FOR NO KEY UPDATE' : ''}`,[id])).rows)
  if (!tenant) refuse(404,'Restaurant not found')
  const subscription = input === undefined ? null : single((await query('SELECT s.status,p.features FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 FOR SHARE OF s,p',[id])).rows)
  const current = single((await query(`SELECT * FROM public.tenant_settings WHERE tenant_id=$1 ${input !== undefined ? 'FOR UPDATE' : ''}`,[id])).rows)
  if (input === undefined) return { tenant:dto(tenant),settings:current ? dto(current) : null }
  const body = object(input,[...SERVICE_SETTINGS_KEYS,...EXTRA_SETTINGS])
  const validation = validateServiceSettingsPatch(body,{ plan:planCeiling(liveFeatures(subscription?.status as string,subscription?.features as string[])) },current)
  if (validation.errors.length) refuse(400,validation.errors[0]); if (validation.locked.length) refuse(403,'The current subscription does not include these service settings')
  const values: Record<string,unknown> = { ...validation.patch }
  for (const key of EXTRA_SETTINGS) {
    if (!(key in body)) continue
    const value = body[key]
    if (key.startsWith('tip_percentage_')) { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) refuse(400,'Invalid tip percentage') }
    else if (key === 'business_hours') { if (value !== null && (typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 16384)) refuse(400,'Invalid business hours') }
    else if (key === 'custom_tags') { if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 100)) refuse(400,'Invalid custom tags') }
    else if (value !== null && (typeof value !== 'string' || value.length > (key === 'about' ? 10000 : 2048))) refuse(400,'Invalid settings value')
    if (key.endsWith('_color') && (typeof value !== 'string' || !/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim()))) refuse(400,'Invalid color')
    if (['logo_url','banner_url'].includes(key) && value && (typeof value !== 'string' || !/^https:\/\//i.test(value))) refuse(400,'Use an HTTPS image URL')
    values[key] = key === 'business_hours' ? JSON.stringify(value) : value
  }
  const keys = Object.keys(values)
  if (!keys.length) refuse(400,'No settings supplied')
  const row = (await query(`INSERT INTO public.tenant_settings(tenant_id,${keys.join(',')}) VALUES($1,${keys.map((_,index) => '$'+(index+2)).join(',')})
    ON CONFLICT(tenant_id) DO UPDATE SET ${keys.map(key => `${key}=EXCLUDED.${key}`).join(',')} RETURNING *`,[id,...keys.map(key => values[key])])).rows[0]
  await audit(query,context,'tenant_settings',id,'update',id); return dto(row)
}

export async function readTenantMenuRows(query: AdminMenuQuery,context: TenantAdminContext,tenantId: string,menuId?: string,kind: 'menus'|'categories'|'products' = 'menus',categoryId?: string|null) {
  await requireTenantAdministrator(query,context)
  if (!UUID.test(tenantId) || (menuId && !UUID.test(menuId)) || (categoryId && !UUID.test(categoryId))) refuse(404,'Menu not found')
  if (!(await query('SELECT id FROM public.tenants WHERE id=$1',[tenantId])).rows.length) refuse(404,'Restaurant not found')
  if (kind === 'menus') return bounded((await query('SELECT id,name,slug,language,supported_languages,is_active,position,created_at FROM public.menus WHERE tenant_id=$1 ORDER BY position,id LIMIT 1001',[tenantId])).rows).map(dto)
  if (!menuId || !(await query('SELECT id FROM public.menus WHERE tenant_id=$1 AND id=$2',[tenantId,menuId])).rows.length) refuse(404,'Menu not found')
  if (categoryId && !(await query('SELECT id FROM public.categories WHERE tenant_id=$1 AND menu_id=$2 AND id=$3',[tenantId,menuId,categoryId])).rows.length) refuse(404,'Category not found')
  const table = kind === 'categories' ? 'categories' : 'products'
  return { [table]:bounded((await query(`SELECT id,name FROM public.${table} WHERE tenant_id=$1 AND menu_id=$2 ${categoryId ? 'AND category_id=$3' : ''} ORDER BY position,id LIMIT 1001`,categoryId ? [tenantId,menuId,categoryId] : [tenantId,menuId])).rows) }
}
