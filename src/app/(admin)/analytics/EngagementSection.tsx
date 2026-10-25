import { Clock3 } from 'lucide-react'
import {
  DEVICE_LABELS,
  formatDuration,
  peakHour,
  share,
  SOURCE_LABELS,
  WEEKDAY_LABELS,
  type CountRow,
  type MenuEngagement,
} from '@/lib/analytics/engagement'
import { formatPercent } from '@/lib/analytics/dashboard'
import { menuLanguage } from '@/components/menu/menu-i18n'

/** Screen time, when guests open the menu, and how they get there. */
export default function EngagementSection({ data, timeZone }: { data: MenuEngagement; timeZone: string }) {
  const peak = peakHour(data)
  const maxHour = Math.max(1, ...data.by_hour.map(r => r.sessions))
  const maxDay = Math.max(1, ...data.by_weekday.map(r => r.sessions))
  const maxDuration = Math.max(1, ...data.duration.map(r => r.sessions))

  return (
    <section className="rounded-2xl border border-zinc-100 bg-white p-5 sm:p-7" aria-labelledby="engagement-title">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Screen time</p>
          <h2 id="engagement-title" className="mt-1 text-xl font-black text-zinc-950">How long guests stay, and when they come</h2>
        </div>
        <p className="text-[11px] font-medium text-zinc-500">Times in {timeZone}. Screen time runs from opening the menu to the last activity.</p>
      </div>

      {data.sessions === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center">
          <Clock3 className="mx-auto mb-2 size-6 text-zinc-300" />
          <p className="text-sm font-black text-zinc-900">No menu visits in this period</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Median screen time" value={formatDuration(data.median_seconds)} />
              <Stat label="Average" value={formatDuration(data.avg_seconds)} />
              <Stat label="Busiest hour" value={peak ? `${String(peak.hour).padStart(2, '0')}:00` : '—'} />
            </div>
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">Time on the menu</p>
              <ul className="space-y-1.5">
                {data.duration.map(row => (
                  <li key={row.key} className="flex items-center gap-3 text-xs">
                    <span className="w-14 shrink-0 font-bold text-zinc-600">{row.key}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100"><span className="block h-full rounded-full bg-primary" style={{ width: `${(row.sessions / maxDuration) * 100}%` }} /></span>
                    <span className="w-16 shrink-0 text-right font-black tabular-nums text-zinc-900">{formatPercent(share(row, data.sessions))}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Breakdown title="Device" rows={data.devices} total={data.sessions} label={key => DEVICE_LABELS[key] ?? key} />
              <Breakdown title="Came from" rows={data.sources} total={data.sessions} label={key => SOURCE_LABELS[key] ?? key} />
              <Breakdown title="Language" rows={data.languages} total={data.sessions} label={key => (key === 'unknown' ? 'Unknown' : menuLanguage(key).nativeName)} />
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">Visits by hour</p>
              <div className="flex h-28 items-end gap-0.5" role="img" aria-label={`Menu visits by hour${peak ? `, busiest at ${peak.hour}:00` : ''}`}>
                {data.by_hour.map(row => (
                  <div key={row.key} className="flex-1 rounded-t bg-primary/80" style={{ height: `${Math.max(2, (row.sessions / maxHour) * 100)}%`, opacity: row.sessions ? 1 : 0.25 }} title={`${row.key}:00 — ${row.sessions}`} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] font-bold tabular-nums text-zinc-400"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">Visits by day</p>
              <ul className="grid grid-cols-7 gap-1.5">
                {data.by_weekday.map(row => (
                  <li key={row.key} className="text-center">
                    <div className="flex h-16 items-end rounded-lg bg-zinc-50"><div className="w-full rounded-lg bg-zinc-900" style={{ height: `${Math.max(4, (row.sessions / maxDay) * 100)}%` }} /></div>
                    <p className="mt-1 text-[10px] font-bold text-zinc-500">{WEEKDAY_LABELS[Number(row.key)]}</p>
                    <p className="text-[10px] font-black tabular-nums text-zinc-900">{row.sessions}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-zinc-950">{value}</p>
    </div>
  )
}

function Breakdown({ title, rows, total, label }: { title: string; rows: CountRow[]; total: number; label: (key: string) => string }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400">{title}</p>
      <ul className="space-y-1 text-xs">
        {rows.slice(0, 4).map(row => (
          <li key={row.key} className="flex justify-between gap-2">
            <span className="truncate font-semibold text-zinc-700">{label(row.key)}</span>
            <span className="font-black tabular-nums text-zinc-900">{formatPercent(share(row, total))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
