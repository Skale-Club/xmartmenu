import Link from 'next/link'
import { formatDuration, type PlatformTenantRow } from '@/lib/analytics/engagement'
import { planBadgeClass } from '@/lib/plan-badge'
import { formatPrice } from '@/lib/utils'

/** Superadmin › Dashboard: every client's menu visits, screen time and sales. */
export default function PlatformActivity({ rows, days }: { rows: PlatformTenantRow[]; days: number }) {
  const sessions = rows.reduce((sum, r) => sum + r.sessions, 0)
  const orders = rows.reduce((sum, r) => sum + r.orders, 0)
  const quiet = rows.filter(r => r.sessions === 0).length

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8" aria-labelledby="platform-activity-title">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-100 p-4 sm:p-5">
          <div>
            <h2 id="platform-activity-title" className="text-sm font-bold text-zinc-950">Client activity · last {days} days</h2>
            <p className="text-xs text-zinc-500">{sessions} menu visits and {orders} orders across clients{quiet ? ` · ${quiet} with no visits` : ''}.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-zinc-50 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5 text-right">Visits</th>
                <th className="px-4 py-2.5 text-right">Median screen time</th>
                <th className="px-4 py-2.5 text-right">Orders</th>
                <th className="px-4 py-2.5 text-right">Revenue</th>
                <th className="px-4 py-2.5 text-right">Waiter calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => (
                <tr key={r.tenant_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/tenants/${r.tenant_id}`} className="font-semibold text-zinc-900 hover:text-indigo-600">{r.name}</Link>
                    {r.plan && <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${planBadgeClass(r.plan)}`}>{r.plan}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.sessions}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.sessions ? formatDuration(r.median_seconds) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.orders}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.orders ? formatPrice(r.revenue, r.currency) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.waiter_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
