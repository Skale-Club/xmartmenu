import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { summarizeChanges, TABLE_LABELS, VIA_LABELS } from '@/lib/observability/audit-format'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Search = { tenant?: string; table?: string; actor?: string; request?: string; days?: string; before?: string }

interface AuditRow {
  id: number
  occurred_at: string
  tenant_id: string | null
  actor_id: string | null
  via: string
  table_name: string
  record_id: string | null
  action: 'insert' | 'update' | 'delete'
  changes: Record<string, unknown>
  request_id: string | null
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined

/**
 * Audit trail (superadmin): every change to restaurants, settings, plans,
 * menus, dishes, tables… with who, when, from where, what changed and the
 * request id that ties it to the logs and Sentry.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const tenant = one(params.tenant)
  const table = one(params.table)
  const actor = one(params.actor)
  const request = one(params.request)
  const days = [1, 7, 30, 90].includes(Number(one(params.days))) ? Number(one(params.days)) : 7
  const before = Number(one(params.before)) || undefined

  const supabase = await createClient()
  let query = supabase
    .from('audit_events')
    .select('id, occurred_at, tenant_id, actor_id, via, table_name, record_id, action, changes, request_id')
    .gte('occurred_at', new Date(Date.now() - days * 86_400_000).toISOString())
    .order('id', { ascending: false })
    .limit(PAGE_SIZE)
  if (tenant && UUID.test(tenant)) query = query.eq('tenant_id', tenant)
  if (table && table in TABLE_LABELS) query = query.eq('table_name', table)
  if (actor && UUID.test(actor)) query = query.eq('actor_id', actor)
  if (request) query = query.eq('request_id', request.slice(0, 128))
  if (before) query = query.lt('id', before)

  const [{ data, error }, { data: tenants }] = await Promise.all([
    query,
    supabase.from('tenants').select('id, name, slug').order('name'),
  ])
  const rows = (data ?? []) as AuditRow[]
  const actorIds = [...new Set(rows.map(r => r.actor_id).filter((id): id is string => !!id))]
  const { data: people } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name, role').in('id', actorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; role: string }> }

  const tenantName = new Map((tenants ?? []).map(t => [t.id, t.name]))
  const personName = new Map((people ?? []).map(p => [p.id, `${p.full_name || 'Unnamed'} · ${p.role}`]))
  const filterLink = (patch: Partial<Search>) => {
    const next = new URLSearchParams()
    const merged: Search = { tenant, table, actor, request, days: String(days), ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, String(v))
    return `/audit?${next.toString()}`
  }

  return (
    <div className="space-y-6 p-6 lg:p-10">
      <header>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Observability</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">Audit trail</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Every change to restaurants, settings, plans, menus, dishes and tables: who made it, from where, and the request id that matches the logs and Sentry.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-4" action="/audit">
        <label className="text-xs font-semibold text-zinc-600">
          Restaurant
          <select name="tenant" defaultValue={tenant ?? ''} className="mt-1 block h-9 rounded-lg border border-zinc-200 px-2 text-sm">
            <option value="">All</option>
            {(tenants ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-zinc-600">
          What
          <select name="table" defaultValue={table ?? ''} className="mt-1 block h-9 rounded-lg border border-zinc-200 px-2 text-sm">
            <option value="">Everything</option>
            {Object.entries(TABLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-zinc-600">
          Period
          <select name="days" defaultValue={String(days)} className="mt-1 block h-9 rounded-lg border border-zinc-200 px-2 text-sm">
            {[1, 7, 30, 90].map(d => <option key={d} value={d}>{d === 1 ? 'Last 24 hours' : `Last ${d} days`}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-zinc-600">
          Request id
          <input name="request" defaultValue={request ?? ''} placeholder="x-request-id" className="mt-1 block h-9 w-64 rounded-lg border border-zinc-200 px-2 font-mono text-xs" />
        </label>
        {actor && <input type="hidden" name="actor" value={actor} />}
        <button className="h-9 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white">Filter</button>
        {(tenant || table || actor || request) && <Link href="/audit" className="h-9 px-2 text-sm font-semibold leading-9 text-zinc-500 hover:underline">Clear</Link>}
      </form>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Could not load the audit trail: {error.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-500">No changes in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 text-[10px] font-black uppercase tracking-widest text-zinc-400">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Restaurant</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Changes</th>
                <th className="px-4 py-3">Request</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-zinc-50 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-600">
                    {new Date(row.occurred_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                  </td>
                  <td className="px-4 py-3">
                    {row.tenant_id
                      ? <Link href={filterLink({ tenant: row.tenant_id, before: undefined })} className="font-semibold text-zinc-900 hover:underline">{tenantName.get(row.tenant_id) ?? row.tenant_id.slice(0, 8)}</Link>
                      : <span className="text-zinc-400">Platform</span>}
                  </td>
                  <td className="px-4 py-3">
                    {row.actor_id
                      ? <Link href={filterLink({ actor: row.actor_id, before: undefined })} className="font-medium text-zinc-900 hover:underline">{personName.get(row.actor_id) ?? row.actor_id.slice(0, 8)}</Link>
                      : <span className="text-zinc-400">—</span>}
                    <span className="block text-[11px] text-zinc-400">{VIA_LABELS[row.via] ?? row.via}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${row.action === 'delete' ? 'bg-red-50 text-red-700' : row.action === 'insert' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-700'}`}>{row.action}</span>
                    <span className="ml-2 font-semibold text-zinc-900">{TABLE_LABELS[row.table_name] ?? row.table_name}</span>
                    {row.record_id && <span className="block font-mono text-[11px] text-zinc-400">{row.record_id.slice(0, 8)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-0.5 text-xs text-zinc-700">
                      {summarizeChanges(row.action, row.changes).map(change => (
                        <li key={change.field}>
                          <span className="font-semibold">{change.field}</span>
                          {change.from !== undefined
                            ? <>: <span className="text-zinc-400 line-through">{change.from}</span> → {change.to}</>
                            : <> = {change.to}</>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3">
                    {row.request_id
                      ? <Link href={filterLink({ request: row.request_id, before: undefined })} className="font-mono text-[11px] text-zinc-500 hover:underline" title={row.request_id}>{row.request_id.slice(0, 8)}</Link>
                      : <span className="text-zinc-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === PAGE_SIZE && (
        <Link href={filterLink({ before: String(rows[rows.length - 1].id) })} className="inline-flex text-sm font-semibold text-zinc-700 hover:underline">
          Older changes →
        </Link>
      )}
    </div>
  )
}
