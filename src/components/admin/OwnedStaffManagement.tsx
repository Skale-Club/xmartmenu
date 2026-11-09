'use client'
import { useEffect, useState } from 'react'
import { Check, Copy, Plus, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react'

type Member = { id: string; full_name: string | null; phone: string | null; created_at: string; must_change_password?: boolean }
type AccessLink = { url: string; expires_at: string; recipient_user_id: string }

/** Shared by the store screen and the independently-owned super-admin tenant panels. */
export default function OwnedStaffManagement({ tenantId }: { tenantId?: string }) {
  const base = tenantId ? `/api/superadmin/tenants/${encodeURIComponent(tenantId)}/staff` : '/api/admin/staff'
  const [members, setMembers] = useState<Member[]>([])
  const [recipient, setRecipient] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<AccessLink | null>(null)
  const [copied, setCopied] = useState(false)

  async function load(): Promise<Member[]> {
    const response = await fetch(base, { cache: 'no-store', credentials: 'same-origin' })
    const data = await response.json()
    if (!response.ok || !Array.isArray(data)) throw new Error(data.error ?? 'Staff access is unavailable')
    return data
  }

  useEffect(() => {
    let active = true
    load().then(data => { if (active) setMembers(data) })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Staff access is unavailable') })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load depends only on base
  }, [base])

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', id?: string) {
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setLink(null); setCopied(false)
    try {
      const response = await fetch(id ? `${base}/${encodeURIComponent(id)}` : base, {
        method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ recipient_user_id: recipient.trim() }) } : {}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Staff access could not be updated')
      if (data.invitation || data.recovery) setLink(data.invitation ?? data.recovery)
      setNotice(method === 'POST' ? 'Invitation created. Send them this link.'
        : method === 'PATCH' ? 'Sessions revoked. Send them this recovery link.' : 'Access removed.')
      if (method === 'POST') setRecipient('')
      setMembers(await load())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Staff access is unavailable')
    } finally { setBusy(false) }
  }

  const href = link ? new URL(link.url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin).href : ''

  return <div className="space-y-4">
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><UserPlus className="size-4" /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-zinc-950">Invite staff</h2>
          <p className="text-xs text-zinc-500">Paste the ID from their <a href="/staff-access" className="font-semibold text-zinc-700 underline underline-offset-2">account page</a>.</p>
        </div>
      </div>
      <form onSubmit={event => { event.preventDefault(); void mutate('POST') }} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="staff-recipient" className="sr-only">Account ID</label>
        <input id="staff-recipient" value={recipient} onChange={event => setRecipient(event.target.value)} required autoComplete="off" spellCheck={false}
          placeholder="Account ID"
          className="min-h-11 w-full min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 outline-none transition-[border-color,box-shadow] placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10" />
        <button disabled={busy || !recipient.trim()}
          className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="size-4" />Invite
        </button>
      </form>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm font-medium text-zinc-600">{notice}</p> : null}
      {link ? <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 pl-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-zinc-700">{href}</p>
          <p className="text-[11px] text-zinc-500">Expires {new Date(link.expires_at).toLocaleString()}</p>
        </div>
        <button type="button" onClick={() => void navigator.clipboard.writeText(href).then(() => setCopied(true))}
          className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div> : null}
    </section>

    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {members.length === 0 ? <div className="px-5 py-8 text-center">
        <span className="mx-auto mb-2 flex size-10 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><Users className="size-5" /></span>
        <p className="text-sm font-semibold text-zinc-700">No staff yet</p>
      </div> : <ul className="divide-y divide-zinc-100">
        {members.map(member => <li key={member.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-500">{(member.full_name ?? 'S').charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-950">{member.full_name ?? 'Staff member'}</p>
            <p className="truncate text-xs text-zinc-500">{member.phone ?? member.id}{member.must_change_password ? ' · Recovery pending' : ''}</p>
          </div>
          <button type="button" disabled={busy} title="Reset sign-in" aria-label={`Reset sign-in for ${member.full_name ?? 'staff member'}`}
            onClick={() => { if (window.confirm('Sign this member out everywhere and create a recovery link?')) void mutate('PATCH', member.id) }}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"><RotateCcw className="size-4" /></button>
          <button type="button" disabled={busy} title="Remove access" aria-label={`Remove access for ${member.full_name ?? 'staff member'}`}
            onClick={() => { if (window.confirm('Remove this member’s access to the store?')) void mutate('DELETE', member.id) }}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><Trash2 className="size-4" /></button>
        </li>)}
      </ul>}
    </section>
  </div>
}
