import { createServiceClient } from '../supabase/server'
import { getTenantCapabilities } from '../tenant-plan'
import { resolveTimeZone } from '../chat-context'
import { adminMenusOwned, type AdminMenuContext } from '../data/admin-menus'
import { readOwnedAdminAnalytics } from '../data/admin-analytics-runtime'
import type { AnalyticsDashboardData, AnalyticsWindow } from '../data/admin-analytics'

export async function loadAdminAnalytics(context: AdminMenuContext,window: AnalyticsWindow): Promise<AnalyticsDashboardData> {
  if (adminMenusOwned()) return readOwnedAdminAnalytics(context,window)
  const service=createServiceClient()
  const params={p_tenant_id:context.tenantId,p_started_at:window.startedAt,p_ended_at:window.endedAt,p_menu_id:window.menuId,p_location_id:window.locationId}
  const [overview,previous,products,menus,locations,settings,upsell,attribution,capabilities]=await Promise.all([
    service.rpc('get_menu_analytics_overview',params),service.rpc('get_menu_analytics_overview',{...params,p_started_at:window.previousStartedAt,p_ended_at:window.startedAt}),
    service.rpc('get_menu_product_analytics',params),service.from('menus').select('id, name').eq('tenant_id',context.tenantId).order('position'),
    service.from('locations').select('id, name').eq('tenant_id',context.tenantId).eq('is_active',true).order('name'),
    service.from('tenant_settings').select('currency, country, region, analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos').eq('tenant_id',context.tenantId).maybeSingle(),
    service.rpc('get_menu_upsell_analytics',params),service.rpc('get_order_attribution',{p_tenant_id:context.tenantId,p_started_at:window.startedAt,p_ended_at:window.endedAt,p_location_id:window.locationId}),
    getTenantCapabilities(context.tenantId),
  ])
  const timeZone=resolveTimeZone({country:settings.data?.country,region:settings.data?.region,currency:settings.data?.currency})??'UTC'
  const engagement=await service.rpc('get_menu_engagement',{...params,p_time_zone:timeZone})
  return {overview:overview.data?.[0],previousOverview:previous.data?.[0],products:Array.isArray(products.data)?products.data:[],menus:menus.data??[],locations:locations.data??[],
    settings:settings.data,upsell:upsell.data,attribution:attribution.data,engagement:engagement.data,capabilities,unavailable:Boolean(overview.error||products.error)}
}
