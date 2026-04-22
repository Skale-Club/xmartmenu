'use client'

import { useState } from 'react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Tenant {
  id: string
  name: string
  slug: string
  plan: string | null
  is_active: boolean | null
  created_at: string
  logo_url: string | null
}

interface StaffMember {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  created_at: string
}

interface Menu {
  id: string
  name: string
  slug: string
  language: string | null
  is_active: boolean | null
  position: number | null
  created_at: string
}

interface Credentials { email: string; password: string }

export default function TenantDetailClient({
  tenant,
  initialStaff,
  initialMenus,
}: {
  tenant: Tenant
  initialStaff: StaffMember[]
  initialMenus: Menu[]
}) {
  const [tab, setTab] = useState<'staff' | 'menus'>('staff')
  const [staff, setStaff] = useState(initialStaff)
  const [menus] = useState(initialMenus)

  // Staff form
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [credentialsOwner, setCredentialsOwner] = useState<{ full_name: string; email: string } | null>(null)

  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const base = `/api/superadmin/tenants/${tenant.id}/staff`

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true)
    setError(null)
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inviteName, email: inviteEmail }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
    } else {
      setCredentials(data.credentials)
      setCredentialsOwner({ full_name: data.staff?.full_name ?? inviteName, email: data.staff?.email ?? inviteEmail })
      setStaff(prev => [{
        id: data.staff?.id ?? crypto.randomUUID(),
        email: data.staff?.email ?? inviteEmail,
        full_name: data.staff?.full_name ?? inviteName,
        phone: null,
        created_at: new Date().toISOString(),
      }, ...prev])
      setInviteName('')
      setInviteEmail('')
    }
    setInviteLoading(false)
  }

  async function handleRemove() {
    if (!confirmId) return
    const res = await fetch(`${base}/${confirmId}`, { method: 'DELETE' })
    if (res.ok) {
      setStaff(prev => prev.filter(s => s.id !== confirmId))
    } else {
      const data = await res.json()
      setError(data.error)
    }
    setConfirmId(null)
  }

  async function handleResetPassword(member: StaffMember) {
    setError(null)
    const res = await fetch(`${base}/${member.id}`, { method: 'PATCH' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to generate new password')
      return
    }
    setCredentials(data.credentials)
    setCredentialsOwner({ full_name: member.full_name ?? '', email: member.email ?? '' })
  }

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'
  const planBadge = tenant.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
    tenant.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' : 'bg-zinc-100 text-zinc-600'

  return (
    <div className="p-8 max-w-4xl">
      <ConfirmDialog
        open={!!confirmId}
        title="Remove staff member"
        message={`Remove "${confirmName}"? They will lose access to the dashboard.`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setConfirmId(null)}
      />

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <a href="/tenants" className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors">← Clients</a>
        <div className="w-px h-4 bg-zinc-200" />
        <div className="flex items-center gap-3">
          {tenant.logo_url
            ? <img src={tenant.logo_url} alt={tenant.name} className="w-10 h-10 rounded-lg object-contain border border-zinc-100" />
            : <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center text-lg">🏪</div>}
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{tenant.name}</h1>
            <p className="text-xs text-zinc-400">/{tenant.slug}</p>
          </div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ml-1 ${planBadge}`}>{tenant.plan}</span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tenant.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
          {tenant.is_active ? 'Active' : 'Inactive'}
        </span>
        <div className="ml-auto flex gap-2">
          <a
            href={`/api/admin/enter-preview?tenant=${tenant.id}`}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium"
          >
            Dashboard
          </a>
          <a
            href={`/${tenant.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            View menu
          </a>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 flex items-center justify-between">
          {error}<button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {credentials && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-800 mb-3">Credentials generated:</p>
              <div className="space-y-1 font-mono text-sm text-green-900">
                {credentialsOwner?.full_name && <p><span className="text-green-600">Name:</span> {credentialsOwner.full_name}</p>}
                <p><span className="text-green-600">Email:</span> {credentials.email}</p>
                <p><span className="text-green-600">Password:</span> {credentials.password}</p>
              </div>
            </div>
            <button onClick={() => { setCredentials(null); setCredentialsOwner(null) }} className="text-green-500 hover:text-green-700 text-xl">✕</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-200">
        {(['staff', 'menus'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}
          >
            {t === 'staff' ? `Staff (${staff.length})` : `Menus (${menus.length})`}
          </button>
        ))}
      </div>

      {/* Staff tab */}
      {tab === 'staff' && (
        <div>
          <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-4">
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Add staff member</h2>
            <form onSubmit={handleInvite} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
                  <input required value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jane Doe" className={input} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
                  <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="jane@restaurant.com" className={input} />
                </div>
              </div>
              <button
                type="submit"
                disabled={inviteLoading}
                className="bg-zinc-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {inviteLoading ? 'Adding...' : '+ Add staff'}
              </button>
            </form>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {staff.length === 0 ? (
              <div className="py-12 text-center text-zinc-400 text-sm">No staff members yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Member</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Added</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {staff.map(member => (
                    <tr key={member.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-900">{member.full_name ?? '—'}</p>
                        <p className="text-xs text-zinc-400">{member.email}</p>
                        {member.phone && <p className="text-xs text-zinc-400">{member.phone}</p>}
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-400">
                        {new Date(member.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => void handleResetPassword(member)}
                            className="text-xs px-3 py-1.5 border border-zinc-200 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors"
                          >
                            New password
                          </button>
                          <button
                            onClick={() => { setConfirmId(member.id); setConfirmName(member.full_name ?? member.email ?? '') }}
                            className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Menus tab */}
      {tab === 'menus' && (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          {menus.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">No menus yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Menu</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Language</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {menus.map(menu => (
                  <tr key={menu.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-zinc-900">{menu.name}</p>
                      <p className="text-xs text-zinc-400">/{menu.slug}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-zinc-500">{menu.language ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${menu.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
                        {menu.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-zinc-400">
                      {new Date(menu.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
