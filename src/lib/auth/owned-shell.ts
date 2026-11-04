import type { EffectivePlan, Menu, Plan } from '@/types/database'
import type { ChatAddonStatus } from '@/lib/chat-addon'
import { readAdminMenus } from '@/lib/data/admin-menus'
import { resolveTenantCapabilities, type ServiceSettings } from '@/lib/service-modes'
import { isTenantMemberRole } from './role-utils'
import { UUID, type IdentityQuery, type OwnedPrincipal } from './owned-principal'

export type ShellSettings = ServiceSettings & { primary_color?: string | null; accent_color?: string | null }
interface Subscription {
  billing_cycle: EffectivePlan['billing_cycle']; status: EffectivePlan['status']
  override_monthly_price: number | null; override_annual_price: number | null
  override_transaction_fee_pct: number | null; override_notes: string | null
  chat_addon_active?: boolean; chat_addon_override?: boolean | null
}

/** Same NULL override and active/trial semantics as the legacy plan reader. */
export function shellPlan(subscription: Subscription | null, plan: Plan | null): EffectivePlan | null {
  if (!subscription || !plan) return null
  return { id: plan.id, name: plan.name, slug: plan.slug, description: plan.description,
    monthly_price: subscription.override_monthly_price ?? plan.monthly_price,
    annual_price: subscription.override_annual_price ?? plan.annual_price,
    transaction_fee_pct: subscription.override_transaction_fee_pct ?? plan.transaction_fee_pct,
    features: ['active', 'trial'].includes(subscription.status) ? plan.features : [],
    billing_cycle: subscription.billing_cycle, status: subscription.status,
    is_grandfathered: subscription.override_notes?.includes('grandfathered') ?? false }
}

function authorizedTenant(principal: OwnedPrincipal, tenantId: string) {
  if (principal.mustChangePassword || !UUID.test(tenantId)
    || (principal.role !== 'superadmin' && !(isTenantMemberRole(principal.role) && principal.tenantId === tenantId))) throw new Error('Forbidden')
}
function superadmin(principal: OwnedPrincipal) {
  if (principal.mustChangePassword || principal.role !== 'superadmin') throw new Error('Forbidden')
}
export function brtDayStart(now: Date) {
  return `${new Date(now.getTime()-3*60*60*1000).toISOString().split('T')[0]}T03:00:00.000Z`
}

// Exact read query of get_platform_menu_overview: the private runtime has no
// EXECUTE grant for that legacy RPC. App superadmin authorization precedes it.
export const PLATFORM_ACTIVITY_SQL = `WITH sess AS (
 SELECT tenant_id,COUNT(*) AS sessions,
 percentile_cont(0.5) WITHIN GROUP (ORDER BY LEAST(GREATEST(EXTRACT(EPOCH FROM (last_seen_at-started_at)),0),10800)) AS median_seconds
 FROM public.menu_sessions WHERE is_test=FALSE AND started_at >= $1 AND started_at < $2 GROUP BY tenant_id
), ord AS (
 SELECT tenant_id,COUNT(*) AS orders,SUM(total) AS revenue FROM public.orders
 WHERE created_at >= $1 AND created_at < $2 AND status NOT IN ('cancelled','payment_failed','awaiting_payment') GROUP BY tenant_id
), calls AS (
 SELECT tenant_id,COUNT(*) AS waiter_calls FROM public.waiter_calls WHERE created_at >= $1 AND created_at < $2 GROUP BY tenant_id
)
SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_id',t.id,'name',t.name,'slug',t.slug,'plan',t.plan,
 'currency',coalesce(ts.currency,'USD'),'sessions',coalesce(sess.sessions,0),'median_seconds',coalesce(sess.median_seconds,0),
 'orders',coalesce(ord.orders,0),'revenue',coalesce(ord.revenue,0),'waiter_calls',coalesce(calls.waiter_calls,0))
 ORDER BY coalesce(sess.sessions,0) DESC,t.name),'[]'::jsonb) AS activity
FROM public.tenants t LEFT JOIN public.tenant_settings ts ON ts.tenant_id=t.id
LEFT JOIN sess ON sess.tenant_id=t.id LEFT JOIN ord ON ord.tenant_id=t.id LEFT JOIN calls ON calls.tenant_id=t.id WHERE t.is_active`

export class OwnedShellRepository {
  constructor(readonly query: IdentityQuery) {}

  async platform() {
    const { rows } = await this.query<{ app_name: string | null; cta_color: string | null; favicon_url: string | null }>(
      'SELECT app_name,cta_color,favicon_url FROM public.platform_settings LIMIT 2')
    if (rows.length > 1) throw new Error('Platform singleton unavailable')
    return rows[0] ?? null
  }

