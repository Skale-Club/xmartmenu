'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, MessageSquare, Rocket, Search, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  LAUNCH_CHECKLIST_CATEGORIES,
  LAUNCH_CHECKLIST_CATEGORY_LABELS,
  LAUNCH_CHECKLIST_ITEMS,
  LAUNCH_CHECKLIST_REASON_LABELS,
  resolveLaunchChecklistLink,
  summarizeLaunchChecklist,
  type LaunchChecklistEntry,
  type LaunchChecklistItemDef,
  type LaunchChecklistResponse,
  type LaunchChecklistStatus,
  type LaunchChecklistTenant,
} from '@/lib/launch-checklist'

type ProgressFilter = 'all' | 'incomplete' | 'complete'
type SaveFn = (tenantId: string, itemKey: string, status: LaunchChecklistStatus, note?: string) => Promise<boolean>

const ITEMS_BY_CATEGORY = LAUNCH_CHECKLIST_CATEGORIES.map((category) => ({
  category,
  items: LAUNCH_CHECKLIST_ITEMS.filter((i) => i.category === category),
}))

const inputClass = 'min-h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-zinc-400 hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100'

function statusOf(tenant: LaunchChecklistTenant, key: string): LaunchChecklistStatus {
  return tenant.entries[key]?.status ?? 'pending'
}

/**
 * Website launch checklist — everything a restaurant's menu site needs to
 * launch well (Search Console, robots.txt, analytics, Clarity, Google Business
 * Profile…), ticked per restaurant so the team sees what each one is still
 * missing. Catalog: src/lib/launch-checklist.ts.
 */
