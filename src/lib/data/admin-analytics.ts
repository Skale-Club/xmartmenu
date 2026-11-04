import { resolveTimeZone } from '../chat-context'
import { resolveTenantCapabilities, type ServiceSettings, type TenantCapabilities } from '../service-modes'
import { AdminMenuError, type AdminMenuContext, type AdminMenuQuery } from './admin-menus'
import { ANALYTICS_SQL } from './admin-analytics-sql'

export interface AnalyticsWindow { startedAt: string; endedAt: string; previousStartedAt: string; menuId: string | null; locationId: string | null }
export interface AnalyticsMetadata extends ServiceSettings { currency: string | null; country: string | null; region: string | null;
  analytics_enabled: boolean | null; visual_feed_enabled: boolean | null; menu_default_view: string | null; feed_autoplay_videos: boolean | null }
export interface AnalyticsDashboardData {
  overview: unknown; previousOverview: unknown; products: unknown[]; menus: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>; settings: AnalyticsMetadata | null; upsell: unknown; attribution: unknown;
  engagement: unknown; capabilities: TenantCapabilities; unavailable: boolean
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function validate(context: AdminMenuContext, window: AnalyticsWindow) {
  if (!UUID.test(context.tenantId) || !['superadmin','store-admin','store-staff'].includes(context.role)) throw new AdminMenuError(403,'Forbidden')
  const start=Date.parse(window.startedAt),end=Date.parse(window.endedAt),previous=Date.parse(window.previousStartedAt)
  if (![start,end,previous].every(Number.isFinite) || end<=start || end-start>90*86400000 || start-previous!==end-start
    || [window.menuId,window.locationId].some(value => value!==null&&!UUID.test(value))) throw new AdminMenuError(400,'Invalid analytics period')
}
function named(rows: Record<string,unknown>[]) {
  return rows.map(row => { if (typeof row.id!=='string'||!UUID.test(row.id)||typeof row.name!=='string') throw new AdminMenuError(503,'Analytics metadata unavailable');return {id:row.id,name:row.name} })
}
const SETTINGS_COLUMNS = 'currency country region analytics_enabled visual_feed_enabled menu_default_view feed_autoplay_videos orders_enabled direct_orders_enabled table_management_enabled whatsapp_orders_enabled whatsapp tips_enabled item_notes_enabled ingredient_customization_enabled dine_in_enabled pickup_enabled delivery_enabled upsell_enabled'

/** Caller supplies one read-only repeatable-read transaction from the shared admin pool. */
export async function readAdminAnalytics(query: AdminMenuQuery,context: AdminMenuContext,window: AnalyticsWindow): Promise<AnalyticsDashboardData> {
  validate(context,window)
  const [settingsRows,menuRows,locationRows,planRows] = await Promise.all([
    query(`SELECT ${SETTINGS_COLUMNS.split(' ').join(',')} FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2`,[context.tenantId]),
    query('SELECT id,name FROM public.menus WHERE tenant_id=$1 ORDER BY position',[context.tenantId]),
    query('SELECT id,name FROM public.locations WHERE tenant_id=$1 AND is_active=true ORDER BY name',[context.tenantId]),
    query("SELECT CASE WHEN s.status IN ('active','trial') THEN p.features ELSE '[]'::jsonb END AS features FROM public.tenant_subscriptions s JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2",[context.tenantId]),
  ])
  if (settingsRows.rows.length>1||planRows.rows.length>1) throw new AdminMenuError(503,'Ambiguous analytics metadata')
  const settings=(settingsRows.rows[0]??null) as unknown as AnalyticsMetadata|null
  const features=planRows.rows[0]?.features??null
  if (features!==null&&(!Array.isArray(features)||features.some(value=>typeof value!=='string'))) throw new AdminMenuError(503,'Analytics plan unavailable')
  const capabilities=resolveTenantCapabilities(features as string[]|null,settings)
  const timeZone=resolveTimeZone({country:settings?.country,region:settings?.region,currency:settings?.currency})??'UTC'
  const common=[context.tenantId,window.startedAt,window.endedAt,window.menuId,window.locationId]
  const previous=[context.tenantId,window.previousStartedAt,window.startedAt,window.menuId,window.locationId]
  const selections = await Promise.all([
    query(ANALYTICS_SQL.overview.sql,common),query(ANALYTICS_SQL.overview.sql,previous),query(ANALYTICS_SQL.products.sql,common),
    query(ANALYTICS_SQL.upsell.sql,common),query(ANALYTICS_SQL.attribution.sql,[context.tenantId,window.startedAt,window.endedAt,window.locationId]),
    query(ANALYTICS_SQL.engagement.sql,[...common,timeZone]),
  ])
  if (selections.some(result=>result.rows.length!==1)) throw new AdminMenuError(503,'Analytics data unavailable')
  const [overview,previousOverview,products,upsell,attribution,engagement]=selections.map(result=>result.rows[0].data)
  if (!Array.isArray(overview)||!Array.isArray(previousOverview)||!Array.isArray(products)||overview.length!==1||previousOverview.length!==1) throw new AdminMenuError(503,'Analytics data unavailable')
  return {overview:overview[0],previousOverview:previousOverview[0],products,upsell,attribution,engagement,
    settings,menus:named(menuRows.rows),locations:named(locationRows.rows),capabilities,unavailable:false}
}
