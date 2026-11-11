import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { getOwnedPrincipal } from '../auth/owned-principal-runtime'
import { ownedAuthSelected, ownedSessionToken } from '../auth/owned-principal'
import { getIdentityServices } from '../auth/identity-services'
import { ownedAdminTransaction } from './admin-menus-runtime'
import { AdminMenuError } from './admin-menus'
import { createTenant,deleteTenant,mutatePlan,readPlans,readTenants,readTenantMenuRows,tenantSettings,updateTenant,requireTenantAdministrator,
  tenantAdministrationSelected,type TenantAdminContext } from './tenant-administration'

export async function tenantAdministrationContext(): Promise<TenantAdminContext> {
  if (!ownedAuthSelected() || !tenantAdministrationSelected()) throw new AdminMenuError(503,'Native tenant administration is unavailable')
  const principal = await getOwnedPrincipal()
  if (!principal || principal.mustChangePassword || principal.role !== 'superadmin') throw new AdminMenuError(403,'Current platform administrator access is required')
  const current = await headers(), { config } = getIdentityServices()
  const token = ownedSessionToken(current.get('cookie'),new URL(config.origin).protocol === 'https:')
  if (!token) throw new AdminMenuError(401,'Sign in again')
  return { actorId:principal.userId,sessionHash:createHash('sha256').update(token).digest('hex') }
}
export async function ownedPlans(action: 'read'|'create'|'update'|'delete',id?: string,input?: unknown) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction<unknown>(action !== 'read',query => action === 'read' ? readPlans(query,context,id) : mutatePlan(query,context,action,id,input))
}
export async function ownedTenants(action: 'read'|'create'|'update'|'delete',id?: string,input?: unknown) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction<unknown>(action !== 'read',query => action === 'read' ? readTenants(query,context,id)
    : action === 'create' ? createTenant(query,context,input) : action === 'delete' ? deleteTenant(query,context,id ?? '') : updateTenant(query,context,id ?? '',input))
}
export async function ownedTenantSettings(id: string,input?: unknown) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(input !== undefined,query => tenantSettings(query,context,id,input))
}
export async function ownedTenantMenuRows(tenantId: string,menuId?: string,kind: 'menus'|'categories'|'products' = 'menus',categoryId?: string|null) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(false,query => readTenantMenuRows(query,context,tenantId,menuId,kind,categoryId))
}

const text = (value: unknown) => value === null || value === undefined ? null : String(value)
const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value)
const money = (value: unknown) => value === null || value === undefined ? null : Number(value)
const planDto = (row: Record<string,unknown>) => ({ id:String(row.id),name:String(row.name),slug:String(row.slug),description:text(row.description),
  monthly_price:Number(row.monthly_price),annual_price:Number(row.annual_price),transaction_fee_pct:Number(row.transaction_fee_pct ?? 0),
  features:Array.isArray(row.features) ? row.features.filter((item): item is string => typeof item === 'string') : [],is_active:row.is_active === true,
  sort_order:Number(row.sort_order),created_at:date(row.created_at),updated_at:date(row.updated_at) })