  async tenant(principal: OwnedPrincipal, tenantId: string) {
    authorizedTenant(principal, tenantId)
    const [menus, settings, subscription, chat] = await Promise.all([
      readAdminMenus(this.query, { tenantId, role: principal.role }),
      this.query<{ row: ShellSettings }>(`SELECT jsonb_build_object(
        'primary_color',primary_color,'accent_color',accent_color,'orders_enabled',orders_enabled,'direct_orders_enabled',direct_orders_enabled,
        'table_management_enabled',table_management_enabled,'whatsapp_orders_enabled',whatsapp_orders_enabled,'whatsapp',whatsapp,
        'tips_enabled',tips_enabled,'item_notes_enabled',item_notes_enabled,'ingredient_customization_enabled',ingredient_customization_enabled,
        'dine_in_enabled',dine_in_enabled,'pickup_enabled',pickup_enabled,'delivery_enabled',delivery_enabled,'upsell_enabled',upsell_enabled) AS row
        FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2`, [tenantId]),
      this.query<{ subscription: Subscription; plan: Plan & { chat_addon_available?: boolean } }>(
        'SELECT to_jsonb(s) AS subscription,to_jsonb(p) AS plan FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2', [tenantId]),
      this.query<{ enabled: boolean }>('SELECT enabled FROM public.chat_addon_settings WHERE tenant_id=$1 LIMIT 2', [tenantId]),
    ])
    if (settings.rows.length > 1 || subscription.rows.length > 1 || chat.rows.length > 1) throw new Error('Tenant singleton unavailable')
    const selected = subscription.rows[0], plan = shellPlan(selected?.subscription ?? null, selected?.plan ?? null)
    const panelSettings = settings.rows[0]?.row ?? null
    const available = selected?.plan?.chat_addon_available ?? false
    const override = selected?.subscription?.chat_addon_override
    const active = override === true ? true : override === false ? false : available && (selected?.subscription?.chat_addon_active ?? false)
    const chatStatus: ChatAddonStatus = { available: available || override === true, active,
      enabled: active && (chat.rows[0]?.enabled ?? false), overrideApplied: typeof override === 'boolean' }
    return { menus: menus as Menu[], settings: panelSettings, plan,
      capabilities: resolveTenantCapabilities(plan?.features ?? null, panelSettings), chat: chatStatus }
  }

  async dashboard(principal: OwnedPrincipal, tenantId: string, now = new Date()) {
    authorizedTenant(principal, tenantId)
    const { rows } = await this.query<{ products: number; categories: number; scans: number }>(`SELECT
      (SELECT count(*)::int FROM public.products WHERE tenant_id=$1) AS products,
      (SELECT count(*)::int FROM public.categories WHERE tenant_id=$1) AS categories,
      (SELECT count(*)::int FROM public.scan_events WHERE tenant_id=$1 AND scanned_at >= $2) AS scans`, [tenantId, brtDayStart(now)])
    return rows[0] ?? { products: 0, categories: 0, scans: 0 }
  }

  async tenants(principal: OwnedPrincipal) {
    superadmin(principal)
    // Preserve the existing authorized superadmin list DTO, including logo only
    // from tenant_settings. No Auth administration/provider record is read.
    return (await this.query('SELECT t.*,jsonb_build_object(\'logo_url\',s.logo_url) AS tenant_settings FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id ORDER BY t.created_at DESC')).rows
  }

  async overview(principal: OwnedPrincipal, now = new Date()) {
    superadmin(principal)
    const [tenants, profiles, users, scans, activity] = await Promise.all([
      this.query<{ id: string; name: string; slug: string; plan: string; is_active: boolean; created_at: string }>(
        "SELECT id,name,slug,plan,is_active,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at FROM public.tenants"),
      this.query<{ id: string; role: string; tenant_id: string | null }>('SELECT id,role,tenant_id FROM public.profiles'),
      this.query<{ id: string }>('SELECT id FROM public.app_accounts'),
      this.query<{ tenant_id: string }>('SELECT tenant_id FROM public.scan_events WHERE scanned_at >= $1', [brtDayStart(now)]),
      this.query<{ activity: unknown }>(PLATFORM_ACTIVITY_SQL, [new Date(now.getTime()-30*86_400_000).toISOString(), now.toISOString()]),
    ])
    return { tenants: tenants.rows, profiles: profiles.rows, users: users.rows, scans: scans.rows, activity: activity.rows[0]?.activity ?? [] }
  }
}
