'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface TenantOption {
  id: string
  name: string
  slug: string
}

interface UserRow {
  id: string
  email: string | undefined
  full_name: string | null
  role: string | null
  tenant_id: string | null
  tenant: { id: string; name: string; slug: string } | null
  provider: string
  created_at: string
  last_sign_in_at: string | null
}

export default function UsersClient({ users: initial, tenants }: { users: UserRow[]; tenants: TenantOption[] }) {
  const [users, setUsers] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const router = useRouter()

  async function handleAssign(userId: string, tenantId: string, role: string) {
    setLoading(userId)
    setError(null)
    const res = await fetch(`/api/superadmin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId || null, role: role || null }),
    })
    if (res.ok) {
      const tenant = tenants.find(t => t.id === tenantId) ?? null
      setUsers(users.map(u =>
        u.id === userId ? { ...u, tenant_id: tenantId || null, tenant, role: role || null } : u
      ))
      router.refresh()
    } else {
      const data = await res.json()
      setError('Erro: ' + data.error)
    }
    setLoading(null)
  }

  async function confirmDelete() {
    if (!confirmId) return
    const res = await fetch(`/api/superadmin/users/${confirmId}`, { method: 'DELETE' })
    if (res.ok) {
      setUsers(users.filter(u => u.id !== confirmId))
    } else {
      const data = await res.json()
      setError('Erro ao excluir: ' + data.error)
    }
    setConfirmId(null)
  }

  const providerLabel = (p: string) => p === 'google' ? 'Google' : p === 'email' ? 'E-mail' : p

  return (
    <div className="p-8">
      <ConfirmDialog
        open={!!confirmId}
        title="Delete user"
        message={`Delete "${confirmEmail}"? This action cannot be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Usuários</h1>
        <p className="text-sm text-zinc-500 mt-1">{users.length} user(s)</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4 text-xs">✕</button>
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">User</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Login</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tenant</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users.map(user => (
              <UserRow
                key={user.id}
                user={user}
                tenants={tenants}
                loading={loading === user.id}
                onAssign={handleAssign}
                onDeleteRequest={(id, email) => { setConfirmId(id); setConfirmEmail(email ?? '') }}
                providerLabel={providerLabel}
              />
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="text-center py-16 text-zinc-400">
            <p className="font-medium">No users found</p>
          </div>
        )}
      </div>
    </div>
  )
}

function UserRow({
  user,
  tenants,
  loading,
  onAssign,
  onDeleteRequest,
  providerLabel,
}: {
  user: UserRow
  tenants: TenantOption[]
  loading: boolean
  onAssign: (userId: string, tenantId: string, role: string) => void
  onDeleteRequest: (id: string, email: string | undefined) => void
  providerLabel: (p: string) => string
}) {
  const [tenant, setTenant] = useState(user.tenant_id ?? '')
  const [role, setRole] = useState(user.role ?? '')
  const changed = tenant !== (user.tenant_id ?? '') || role !== (user.role ?? '')

  return (
    <tr className="hover:bg-zinc-50">
      <td className="px-5 py-3">
        <p className="font-medium text-zinc-900">{user.email}</p>
        {user.full_name && <p className="text-xs text-zinc-400">{user.full_name}</p>}
        <p className="text-xs text-zinc-400">{new Date(user.created_at).toLocaleDateString('en-US')}</p>
      </td>
      <td className="px-5 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          user.provider === 'google' ? 'bg-blue-100 text-blue-700' : 'bg-zinc-100 text-zinc-600'
        }`}>
          {providerLabel(user.provider)}
        </span>
      </td>
      <td className="px-5 py-3">
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
        >
          <option value="">No role</option>
          <option value="superadmin">Super Admin</option>
          <option value="store-admin">Store Admin</option>
          <option value="store-staff">Store Staff</option>
          <option value="customer">Customer</option>
        </select>
      </td>
      <td className="px-5 py-3">
        <select
          value={tenant}
          onChange={e => setTenant(e.target.value)}
          className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900 max-w-[180px]"
        >
          <option value="">No tenant</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2 justify-end">
          {changed && (
            <button
              onClick={() => onAssign(user.id, tenant, role)}
              disabled={loading}
              className="text-xs px-3 py-1.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          )}
          <button
            onClick={() => onDeleteRequest(user.id, user.email)}
            className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}