export async function ownedPlansPage() {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(false,async query => {
    const rows = await readPlans(query,context)
    if (!Array.isArray(rows)) throw new AdminMenuError(503,'Plan information is unavailable')
    return rows.map(planDto)
  })
}
export async function ownedTenantDirectory() {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(false,async query => {
    await requireTenantAdministrator(query,context)
    const rows = (await query(`SELECT t.id,t.name,t.slug,t.plan,t.is_active,t.created_at,ts.logo_url,s.plan_id,s.status AS subscription_status,
      p.name AS plan_name,p.slug AS plan_slug,o.id AS user_id,o.full_name,
      (SELECT string_agg(DISTINCT b.provider,', ' ORDER BY b.provider) FROM public.app_identity_bindings b WHERE b.user_id=o.id AND b.disabled_at IS NULL) AS provider
      FROM public.tenants t LEFT JOIN public.tenant_settings ts ON ts.tenant_id=t.id
      LEFT JOIN public.tenant_subscriptions s ON s.tenant_id=t.id LEFT JOIN public.plans p ON p.id=s.plan_id
      LEFT JOIN LATERAL (SELECT pr.id,pr.full_name FROM public.profiles pr JOIN public.app_accounts a ON a.id=pr.id
        WHERE pr.tenant_id=t.id AND pr.role IN ('admin','store-admin') AND a.disabled_at IS NULL ORDER BY pr.id LIMIT 1) o ON true
      ORDER BY t.created_at DESC,t.id LIMIT 1001`)).rows
    const independent = (await query(`SELECT p.id AS user_id,p.full_name,p.created_at,
      (SELECT string_agg(DISTINCT b.provider,', ' ORDER BY b.provider) FROM public.app_identity_bindings b WHERE b.user_id=p.id AND b.disabled_at IS NULL) AS provider
      FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id WHERE p.tenant_id IS NULL AND p.role IN ('customer','admin','store-admin')
      AND NOT coalesce(p.must_change_password,false) AND a.disabled_at IS NULL AND EXISTS(SELECT 1 FROM public.app_identity_bindings b WHERE b.user_id=p.id AND b.disabled_at IS NULL)
      ORDER BY p.created_at DESC,p.id LIMIT 1001`)).rows
    const plans = (await query('SELECT id,name,slug,is_active FROM public.plans WHERE is_active ORDER BY sort_order,id LIMIT 1001')).rows
    if ([rows,independent,plans].some(items => items.length > 1000)) throw new AdminMenuError(409,'Directory exceeds the supported limit')
    const client = (row: Record<string,unknown>,assigned: boolean) => ({ id:assigned ? String(row.id) : null,name:text(row.name),slug:text(row.slug),plan:text(row.plan),
      plan_id:text(row.plan_id),plan_name:text(row.plan_name),plan_slug:text(row.plan_slug),subscription_status:text(row.subscription_status),is_active:assigned ? row.is_active === true : null,
      created_at:date(row.created_at),logo_url:text(row.logo_url),user_id:text(row.user_id),email:null,full_name:text(row.full_name),provider:text(row.provider) ?? 'unlinked' })
    return { clients:[...rows.map(row => client(row,true)),...independent.map(row => client(row,false))],plans:plans.map(row => ({ id:String(row.id),name:String(row.name),slug:String(row.slug),is_active:row.is_active === true })) }
  })
}
export async function ownedTenantDetail(id: string) {
  const context = await tenantAdministrationContext()
  return ownedAdminTransaction(false,async query => {
    const { tenant:t,settings } = await tenantSettings(query,context,id)
    const rows = await readTenantMenuRows(query,context,id)
    if (!Array.isArray(rows)) throw new AdminMenuError(503,'Menu information is unavailable')
    const subscriptions = (await query('SELECT * FROM public.tenant_subscriptions WHERE tenant_id=$1',[id])).rows
    const s = subscriptions[0], plan = s ? (await query('SELECT * FROM public.plans WHERE id=$1',[s.plan_id])).rows[0] : undefined
    const plans = (await query('SELECT id,name,slug FROM public.plans WHERE is_active ORDER BY sort_order,id LIMIT 1001')).rows
    if (plans.length > 1000) throw new AdminMenuError(409,'Plan list exceeds the supported limit')
    const switchValue = (key: string) => { const value = settings?.[key]; return typeof value === 'boolean' ? value : null }
    return { tenant:{ id:String(t.id),name:String(t.name),slug:String(t.slug),plan:text(t.plan),is_active:t.is_active === true,created_at:date(t.created_at),logo_url:text(settings?.logo_url),
        xphere_account_id:text(t.xphere_account_id),xphere_contact_id:text(t.xphere_contact_id),xphere_opportunity_id:text(t.xphere_opportunity_id),xphere_synced_at:text(t.xphere_synced_at),xphere_sync_error:text(t.xphere_sync_error),subdomain:text(t.subdomain) },
      initialStaff:[],initialMenus:rows.map(row => ({ id:String(row.id),name:String(row.name),slug:String(row.slug),language:text(row.language),is_active:row.is_active === true,position:Number(row.position),created_at:date(row.created_at),supported_languages:Array.isArray(row.supported_languages) ? row.supported_languages.filter((item): item is string => typeof item === 'string') : [] })),
      businessType:text(settings?.business_type),initialSubscription:s ? { id:String(s.id),tenant_id:id,plan_id:String(s.plan_id),billing_cycle:s.billing_cycle === 'annual' ? 'annual' as const : 'monthly' as const,status:String(s.status),stripe_subscription_id:text(s.stripe_subscription_id),current_period_end:text(s.current_period_end),override_monthly_price:money(s.override_monthly_price),override_annual_price:money(s.override_annual_price),override_transaction_fee_pct:money(s.override_transaction_fee_pct),override_notes:text(s.override_notes),plan:plan ? planDto(plan) : null } : null,
      availablePlans:plans.map(row => ({ id:String(row.id),name:String(row.name),slug:String(row.slug) })),initialSwitches:{ orders_enabled:switchValue('orders_enabled'),direct_orders_enabled:switchValue('direct_orders_enabled'),table_management_enabled:switchValue('table_management_enabled'),tips_enabled:switchValue('tips_enabled'),delivery_enabled:switchValue('delivery_enabled'),upsell_enabled:switchValue('upsell_enabled') },canUseAiTools:false }
  })
}
