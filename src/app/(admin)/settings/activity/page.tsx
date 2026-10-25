export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { History } from 'lucide-react'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { summarizeChanges, TABLE_LABELS } from '@/lib/observability/audit-format'

const PAGE_SIZE = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// What a restaurant can see changed in its own account.
const OWNER_TABLES = [
  'tenant_settings', 'menus', 'categories', 'products', 'product_option_groups', 'product_options',
  'product_media', 'ingredients', 'product_ingredients', 'restaurant_tables', 'locations',
  'delivery_zones', 'chat_addon_settings', 'tenant_ai_settings', 'qr_codes', 'profiles', 'orders',
  'tenant_subscriptions', 'tenants',
] as const

type Search = { table?: string; actor?: string; days?: string; before?: string }

interface Row {
  id: number
  occurred_at: string
  actor_id: string | null
  via: string
  table_name: string
  action: 'insert' | 'update' | 'delete'
  changes: Record<string, unknown>
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined

const ACTION_LABEL = { insert: 'Created', update: 'Changed', delete: 'Deleted' } as const

/**
 * Activity (owner): who changed what in this restaurant — prices, dishes,
 * settings, staff, tables — and when. Same trail as the superadmin's, limited
 * to this restaurant.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')

  const params = await searchParams
  const table = one(params.table)
  const actor = one(params.actor)
  const days = [1, 7, 30, 90].includes(Number(one(params.days))) ? Number(one(params.days)) : 30
  const before = Number(one(params.before)) || undefined

  // Service client with an explicit tenant filter: works for the owner and
  // for a superadmin previewing the restaurant alike.
  const service = createServiceClient()
  let query = service
    .from('audit_events')
    .select('id, occurred_at, actor_id, via, table_name, action, changes')
    .eq('tenant_id', effective.tenantId)
    .in('table_name', table && (OWNER_TABLES as readonly string[]).includes(table) ? [table] : [...OWNER_TABLES])
    .gte('occurred_at', new Date(Date.now() - days * 86_400_000).toISOString())
    .order('id', { ascending: false })
    .limit(PAGE_SIZE)
  if (actor && UUID.test(actor)) query = query.eq('actor_id', actor)
  if (before) query = query.lt('id', before)

  const { data, error } = await query
  const rows = (data ?? []) as Row[]
  const actorIds = [...new Set(rows.map(r => r.actor_id).filter((id): id is string => !!id))]
  const { data: people } = actorIds.length
    ? await service.from('profiles').select('id, full_name, role, tenant_id').in('id', actorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; role: string; tenant_id: string | null }> }
  // People outside the restaurant are the platform team; their names stay private.
  const personName = new Map((people ?? []).map(p => [
    p.id,
    p.tenant_id === effective.tenantId ? (p.full_name || (p.role === 'store-staff' ? 'Staff member' : 'Owner')) : 'XmartMenu support',
  ]))

  const link = (patch: Partial<Search>) => {
    const next = new URLSearchParams()
    const merged: Search = { table, actor, days: String(days), ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, String(v))
    return `/settings/activity?${next.toString()}`
  }
  const who = (row: Row) => {
    if (row.actor_id) return personName.get(row.actor_id) ?? 'Someone'
    if (row.via === 'anon') return 'A guest'
    return 'System'
  }

  return (
    <div className="w-full space-y-8 p-8">
      <div className="border-b border-zinc-100 pb-6">
        <div className="mb-2 flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Administration</span>
        </div>
        <h1 className="text-4xl font-black tracking-tight text-zinc-950">Activity</h1>
        <p className="mt-1 text-sm font-bold text-zinc-500">Who changed what in your restaurant, and when</p>
      </div>

      <form action="/settings/activity" className="flex flex-wrap items-end gap-3 rounded-[1.25rem] border border-zinc-100 bg-white p-4 shadow-sm">
        <label className="text-xs font-bold text-zinc-600">
          What
          <select name="table" defaultValue={table ?? ''} className="mt-1 block h-10 rounded-xl border border-zinc-200 px-3 text-sm">
            <option value="">Everything</option>
            {OWNER_TABLES.map(key => <option key={key} value={key}>{TABLE_LABELS[key] ?? key}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-600">
          Period
          <select name="days" defaultValue={String(days)} className="mt-1 block h-10 rounded-xl border border-zinc-200 px-3 text-sm">
            {[1, 7, 30, 90].map(d => <option key={d} value={d}>{d === 1 ? 'Last 24 hours' : `Last ${d} days`}</option>)}
          </select>
        </label>
        {actor && <input type="hidden" name="actor" value={actor} />}
        <button className="h-10 rounded-xl bg-zinc-950 px-5 text-sm font-bold text-white">Filter</button>
        {(table || actor) && <Link href="/settings/activity" className="h-10 px-2 text-sm font-semibold leading-10 text-zinc-500 hover:underline">Clear</Link>}
      </form>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Could not load the activity.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-[1.25rem] border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-500">No changes in this period.</p>
      ) : (
        <ol className="divide-y divide-zinc-100 rounded-[1.25rem] border border-zinc-100 bg-white shadow-sm" aria-label="Changes">
          {rows.map(row => (
            <li key={row.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:gap-6">
              <div className="w-44 shrink-0 text-xs text-zinc-500">
                <time dateTime={row.occurred_at} className="tabular-nums">{new Date(row.occurred_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time>
                <span className="block font-semibold text-zinc-800">
                  {row.actor_id ? <Link href={link({ actor: row.actor_id, before: undefined })} className="hover:underline">{who(row)}</Link> : who(row)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${row.action === 'delete' ? 'bg-red-50 text-red-700' : row.action === 'insert' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-700'}`}>{ACTION_LABEL[row.action]}</span>
                  <span className="font-bold text-zinc-950">{TABLE_LABELS[row.table_name] ?? row.table_name}</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-700">
                  {summarizeChanges(row.action, row.changes).map(change => (
                    <li key={change.field} className="break-words">
                      <span className="font-semibold">{change.field}</span>
                      {change.from !== undefined
                        ? <>: <span className="text-zinc-400 line-through">{change.from}</span> → {change.to}</>
                        : <> = {change.to}</>}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      )}

      {rows.length === PAGE_SIZE && (
        <Link href={link({ before: String(rows[rows.length - 1].id) })} className="inline-flex text-sm font-semibold text-zinc-700 hover:underline">
          Older changes →
        </Link>
      )}
    </div>
  )
}
