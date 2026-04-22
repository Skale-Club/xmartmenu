'use client'

import { useState, useEffect } from 'react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface StaffMember {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  created_at: string
}

interface Credentials {
  email: string
  password: string
}

interface StaffPayload {
  id: string | null
  email: string
  full_name: string
}

export default function StaffClient() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [credentialsOwner, setCredentialsOwner] = useState<StaffPayload | null>(null)

  // Delete confirm
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')

  useEffect(() => {
    fetch('/api/admin/staff')
      .then(r => r.json())
      .then(data => { setStaff(data); setLoading(false) })
      .catch(() => { setError('Failed to load staff'); setLoading(false) })
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true)
    setError(null)

    const res = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inviteName, email: inviteEmail }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error)
    } else {
      setCredentials(data.credentials)
      setCredentialsOwner(data.staff ?? null)
      setStaff(prev => [...prev, {
        id: data.staff?.id ?? crypto.randomUUID(),
        email: data.staff?.email ?? inviteEmail,
        full_name: data.staff?.full_name ?? inviteName,
        phone: null,
        created_at: new Date().toISOString(),
      }])
      setInviteName('')
      setInviteEmail('')
    }
    setInviteLoading(false)
  }

  async function handleRemove() {
    if (!confirmId) return
    const res = await fetch(`/api/admin/staff/${confirmId}`, { method: 'DELETE' })
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
    const res = await fetch(`/api/admin/staff/${member.id}`, { method: 'PATCH' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to generate new password')
      return
    }
    setCredentials(data.credentials)
    setCredentialsOwner(data.staff ?? { id: member.id, email: member.email, full_name: member.full_name ?? '' })
  }

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'

  return (
    <div className="p-8 max-w-2xl">
      <ConfirmDialog
        open={!!confirmId}
        title="Remove staff member"
        message={`Remove "${confirmName}" from your team? They will lose access to the dashboard.`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setConfirmId(null)}
      />

      <h1 className="text-2xl font-bold text-zinc-900 mb-1">Staff</h1>
      <p className="text-sm text-zinc-500 mb-6">Manage your store team members</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-center justify-between">
          {error}<button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Credentials modal */}
      {credentials && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-800 mb-3">Staff member created! Share these credentials:</p>
              <div className="space-y-1 font-mono text-sm text-green-900">
                {credentialsOwner?.full_name && (
                  <p><span className="text-green-600">Name:</span> {credentialsOwner.full_name}</p>
                )}
                <p><span className="text-green-600">Email:</span> {credentials.email}</p>
                <p><span className="text-green-600">Password:</span> {credentials.password}</p>
              </div>
              <p className="text-xs text-green-600 mt-3">This staff member will be required to change password on first access.</p>
            </div>
            <button onClick={() => { setCredentials(null); setCredentialsOwner(null) }} className="text-green-500 hover:text-green-700 text-xl leading-none">✕</button>
          </div>
        </div>
      )}

      {/* Invite form */}
      <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">Add staff member</h2>
        <form onSubmit={handleInvite} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
              <input
                required
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="Jane Doe"
                className={input}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="jane@restaurant.com"
                className={input}
              />
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

      {/* Staff list */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-zinc-400 text-sm">Loading...</div>
        ) : staff.length === 0 ? (
          <div className="py-12 text-center text-zinc-400">
            <p className="text-3xl mb-3">👥</p>
            <p className="font-medium">No staff members yet</p>
            <p className="text-sm mt-1">Add your first team member above</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Member</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Added</th>
                <th className="px-5 py-3"></th>
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
                    {new Date(member.created_at).toLocaleDateString('en-US')}
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
  )
}