export default function LaunchChecklistClient({ initial, initialOpenTenantId }: {
  initial: LaunchChecklistResponse
  initialOpenTenantId: string | null
}) {
  const [tenants, setTenants] = useState(initial.tenants)
  const [search, setSearch] = useState('')
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all')
  const [missingItem, setMissingItem] = useState('any')
  const [openTenantId, setOpenTenantId] = useState<string | null>(initialOpenTenantId)
  const [error, setError] = useState<string | null>(null)

  const save: SaveFn = async (tenantId, itemKey, status, note) => {
    setError(null)
    const res = await fetch(`/api/superadmin/tenants/${tenantId}/launch-checklist/${encodeURIComponent(itemKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note === undefined ? { status } : { status, note }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(body.error ?? 'Could not save')
      return false
    }
    const entry = body as LaunchChecklistEntry
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, entries: { ...t.entries, [itemKey]: entry } } : t)))
    return true
  }

  const stats = useMemo(() => {
    const summaries = tenants.map((t) => summarizeLaunchChecklist(t.entries))
    return {
      sites: tenants.length,
      launched: summaries.filter((s) => s.pending === 0).length,
      average: summaries.length ? Math.round(summaries.reduce((acc, s) => acc + s.percent, 0) / summaries.length) : 0,
      pending: summaries.reduce((acc, s) => acc + s.pending, 0),
    }
  }, [tenants])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tenants.filter((t) => {
      if (q && ![t.name, t.slug, t.primaryDomain ?? ''].some((v) => v.toLowerCase().includes(q))) return false
      const summary = summarizeLaunchChecklist(t.entries)
      if (progressFilter === 'complete' && summary.pending > 0) return false
      if (progressFilter === 'incomplete' && summary.pending === 0) return false
      if (missingItem !== 'any' && statusOf(t, missingItem) !== 'pending') return false
      return true
    })
  }, [tenants, search, progressFilter, missingItem])

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Rocket className="size-5" aria-hidden="true" /></span>
          <h1 className="text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Launch checklist</h1>
        </div>
        <p className="pl-12 text-sm font-medium text-zinc-500">
          Everything each restaurant site needs to launch well — Search Console, robots.txt, analytics, Clarity and more.
          “Detected” hints come from the restaurant&apos;s own settings; the ticks are ours.
        </p>
      </header>

      {initial.setupRequired && (
        <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          The checklist table does not exist yet. Apply <code className="font-mono">supabase/migrations/20261009120000_launch_checklist_items.sql</code> to start ticking items.
        </div>
      )}
      {error && (
        <div role="alert" className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <XCircle className="size-5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{error}</span>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Restaurants', value: stats.sites },
          { label: 'Fully checked', value: stats.launched },
          { label: 'Average progress', value: `${stats.average}%` },
          { label: 'Pending items', value: stats.pending },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold text-zinc-500">{c.label}</p>
            <p className="mt-1 text-xl font-black text-zinc-950">{c.value}</p>
          </div>
        ))}
      </div>

      <section aria-label="Filters" className="mb-5 grid gap-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <label className="relative min-w-0"><span className="sr-only">Search restaurants</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, slug or domain…" className={cn(inputClass, 'pl-10 pr-3')} />
        </label>
        <label className="min-w-0"><span className="sr-only">Progress</span>
          <select value={progressFilter} onChange={(e) => setProgressFilter(e.target.value as ProgressFilter)} className={cn(inputClass, 'px-3')}>
            <option value="all">All restaurants</option>
            <option value="incomplete">Still missing items</option>
            <option value="complete">Fully checked</option>
          </select>
        </label>
        <label className="min-w-0"><span className="sr-only">Missing item</span>
          <select value={missingItem} onChange={(e) => setMissingItem(e.target.value)} className={cn(inputClass, 'px-3')}>
            <option value="any">Any item</option>
            {LAUNCH_CHECKLIST_ITEMS.map((item) => <option key={item.key} value={item.key}>Missing: {item.label}</option>)}
          </select>
        </label>
      </section>

      {tenants.length === 0 && <p className="text-sm text-zinc-500">No restaurants yet.</p>}
      {tenants.length > 0 && visible.length === 0 && <p className="text-sm text-zinc-500">No restaurant matches these filters.</p>}

      <div className="space-y-3">
        {visible.map((tenant) => (
          <TenantCard
            key={tenant.id}
            tenant={tenant}
            open={openTenantId === tenant.id}
            onToggle={() => setOpenTenantId((cur) => (cur === tenant.id ? null : tenant.id))}
            save={save}
            disabled={initial.setupRequired}
          />
        ))}
      </div>
    </main>
  )
}

function ProgressBar({ percent, complete }: { percent: number; complete: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div className={cn('h-full rounded-full transition-all', complete ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${percent}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-bold tabular-nums text-zinc-900">{percent}%</span>
    </div>
  )
}

function TenantCard({ tenant, open, onToggle, save, disabled }: {
  tenant: LaunchChecklistTenant
  open: boolean
  onToggle: () => void
  save: SaveFn
  disabled: boolean
}) {
  const summary = summarizeLaunchChecklist(tenant.entries)
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-col gap-3 p-4 text-left transition-colors hover:bg-zinc-50 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1 lg:min-w-[12rem]">
          <div className="flex items-center gap-2">
            <p className="truncate font-bold text-zinc-950">{tenant.name}</p>
            {tenant.status !== 'active' && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-500">{tenant.status}</span>}
          </div>
          <p className="truncate text-xs text-zinc-500">{tenant.primaryDomain ?? tenant.siteUrl.replace(/^https?:\/\//, '')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ITEMS_BY_CATEGORY.map(({ category, items }) => {
            const finished = items.filter((i) => statusOf(tenant, i.key) !== 'pending').length
            return (
              <span
                key={category}
                title={LAUNCH_CHECKLIST_CATEGORY_LABELS[category]}
                className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums', finished === items.length ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-zinc-200 text-zinc-500')}
              >
                {LAUNCH_CHECKLIST_CATEGORY_LABELS[category].split(' ')[0]} {finished}/{items.length}
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-2 lg:w-56">
          <div className="flex-1"><ProgressBar percent={summary.percent} complete={summary.pending === 0} /></div>
          <ChevronDown className={cn('size-4 shrink-0 text-zinc-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </div>
      </button>
      {open && (
        <div className="space-y-5 border-t border-zinc-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">{summary.done} done · {summary.na} N/A · {summary.pending} pending · {summary.total} items</p>
            <Link href={`/tenants/${tenant.id}`} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">Open restaurant</Link>
          </div>
          {ITEMS_BY_CATEGORY.map(({ category, items }) => (
            <div key={category}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">{LAUNCH_CHECKLIST_CATEGORY_LABELS[category]}</h3>
              <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                {items.map((item) => <ItemRow key={item.key} tenant={tenant} item={item} save={save} disabled={disabled} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ItemRow({ tenant, item, save, disabled }: {
  tenant: LaunchChecklistTenant
  item: LaunchChecklistItemDef
  save: SaveFn
  disabled: boolean
}) {
  const entry = tenant.entries[item.key]
  const status = entry?.status ?? 'pending'
  const signal = tenant.signals[item.key]
  const link = resolveLaunchChecklistLink(item.link, tenant.siteUrl, tenant.primaryDomain)
  const [saving, setSaving] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState(entry?.note ?? '')

  async function update(next: LaunchChecklistStatus, note?: string) {
    setSaving(true)
    const ok = await save(tenant.id, item.key, next, note)
    setSaving(false)
    if (ok && note !== undefined) setEditingNote(false)
  }

  const signalText = signal
    ? [signal.value, signal.reason ? LAUNCH_CHECKLIST_REASON_LABELS[signal.reason] : null].filter(Boolean).join(' · ')
    : ''
  const busy = saving || disabled

  return (
    <li className={cn('flex flex-col gap-2 p-3', status === 'na' && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <input
          type="checkbox"
          checked={status === 'done'}
          disabled={busy || status === 'na'}
          onChange={(e) => update(e.target.checked ? 'done' : 'pending')}
          aria-label={item.label}
          className="mt-0.5 size-4 shrink-0 accent-emerald-600"
        />
        <div className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('text-sm font-semibold text-zinc-900', status === 'na' && 'line-through')}>{item.label}</p>
            {signal && (
              status === 'done' && !signal.ok ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"><AlertTriangle className="size-3" aria-hidden="true" />Ticked, but not detected</span>
              ) : signal.ok ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="size-3" aria-hidden="true" />Detected</span>
              ) : status === 'pending' ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Not detected</span>
              ) : null
            )}
            {status === 'na' && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">N/A</span>}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">{item.description}</p>
          {signalText && <p className="mt-0.5 text-[11px] text-zinc-400">{signalText}</p>}
          {entry?.note && !editingNote && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-zinc-50 px-2 py-1 text-xs text-zinc-700">{entry.note}</p>}
          {entry?.updatedAt && status !== 'pending' && (
            <p className="mt-1 text-[11px] text-zinc-400">{entry.updatedBy ?? 'someone'} · {new Date(entry.updatedAt).toLocaleString('en-US')}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 pl-7 sm:pl-0">
          {saving && <Loader2 className="size-3.5 animate-spin text-zinc-400" aria-hidden="true" />}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" title="Open tool" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setNoteDraft(entry?.note ?? ''); setEditingNote((v) => !v) }}
            title={entry?.note ? 'Edit note' : 'Add note'}
            className={cn('rounded-lg p-1.5 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50', entry?.note ? 'text-indigo-600' : 'text-zinc-400')}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => update(status === 'na' ? 'pending' : 'na')}
            className="min-h-8 rounded-lg px-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50"
          >
            {status === 'na' ? 'Applicable' : 'N/A'}
          </button>
        </div>
      </div>
      {editingNote && (
        <div className="space-y-2 pl-7">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Notes, logins, links, who is handling it…"
            rows={2}
            maxLength={2000}
            className={cn(inputClass, 'px-3')}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => update(status, noteDraft)} className="min-h-9 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">Save note</button>
            <button type="button" onClick={() => setEditingNote(false)} className="min-h-9 rounded-xl px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-100">Cancel</button>
          </div>
        </div>
      )}
    </li>
  )
}
