import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Eye,
  Lightbulb,
  MousePointerClick,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/utils'
import {
  buildRecommendations,
  EMPTY_ANALYTICS_OVERVIEW,
  enrichProductAnalytics,
  formatPercent,
  normalizeOverview,
  normalizeProductAnalytics,
  safeRate,
  type ProductAnalyticsRow,
} from '@/lib/analytics/dashboard'
import AnalyticsSettingsPanel, { type AnalyticsExperienceSettings } from './AnalyticsSettingsPanel'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const effective = await getEffectiveTenant()
  if (!effective) return null

  const params = await searchParams
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30
  const menuId = readUuid(params.menu)
  const locationId = readUuid(params.location)
  const endedAt = new Date()
  const startedAt = new Date(endedAt.getTime() - days * 86_400_000)
  const previousStartedAt = new Date(startedAt.getTime() - days * 86_400_000)
  const service = createServiceClient()
  const rpcParams = {
    p_tenant_id: effective.tenantId,
    p_started_at: startedAt.toISOString(),
    p_ended_at: endedAt.toISOString(),
    p_menu_id: menuId,
    p_location_id: locationId,
  }
  const previousRpcParams = {
    ...rpcParams,
    p_started_at: previousStartedAt.toISOString(),
    p_ended_at: startedAt.toISOString(),
  }

  const [
    overviewResult,
    previousOverviewResult,
    productsResult,
    menusResult,
    locationsResult,
    settingsResult,
  ] = await Promise.all([
    service.rpc('get_menu_analytics_overview', rpcParams),
    service.rpc('get_menu_analytics_overview', previousRpcParams),
    service.rpc('get_menu_product_analytics', rpcParams),
    service.from('menus').select('id, name').eq('tenant_id', effective.tenantId).order('position'),
    service.from('locations').select('id, name').eq('tenant_id', effective.tenantId).eq('is_active', true).order('name'),
    service.from('tenant_settings').select('currency, analytics_enabled, visual_feed_enabled, menu_default_view, feed_autoplay_videos').eq('tenant_id', effective.tenantId).maybeSingle(),
  ])

  const overview = normalizeOverview(overviewResult.data?.[0] ?? EMPTY_ANALYTICS_OVERVIEW)
  const previous = normalizeOverview(previousOverviewResult.data?.[0] ?? EMPTY_ANALYTICS_OVERVIEW)
  const rawProducts: unknown[] = Array.isArray(productsResult.data) ? productsResult.data : []
  const products = rawProducts
    .map((row: unknown) => normalizeProductAnalytics(row))
    .filter((row): row is ProductAnalyticsRow => row !== null)
    .map(row => enrichProductAnalytics(row))
  const recommendations = buildRecommendations(products)
  const currency = settingsResult.data?.currency ?? 'USD'
  const settings: AnalyticsExperienceSettings = {
    analytics_enabled: settingsResult.data?.analytics_enabled ?? true,
    visual_feed_enabled: settingsResult.data?.visual_feed_enabled ?? false,
    menu_default_view: settingsResult.data?.menu_default_view === 'feed' ? 'feed' : 'list',
    feed_autoplay_videos: settingsResult.data?.feed_autoplay_videos ?? true,
  }
  const unavailable = Boolean(overviewResult.error || productsResult.error)

  const kpis = [
    { label: 'Menu sessions', value: compact(overview.sessions), previous: previous.sessions, current: overview.sessions, icon: Users, help: 'Anonymous menu visits started in this period.' },
    { label: 'Completed orders', value: compact(overview.completed_orders), previous: previous.completed_orders, current: overview.completed_orders, icon: ReceiptText, help: 'Trusted completed-order events attributed to a menu session.' },
    { label: 'Conversion', value: formatPercent(safeRate(overview.completed_orders, overview.sessions)), previous: safeRate(previous.completed_orders, previous.sessions), current: safeRate(overview.completed_orders, overview.sessions), icon: MousePointerClick, help: 'Completed orders divided by menu sessions.' },
    { label: 'Revenue', value: formatPrice(overview.revenue, currency), previous: previous.revenue, current: overview.revenue, icon: WalletCards, help: 'Revenue from attributed completed orders.' },
    { label: 'Average order', value: formatPrice(overview.avg_order_value, currency), previous: previous.avg_order_value, current: overview.avg_order_value, icon: ShoppingBag, help: 'Attributed revenue divided by completed orders.' },
    { label: 'Revenue / session', value: formatPrice(overview.revenue_per_session, currency), previous: previous.revenue_per_session, current: overview.revenue_per_session, icon: BarChart3, help: 'Attributed revenue divided by menu sessions.' },
    { label: 'Cart abandonment', value: formatPercent(abandonment(overview.cart_sessions, overview.completed_orders)), previous: abandonment(previous.cart_sessions, previous.completed_orders), current: abandonment(overview.cart_sessions, overview.completed_orders), icon: ArrowDownRight, help: 'Sessions that added to cart without a completed order.' },
    { label: 'Checkout abandonment', value: formatPercent(abandonment(overview.checkout_sessions, overview.completed_orders)), previous: abandonment(previous.checkout_sessions, previous.completed_orders), current: abandonment(overview.checkout_sessions, overview.completed_orders), icon: ArrowDownRight, help: 'Sessions that started checkout without a completed order.' },
    { label: 'Time to order', value: duration(overview.median_time_to_order_seconds), previous: previous.median_time_to_order_seconds, current: overview.median_time_to_order_seconds, icon: Clock3, help: 'Median time from session start to the first completed order.' },
  ]

  const funnel = [
    { label: 'Menu sessions', value: overview.sessions },
    { label: 'Engaged', value: overview.engaged_sessions },
    { label: 'Details / customization', value: overview.detail_sessions },
    { label: 'Added to cart', value: overview.cart_sessions },
    { label: 'Checkout started', value: overview.checkout_sessions },
    { label: 'Order completed', value: overview.completed_orders },
  ]

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-5 border-b border-zinc-200 pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-primary">
            <BarChart3 className="size-5" /> Product intelligence
          </div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">See what earns attention — and orders.</h1>
          <p className="mt-2 max-w-2xl text-sm font-medium text-zinc-500">Session-level signals connected to trusted order outcomes. Recommendations describe observed behavior, not customer intent.</p>
        </div>
        <form className="grid grid-cols-3 gap-2" aria-label="Analytics filters">
          <Select name="days" defaultValue={String(days)} label="Period" options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} />
          <Select name="menu" defaultValue={menuId ?? ''} label="Menu" options={[['', 'All menus'], ...(menusResult.data ?? []).map(row => [row.id, row.name] as [string, string])]} />
          <Select name="location" defaultValue={locationId ?? ''} label="Location" options={[['', 'All locations'], ...(locationsResult.data ?? []).map(row => [row.id, row.name] as [string, string])]} />
          <button type="submit" className="col-span-3 min-h-10 rounded-xl bg-zinc-950 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-zinc-800">Apply filters</button>
        </form>
      </header>

      <AnalyticsSettingsPanel initialSettings={settings} canEdit={effective.role !== 'store-staff'} />

      {unavailable ? (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">
          Analytics tables are not available in this environment yet. Apply the menu analytics migrations to begin collecting and reporting data.
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map(kpi => (
          <article key={kpi.label} className="group rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-zinc-950 text-white"><kpi.icon className="size-4" /></div>
              <Delta current={kpi.current} previous={kpi.previous} inverse={kpi.label.includes('abandonment') || kpi.label === 'Time to order'} />
            </div>
            <p className="text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">{kpi.value}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">{kpi.label}</p>
            <p className="mt-3 hidden text-[11px] leading-relaxed text-zinc-500 sm:block">{kpi.help}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-zinc-100 bg-zinc-950 p-5 text-white sm:p-7">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Conversion path</p>
              <h2 className="mt-1 text-xl font-black">Session funnel</h2>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{days} days</span>
          </div>
          <div className="space-y-4">
            {funnel.map((stage, index) => {
              const width = overview.sessions > 0 ? Math.max(5, safeRate(stage.value, overview.sessions) * 100) : 0
              const prior = index === 0 ? stage.value : funnel[index - 1].value
              return (
                <div key={stage.label}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="font-bold text-zinc-300">{stage.label}</span>
                    <span className="font-black tabular-nums">{compact(stage.value)} <span className="ml-1 text-[10px] text-zinc-500">{index === 0 ? '100%' : formatPercent(safeRate(stage.value, prior))}</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${width}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-100 bg-white p-5 sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Lightbulb className="size-5" /></div>
            <div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">Explainable signals</p><h2 className="text-xl font-black text-zinc-950">What to review next</h2></div>
          </div>
          {recommendations.length > 0 ? (
            <div className="space-y-3">
              {recommendations.slice(0, 4).map(item => (
                <article key={item.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3"><div><p className="text-sm font-black text-zinc-950">{item.product_name}</p><p className="text-[10px] font-black uppercase tracking-widest text-primary">{item.title}</p></div><Sparkles className="size-4 shrink-0 text-zinc-300" /></div>
                  <p className="text-xs leading-relaxed text-zinc-600">{item.evidence}</p>
                  <p className="mt-2 text-xs font-bold text-zinc-900">{item.action}</p>
                  <Link href={`/menu/products/${item.product_id}`} className="mt-3 inline-flex text-[10px] font-black uppercase tracking-widest text-primary hover:underline">Review product</Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center"><Eye className="mx-auto mb-3 size-7 text-zinc-300" /><p className="text-sm font-black text-zinc-900">More signal needed</p><p className="mt-1 text-xs leading-relaxed text-zinc-500">Recommendations appear after a product reaches at least 20 unique impression sessions.</p></div>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-100 bg-white">
        <div className="flex flex-col gap-2 border-b border-zinc-100 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
          <div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Product performance</p><h2 className="mt-1 text-xl font-black text-zinc-950">From impression to revenue</h2></div>
          <p className="text-[11px] font-medium text-zinc-500">Rates use unique sessions. “Low data” means fewer than 20 impressions.</p>
        </div>
        {products.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left">
              <thead><tr className="border-b border-zinc-100 bg-zinc-50 text-[10px] font-black uppercase tracking-widest text-zinc-400"><th className="px-6 py-4">Product</th><th className="px-4 py-4">Impressions</th><th className="px-4 py-4">Attention</th><th className="px-4 py-4">Detail rate</th><th className="px-4 py-4">Add rate</th><th className="px-4 py-4">Remove rate</th><th className="px-4 py-4">Orders</th><th className="px-4 py-4">Conversion</th><th className="px-6 py-4 text-right">Revenue</th></tr></thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.product_id} className="border-b border-zinc-100 text-sm last:border-0 hover:bg-zinc-50/70">
                    <td className="px-6 py-4"><Link href={`/menu/products/${product.product_id}`} className="font-black text-zinc-950 hover:text-primary">{product.product_name}</Link>{!product.has_enough_data ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-700">Low data</span> : null}</td>
                    <Metric value={compact(product.impression_sessions)} />
                    <Metric value={`${product.avg_attention_seconds.toFixed(1)}s`} />
                    <Metric value={formatPercent(product.detail_rate)} />
                    <Metric value={formatPercent(product.add_rate)} />
                    <Metric value={formatPercent(product.remove_rate)} />
                    <Metric value={compact(product.purchased_quantity)} />
                    <Metric value={formatPercent(product.purchase_rate)} />
                    <td className="px-6 py-4 text-right font-black tabular-nums text-zinc-950">{formatPrice(product.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center"><BarChart3 className="mx-auto mb-3 size-8 text-zinc-300" /><p className="text-sm font-black text-zinc-950">No product activity in this period</p><p className="mt-1 text-xs text-zinc-500">Enable analytics and visit the public menu to start the funnel.</p></div>
        )}
      </section>
    </div>
  )
}

function Select({ name, label, defaultValue, options }: { name: string; label: string; defaultValue: string; options: [string, string][] }) {
  return <label className="min-w-0"><span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-400">{label}</span><select name={name} defaultValue={defaultValue} className="h-10 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-2 text-xs font-bold text-zinc-800 outline-none focus:border-primary">{options.map(([value, text]) => <option key={value || 'all'} value={value}>{text}</option>)}</select></label>
}

function Metric({ value }: { value: string }) {
  return <td className="px-4 py-4 font-bold tabular-nums text-zinc-700">{value}</td>
}

function Delta({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  if (previous === 0) return <span className="text-[9px] font-black uppercase tracking-widest text-zinc-300">New period</span>
  const change = (current - previous) / Math.abs(previous)
  const positive = inverse ? change <= 0 : change >= 0
  const Icon = change >= 0 ? ArrowUpRight : ArrowDownRight
  return <span className={`inline-flex items-center gap-0.5 text-[10px] font-black ${positive ? 'text-emerald-600' : 'text-red-500'}`}><Icon className="size-3" />{Math.abs(change * 100).toFixed(0)}%</span>
}

function readUuid(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null
}

function abandonment(started: number, completed: number): number {
  return started > 0 ? 1 - safeRate(completed, started) : 0
}

function compact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: value >= 1_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function duration(seconds: number): string {
  if (seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
