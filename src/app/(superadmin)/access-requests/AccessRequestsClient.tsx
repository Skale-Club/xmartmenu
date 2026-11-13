'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, MessageCircle, Phone, RotateCcw, XCircle } from 'lucide-react'
import ModalPortal from '@/components/ui/ModalPortal'
import { STRINGS } from '@/components/access-request/strings'
import type { AccessRequestDto } from '@/lib/access-requests/store'
import type { AccessRequestStatus } from '@/lib/access-requests/contract'
import { slugify } from '@/lib/utils'

type Restaurant = { id: string; name: string; slug: string | null }
type Plan = { id: string; name: string; slug: string }
type Filter = 'all' | AccessRequestStatus

const EN = STRINGS.en
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'pending', label: 'Pending' }, { id: 'draft', label: 'Incomplete' },
  { id: 'approved', label: 'Approved' }, { id: 'declined', label: 'Declined' },
]
const STATUS_LABEL: Record<AccessRequestStatus, string> = { pending: 'Pending', draft: 'Incomplete', approved: 'Approved', declined: 'Declined' }
const STATUS_STYLE: Record<AccessRequestStatus, string> = {
  pending: 'border-amber-200 bg-amber-100 text-amber-800',
  draft: 'border-zinc-200 bg-zinc-100 text-zinc-600',
  approved: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  declined: 'border-zinc-200 bg-white text-zinc-400',
}
const inputClass = 'mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-normal normal-case'
const labelClass = 'block text-xs font-bold uppercase tracking-wider text-zinc-500'

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')
const activity = (row: AccessRequestDto) => row.submitted_at ?? row.last_activity_at ?? row.started_at
function when(value: string | null) {
  if (!value) return '-'
  const date = new Date(value), minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`
  if (minutes < 10080) return `${Math.round(minutes / 1440)} d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function businessTypeLabel(row: AccessRequestDto) {
  const a = row.answers
  if (a.businessType === 'other' && a.businessTypeOther) return a.businessTypeOther
  return a.businessType ? EN.businessTypes[a.businessType] : null
}
function StatusPill({ status }: { status: AccessRequestStatus }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

function Dialog({ title, onClose, busy, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <ModalPortal onClose={onClose} closeOnEscape={!busy}>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={() => { if (!busy) onClose() }} />
        <div role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50"><XCircle className="h-6 w-6" /></button>
          </div>
          {children}
        </div>
      </div>
    </ModalPortal>
  )
}

function Answer({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="rounded-xl bg-zinc-50 px-3 py-2"><dt className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</dt><dd className="mt-0.5 break-words text-sm text-zinc-800">{value || '-'}</dd></div>
}

function ApproveDialog({ row, restaurants, plans, onClose, onDone }: {
  row: AccessRequestDto; restaurants: Restaurant[]; plans: Plan[]; onClose: () => void
  onDone: (row: AccessRequestDto, created: boolean) => void
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState(row.answers.businessName ?? '')
  const [slug, setSlug] = useState(slugify(row.answers.businessName ?? ''))
  const [planId, setPlanId] = useState(plans.find(plan => plan.slug === 'menu')?.id ?? plans[0]?.id ?? '')
  const [tenantId, setTenantId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const body = mode === 'new' ? { mode, name: name.trim(), slug: slug.trim(), plan_id: planId } : { mode, tenant_id: tenantId }
      const response = await fetch(`/api/superadmin/access-requests/${row.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({})) as { error?: string; request?: AccessRequestDto; createdTenant?: boolean }
      if (!response.ok || !data.request) { setError(data.error ?? 'Could not approve this request.'); return }
      onDone(data.request, data.createdTenant === true)
    } catch { setError('Could not approve this request.') } finally { inFlight.current = false; setBusy(false) }
  }
  const ready = mode === 'new' ? name.trim().length > 0 && slug.trim().length > 0 && !!planId : !!tenantId

  return (
    <Dialog title="Approve request" onClose={onClose} busy={busy}>
      <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label="Approval mode">
        {(['new', 'existing'] as const).map(id => (
          <button key={id} type="button" aria-pressed={mode === id} disabled={busy} onClick={() => { setMode(id); setError(null) }}
            className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${mode === id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
            {id === 'new' ? 'New restaurant' : 'Existing restaurant'}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {mode === 'new' ? (<>
          <label className={labelClass}>Restaurant name
            <input value={name} onChange={event => setName(event.target.value)} maxLength={200} className={inputClass} />
          </label>
          <label className={labelClass}>URL slug
            <input value={slug} onChange={event => setSlug(slugify(event.target.value))} maxLength={100} className={inputClass} />
          </label>
          <label className={labelClass}>Subscription plan
            <select value={planId} onChange={event => setPlanId(event.target.value)} className={inputClass}>
              {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          {plans.length === 0 && <p className="text-xs text-red-600">Create an active plan first.</p>}
        </>) : (<>
          <label className={labelClass}>Restaurant
            <select value={tenantId} onChange={event => setTenantId(event.target.value)} className={inputClass}>
              <option value="">Choose restaurant...</option>
              {restaurants.map(restaurant => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}{restaurant.slug ? ` (${restaurant.slug})` : ''}</option>)}
            </select>
          </label>
          <p className="text-xs text-zinc-500">The restaurant must not have an administrator yet.</p>
        </>)}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={submit} disabled={busy || !ready} className="min-h-11 flex-1 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Approving...' : 'Approve'}</button>
        <button type="button" onClick={onClose} disabled={busy} className="min-h-11 px-6 py-3 text-sm font-bold text-zinc-500 disabled:opacity-50">Cancel</button>
      </div>
    </Dialog>
  )
}

function DeclineDialog({ row, onClose, onDone }: { row: AccessRequestDto; onClose: () => void; onDone: (row: AccessRequestDto) => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  async function submit() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/superadmin/access-requests/${row.id}/decline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      })
      const data = await response.json().catch(() => ({})) as { error?: string; request?: AccessRequestDto }
      if (!response.ok || !data.request) { setError(data.error ?? 'Could not decline this request.'); return }
      onDone(data.request)
    } catch { setError('Could not decline this request.') } finally { inFlight.current = false; setBusy(false) }
  }
  return (
    <Dialog title="Decline request" onClose={onClose} busy={busy}>
      <label className={labelClass}>Internal note (optional)
        <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={4} className={inputClass} />
      </label>
      <p className="mt-2 text-xs text-zinc-500">The note is only visible to the team.</p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={submit} disabled={busy} className="min-h-11 flex-1 rounded-xl bg-red-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Declining...' : 'Decline'}</button>
        <button type="button" onClick={onClose} disabled={busy} className="min-h-11 px-6 py-3 text-sm font-bold text-zinc-500 disabled:opacity-50">Cancel</button>
      </div>
    </Dialog>
  )
}

export default function AccessRequestsClient({ initialRequests, unavailable, restaurants, plans }: {
  initialRequests: AccessRequestDto[]; unavailable: boolean; restaurants: Restaurant[]; plans: Plan[]
}) {
  const [requests, setRequests] = useState(initialRequests)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [action, setAction] = useState<'approve' | 'decline' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reopenBusy, setReopenBusy] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const reopening = useRef(false)

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: requests.length, pending: 0, draft: 0, approved: 0, declined: 0 }
    for (const row of requests) result[row.status] += 1
    return result
  }, [requests])
  const visible = filter === 'all' ? requests : requests.filter(row => row.status === filter)
  const open = requests.find(row => row.id === openId) ?? null

  const replace = (row: AccessRequestDto) => setRequests(current => current.map(item => item.id === row.id ? row : item))
  const show = (id: string) => { setOpenId(id); setReopenError(null) }

  async function reopen(row: AccessRequestDto) {
    if (reopening.current) return
    reopening.current = true; setReopenBusy(true); setReopenError(null)
    try {
      const response = await fetch(`/api/superadmin/access-requests/${row.id}/reopen`, { method: 'POST' })
      const data = await response.json().catch(() => ({})) as { error?: string; request?: AccessRequestDto }
      if (!response.ok || !data.request) { setReopenError(data.error ?? 'Could not reopen this request.'); return }
      replace(data.request)
    } catch { setReopenError('Could not reopen this request.') } finally { reopening.current = false; setReopenBusy(false) }
  }

  const a = open?.answers
  const contactPhone = open ? open.answers.contactPhone || open.phone : null
  const contactDigits = digits(contactPhone)

  return (
    <div className="w-full p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Access requests</h1>
        <p className="mt-1 text-sm text-zinc-500">Businesses that signed up and are waiting for the team. Approving links the account to a restaurant.</p>
      </div>

      {notice && (
        <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
          <span className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-bold">Dismiss</button>
        </div>
      )}
      {unavailable && <p role="alert" className="mb-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">Access requests are not available yet on this database.</p>}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map(item => (
          <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}
            className={`min-h-10 rounded-full border px-4 text-sm font-bold ${filter === item.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}>
            {item.label} <span className="opacity-60">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-zinc-100 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Business</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Activity</th></tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-400">No requests here.</td></tr>}
            {visible.map(row => (
              <tr key={row.id} onClick={() => show(row.id)}
                className={`cursor-pointer border-b border-zinc-50 last:border-0 hover:bg-zinc-50 ${row.status === 'declined' ? 'opacity-50' : ''} ${row.status === 'pending' ? 'bg-amber-50/40' : ''}`}>
                <td className="px-4 py-3 font-semibold text-zinc-900">
                  <button type="button" onClick={event => { event.stopPropagation(); show(row.id) }} className="text-left hover:underline">{row.full_name ?? 'Unnamed'}</button>
                </td>
                <td className="px-4 py-3 text-zinc-700">{row.answers.businessName || '-'}</td>
                <td className="px-4 py-3 text-zinc-600">{businessTypeLabel(row) || '-'}</td>
                <td className="px-4 py-3 text-zinc-600">{row.answers.location || '-'}</td>
                <td className="px-4 py-3">
                  <StatusPill status={row.status} />
                  {row.status === 'approved' && row.tenant_id && <Link href={`/tenants/${row.tenant_id}`} onClick={event => event.stopPropagation()} className="ml-2 text-xs font-bold text-emerald-700 underline">{row.tenant_name ?? 'Restaurant'}</Link>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{when(activity(row))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && !action && a && (
        <Dialog title={a.businessName || open.full_name || 'Access request'} onClose={() => setOpenId(null)}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusPill status={open.status} />
            <span className="text-xs text-zinc-400">{open.status === 'draft' ? `Stopped at: ${open.step}` : `Submitted ${when(open.submitted_at)}`}</span>
            {open.status === 'approved' && open.tenant_id && <Link href={`/tenants/${open.tenant_id}`} className="text-xs font-bold text-emerald-700 underline">Open {open.tenant_name ?? 'restaurant'}</Link>}
          </div>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Answer label="Name" value={open.full_name} />
            <Answer label="Account phone" value={open.phone} />
            <Answer label="Contact phone" value={a.contactPhone} />
            <Answer label="Contact e-mail" value={a.contactEmail} />
            <Answer label="WhatsApp consent" value={open.whatsapp_opt_in_at ? 'Yes' : 'No'} />
            <Answer label="Language" value={a.language ? EN.languages[a.language] : null} />
            <Answer label="Business name" value={a.businessName} />
            <Answer label="Business type" value={businessTypeLabel(open)} />
            <Answer label="Location" value={a.location} />
            <Answer label="Locations" value={a.locations ? EN.locations[a.locations] : null} />
            <Answer label="Current menu" value={a.currentMenu ? EN.currentMenus[a.currentMenu] : null} />
            <Answer label="Interests" value={a.interests?.map(item => EN.interests[item]).join(', ')} />
            <Answer label="Menu size" value={a.menuSize ? EN.menuSizes[a.menuSize] : null} />
            <Answer label="Instagram or website" value={a.socialUrl} />
            <Answer label="Best time to contact" value={a.contactTime ? EN.contactTimes[a.contactTime] : null} />
            {open.decision_note && <Answer label="Internal note" value={open.decision_note} />}
          </dl>
          {contactPhone && (
            <div className="mt-4 flex flex-wrap gap-2">
              {contactDigits && <a href={`https://wa.me/${contactDigits}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
              <a href={`tel:${contactPhone.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700"><Phone className="h-4 w-4" />Call</a>
            </div>
          )}
          {reopenError && <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{reopenError}</p>}
          <div className="mt-6 flex flex-wrap gap-3 border-t border-zinc-100 pt-4">
            {open.status === 'pending' && <button type="button" onClick={() => setAction('approve')} className="min-h-11 rounded-xl bg-zinc-900 px-6 text-sm font-bold text-white">Approve</button>}
            {(open.status === 'pending' || open.status === 'draft') && <button type="button" onClick={() => setAction('decline')} className="min-h-11 rounded-xl border border-red-200 px-6 text-sm font-bold text-red-600">Decline</button>}
            {open.status === 'declined' && <button type="button" onClick={() => reopen(open)} disabled={reopenBusy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-6 text-sm font-bold text-zinc-700 disabled:opacity-50"><RotateCcw className="h-4 w-4" />{reopenBusy ? 'Reopening...' : 'Reopen'}</button>}
          </div>
        </Dialog>
      )}

      {open && action === 'approve' && (
        <ApproveDialog row={open} restaurants={restaurants} plans={plans} onClose={() => setAction(null)}
          onDone={(row, created) => {
            replace(row); setAction(null); setOpenId(null)
            setNotice(`${row.answers.businessName || row.full_name || 'The applicant'} was approved${created ? ' and a new restaurant was created' : ''}. They must sign in again to reach the restaurant panel.`)
          }} />
      )}
      {open && action === 'decline' && (
        <DeclineDialog row={open} onClose={() => setAction(null)} onDone={row => { replace(row); setAction(null) }} />
      )}
    </div>
  )
}
