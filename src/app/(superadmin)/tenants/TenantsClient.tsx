'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugify } from '@/lib/utils'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface ClientRow {
  id: string | null
  name: string | null
  slug: string | null
  plan: string | null
  is_active: boolean | null
  created_at: string
  logo_url: string | null
  user_id: string | null
  email: string | null
  full_name: string | null
  provider: string
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
  created_at: string
}

interface TenantData {
  staff: StaffMember[]
  menus: Menu[]
  loading: boolean
  staffCredentials: { email: string; password: string; owner: string } | null
  staffError: string | null
}

interface Credentials { email: string; password: string }

const DEFAULT_TENANT_DATA: TenantData = {
  staff: [], menus: [], loading: false, staffCredentials: null, staffError: null,
}

export default function TenantsClient({ clients: initial }: { clients: ClientRow[] }) {
  const [clients, setClients] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', email: '', plan: 'free' })
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [confirmItem, setConfirmItem] = useState<ClientRow | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', plan: 'free' })

  // Expandable panels state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tenantData, setTenantData] = useState<Record<string, TenantData>>({})
  const [expandedTab, setExpandedTab] = useState<Record<string, 'staff' | 'menus'>>({})

  // Staff invite state (per tenant)
  const [inviteForm, setInviteForm] = useState<Record<string, { name: string; email: string }>>({})
  const [inviteLoading, setInviteLoading] = useState<string | null>(null)

  // Staff delete confirm
  const [confirmStaff, setConfirmStaff] = useState<{ tenantId: string; staffId: string; name: string } | null>(null)

  const router = useRouter()

  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, slug: slugify(name) }))
  }

  function startEdit(client: ClientRow) {
    setEditingId(client.id)
    setEditForm({ name: client.name ?? '', plan: client.plan ?? 'free' })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({ name: '', plan: 'free' })
  }

  async function handleSaveEdit(id: string) {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/superadmin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      const data = await res.json()
      setClients(clients.map(c => c.id === id ? { ...c, name: data.name, plan: data.plan } : c))
      setEditingId(null)
      router.refresh()
    } else {
      const data = await res.json()
      setError('Erro ao editar: ' + data.error)
    }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setCredentials(null)

    const res = await fetch('/api/superadmin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Erro ao criar cliente')
    } else {
      setClients([{
        id: data.tenant.id,
        name: data.tenant.name,
        slug: data.tenant.slug,
        plan: data.tenant.plan,
        is_active: data.tenant.is_active,
        created_at: data.tenant.created_at,
        logo_url: null,
        user_id: null,
        email: form.email,
        full_name: null,
        provider: 'email',
      }, ...clients])
      setShowForm(false)
      setForm({ name: '', slug: '', email: '', plan: 'free' })
      if (data.credentials) setCredentials(data.credentials)
      router.refresh()
    }
    setLoading(false)
  }

  async function handleDelete() {
    if (!confirmItem) return
    if (confirmItem.id) {
      const res = await fetch(`/api/superadmin/tenants/${confirmItem.id}`, { method: 'DELETE' })
      if (res.ok) {
        setClients(clients.filter(c => c.id !== confirmItem.id))
      } else {
        const data = await res.json()
        setError('Erro ao excluir: ' + data.error)
      }
    } else if (confirmItem.user_id) {
      const res = await fetch(`/api/superadmin/users/${confirmItem.user_id}`, { method: 'DELETE' })
      if (res.ok) {
        setClients(clients.filter(c => c.user_id !== confirmItem.user_id))
      } else {
        const data = await res.json()
        setError('Erro ao excluir: ' + data.error)
      }
    }
    setConfirmItem(null)
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch(`/api/superadmin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
    setClients(clients.map(c => c.id === id ? { ...c, is_active: !current } : c))
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (tenantData[id]) return // already loaded

    setTenantData(prev => ({ ...prev, [id]: { ...DEFAULT_TENANT_DATA, loading: true } }))

    const [staffRes, menusRes] = await Promise.all([
      fetch(`/api/superadmin/tenants/${id}/staff`),
      fetch(`/api/superadmin/tenants/${id}/menus`),
    ])

    const [staff, menus] = await Promise.all([
      staffRes.ok ? staffRes.json() : [],
      menusRes.ok ? menusRes.json() : [],
    ])

    setTenantData(prev => ({
      ...prev,
      [id]: { staff, menus, loading: false, staffCredentials: null, staffError: null },
    }))
  }

  async function handleStaffInvite(tenantId: string) {
    const form = inviteForm[tenantId] ?? { name: '', email: '' }
    if (!form.name.trim() || !form.email.trim()) return
    setInviteLoading(tenantId)

    const res = await fetch(`/api/superadmin/tenants/${tenantId}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, email: form.email }),
    })
    const data = await res.json()

    if (!res.ok) {
      setTenantData(prev => ({ ...prev, [tenantId]: { ...prev[tenantId], staffError: data.error } }))
    } else {
      const newMember: StaffMember = {
        id: data.staff?.id ?? crypto.randomUUID(),
        email: data.staff?.email ?? form.email,
        full_name: data.staff?.full_name ?? form.name,
        phone: null,
        created_at: new Date().toISOString(),
      }
      setTenantData(prev => ({
        ...prev,
        [tenantId]: {
          ...prev[tenantId],
          staff: [newMember, ...prev[tenantId].staff],
          staffCredentials: data.credentials ? { ...data.credentials, owner: newMember.full_name ?? newMember.email ?? '' } : null,
          staffError: null,
        },
      }))
      setInviteForm(prev => ({ ...prev, [tenantId]: { name: '', email: '' } }))
    }
    setInviteLoading(null)
  }

  async function handleStaffResetPassword(tenantId: string, member: StaffMember) {
    setTenantData(prev => ({ ...prev, [tenantId]: { ...prev[tenantId], staffError: null } }))
    const res = await fetch(`/api/superadmin/tenants/${tenantId}/staff/${member.id}`, { method: 'PATCH' })
    const data = await res.json()
    if (!res.ok) {
      setTenantData(prev => ({ ...prev, [tenantId]: { ...prev[tenantId], staffError: data.error ?? 'Failed to reset password' } }))
      return
    }
    setTenantData(prev => ({
      ...prev,
      [tenantId]: {
        ...prev[tenantId],
        staffCredentials: data.credentials ? { ...data.credentials, owner: member.full_name ?? member.email ?? '' } : null,
      },
    }))
  }

  async function handleStaffDelete() {
    if (!confirmStaff) return
    const { tenantId, staffId } = confirmStaff
    const res = await fetch(`/api/superadmin/tenants/${tenantId}/staff/${staffId}`, { method: 'DELETE' })
    if (res.ok) {
      setTenantData(prev => ({
        ...prev,
        [tenantId]: { ...prev[tenantId], staff: prev[tenantId].staff.filter(s => s.id !== staffId) },
      }))
    }
    setConfirmStaff(null)
  }

  const withTenant = clients.filter(c => c.id !== null)
  const withoutTenant = clients.filter(c => c.id === null)
  const inp = 'px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'

  return (
    <div className="p-8">
      <ConfirmDialog
        open={!!confirmItem}
        title="Delete client"
        message={`Delete "${confirmItem?.name ?? confirmItem?.email}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmItem(null)}
      />
      <ConfirmDialog
        open={!!confirmStaff}
        title="Remove staff member"
        message={`Remove "${confirmStaff?.name}"? They will lose access to the dashboard.`}
        confirmLabel="Remove"
        onConfirm={handleStaffDelete}
        onCancel={() => setConfirmStaff(null)}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Clientes</h1>
          <p className="text-sm text-zinc-500 mt-1">{withTenant.length} client(s)</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setCredentials(null) }}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + New client
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {credentials && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-4">
          <p className="text-sm font-semibold text-green-800 mb-3">Client created! Access credentials:</p>
          <div className="bg-white rounded-lg border border-green-200 p-4 space-y-2 font-mono text-sm mb-3">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 text-xs">Email</span>
              <span className="text-zinc-900 font-medium">{credentials.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 text-xs">Temporary password</span>
              <span className="text-zinc-900 font-medium tracking-wider">{credentials.password}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(`Email: ${credentials.email}\nPassword: ${credentials.password}`)}
              className="text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg hover:bg-green-800 transition-colors"
            >
              Copy credentials
            </button>
            <button onClick={() => setCredentials(null)} className="text-xs text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-4 max-w-lg">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">New client</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Restaurant name *</label>
              <input required value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="Joe's Burgers"
                className={`w-full ${inp}`} />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Slug (URL) *</label>
              <div className="flex items-center">
                <span className="px-3 py-2 bg-zinc-100 border border-r-0 border-zinc-300 rounded-l-lg text-sm text-zinc-500">/</span>
                <input required value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="burguer-do-ze"
                  className="flex-1 px-3 py-2 border border-zinc-300 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Email *</label>
              <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@restaurant.com"
                className={`w-full ${inp}`} />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Plan</label>
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className={`w-full bg-white ${inp}`}>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors">
                {loading ? 'Creating...' : 'Create client'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista principal */}
      <div className="space-y-2">
        {withTenant.map(client => {
          const td = tenantData[client.id!]
          const isExpanded = expandedId === client.id
          const tab = expandedTab[client.id!] ?? 'staff'

          return (
            <div key={client.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
              {/* Header row */}
              <div className="px-5 py-4 flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {client.logo_url
                    ? <img src={client.logo_url} alt={client.name!} className="w-full h-full object-contain" />
                    : <span className="text-lg">🏪</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">{client.name}</p>
                  <p className="text-xs text-zinc-400">
                    {client.email ?? '—'}
                    {client.provider === 'google' && <span className="ml-1.5 text-blue-500">• Google</span>}
                    {client.slug && <span className="ml-1.5 text-zinc-300">• /{client.slug}</span>}
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${
                  client.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
                  client.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                  'bg-zinc-100 text-zinc-600'
                }`}>{client.plan}</span>
                <button onClick={() => toggleActive(client.id!, client.is_active!)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors flex-shrink-0 ${
                    client.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                  }`}>
                  {client.is_active ? 'Active' : 'Inactive'}
                </button>
                <button
                  onClick={() => editingId === client.id ? cancelEdit() : startEdit(client)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors flex-shrink-0"
                >
                  {editingId === client.id ? 'Cancel' : 'Edit'}
                </button>
                <button
                  onClick={() => toggleExpand(client.id!)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors flex-shrink-0 ${
                    isExpanded ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                  }`}
                >
                  {isExpanded ? '▲ Fechar' : '▼ Ver tudo'}
                </button>
                <a href={`/api/admin/enter-preview?tenant=${client.id}`}
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-900 text-white hover:bg-zinc-700 transition-colors flex-shrink-0">
                  Dashboard
                </a>
                <a href={`/customize/${client.id}`}
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors flex-shrink-0">
                  Customize
                </a>
                <a href={`/${client.slug}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors flex-shrink-0">
                  Menu
                </a>
                <button onClick={() => setConfirmItem(client)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors flex-shrink-0">
                  Delete
                </button>
              </div>

              {/* Inline edit form */}
              {editingId === client.id && (
                <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Edit client</p>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Name</label>
                      <input
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      />
                    </div>
                    <div className="w-40">
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Plan</label>
                      <select
                        value={editForm.plan}
                        onChange={e => setEditForm(f => ({ ...f, plan: e.target.value }))}
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      >
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                    </div>
                    <button
                      onClick={() => handleSaveEdit(client.id!)}
                      disabled={loading}
                      className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                    >
                      {loading ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* Expandable panel */}
              {isExpanded && (
                <div className="border-t border-zinc-100">
                  {td?.loading ? (
                    <div className="py-8 text-center text-sm text-zinc-400">Loading...</div>
                  ) : (
                    <div>
                      {/* Tabs */}
                      <div className="flex gap-0 border-b border-zinc-100 bg-zinc-50 px-5">
                        {(['staff', 'menus'] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => setExpandedTab(prev => ({ ...prev, [client.id!]: t }))}
                            className={`px-4 py-2.5 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px ${
                              tab === t ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-700'
                            }`}
                          >
                            {t === 'staff'
                              ? `Staff (${td?.staff.length ?? 0})`
                              : `Cardápios (${td?.menus.length ?? 0})`}
                          </button>
                        ))}
                      </div>

                      {/* Staff tab */}
                      {tab === 'staff' && (
                        <div className="p-5 space-y-4">
                          {/* Error / credentials */}
                          {td?.staffError && (
                            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
                              {td.staffError}
                              <button onClick={() => setTenantData(prev => ({ ...prev, [client.id!]: { ...prev[client.id!], staffError: null } }))} className="ml-3 text-red-400">✕</button>
                            </div>
                          )}
                          {td?.staffCredentials && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-xs">
                              <p className="font-semibold text-green-800 mb-2">Credenciais geradas:</p>
                              <div className="space-y-1 font-mono text-green-900">
                                {td.staffCredentials.owner && <p><span className="text-green-600">Nome:</span> {td.staffCredentials.owner}</p>}
                                <p><span className="text-green-600">Email:</span> {td.staffCredentials.email}</p>
                                <p><span className="text-green-600">Senha:</span> {td.staffCredentials.password}</p>
                              </div>
                              <button
                                onClick={() => setTenantData(prev => ({ ...prev, [client.id!]: { ...prev[client.id!], staffCredentials: null } }))}
                                className="mt-2 text-green-600 hover:text-green-800"
                              >
                                Fechar ✕
                              </button>
                            </div>
                          )}

                          {/* Add staff form */}
                          <div className="flex gap-2">
                            <input
                              placeholder="Nome"
                              value={inviteForm[client.id!]?.name ?? ''}
                              onChange={e => setInviteForm(prev => ({ ...prev, [client.id!]: { ...prev[client.id!] ?? { name: '', email: '' }, name: e.target.value } }))}
                              className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
                            />
                            <input
                              type="email"
                              placeholder="Email"
                              value={inviteForm[client.id!]?.email ?? ''}
                              onChange={e => setInviteForm(prev => ({ ...prev, [client.id!]: { ...prev[client.id!] ?? { name: '', email: '' }, email: e.target.value } }))}
                              className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
                            />
                            <button
                              onClick={() => handleStaffInvite(client.id!)}
                              disabled={inviteLoading === client.id}
                              className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-xs font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {inviteLoading === client.id ? 'Adicionando...' : '+ Add staff'}
                            </button>
                          </div>

                          {/* Staff list */}
                          {!td || td.staff.length === 0 ? (
                            <p className="text-xs text-zinc-400 text-center py-4">Nenhum staff ainda</p>
                          ) : (
                            <div className="border border-zinc-100 rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-zinc-50 border-b border-zinc-100">
                                    <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 uppercase tracking-wider">Membro</th>
                                    <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 uppercase tracking-wider">Adicionado</th>
                                    <th className="px-4 py-2.5" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-50">
                                  {td.staff.map(member => (
                                    <tr key={member.id} className="hover:bg-zinc-50">
                                      <td className="px-4 py-2.5">
                                        <p className="font-medium text-zinc-900">{member.full_name ?? '—'}</p>
                                        <p className="text-zinc-400">{member.email}</p>
                                      </td>
                                      <td className="px-4 py-2.5 text-zinc-400">
                                        {new Date(member.created_at).toLocaleDateString('pt-BR')}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-1.5">
                                          <button
                                            onClick={() => handleStaffResetPassword(client.id!, member)}
                                            className="px-2.5 py-1 border border-zinc-200 text-zinc-700 rounded-md hover:bg-zinc-50 transition-colors"
                                          >
                                            Nova senha
                                          </button>
                                          <button
                                            onClick={() => setConfirmStaff({ tenantId: client.id!, staffId: member.id, name: member.full_name ?? member.email ?? '' })}
                                            className="px-2.5 py-1 border border-red-200 text-red-600 rounded-md hover:bg-red-50 transition-colors"
                                          >
                                            Remover
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Menus tab */}
                      {tab === 'menus' && (
                        <div className="p-5">
                          {!td || td.menus.length === 0 ? (
                            <p className="text-xs text-zinc-400 text-center py-4">Nenhum cardápio ainda</p>
                          ) : (
                            <div className="border border-zinc-100 rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-zinc-50 border-b border-zinc-100">
                                    <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 uppercase tracking-wider">Cardápio</th>
                                    <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 uppercase tracking-wider">Idioma</th>
                                    <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                                    <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 uppercase tracking-wider">Criado</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-50">
                                  {td.menus.map(menu => (
                                    <tr key={menu.id} className="hover:bg-zinc-50">
                                      <td className="px-4 py-2.5">
                                        <p className="font-medium text-zinc-900">{menu.name}</p>
                                        <p className="text-zinc-400">/{menu.slug}</p>
                                      </td>
                                      <td className="px-4 py-2.5 text-zinc-500">{menu.language ?? '—'}</td>
                                      <td className="px-4 py-2.5">
                                        <span className={`px-2 py-0.5 rounded-full font-medium ${menu.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
                                          {menu.is_active ? 'Ativo' : 'Inativo'}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-zinc-400">
                                        {new Date(menu.created_at).toLocaleDateString('pt-BR')}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Usuários sem cliente */}
      {withoutTenant.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Pending assignment</p>
          <div className="space-y-2">
            {withoutTenant.map(u => (
              <div key={u.user_id} className="bg-white border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">👤</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900">{u.email}</p>
                  {u.full_name && <p className="text-xs text-zinc-400">{u.full_name}</p>}
                </div>
                {u.provider === 'google' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium flex-shrink-0">Google</span>
                )}
                <span className="text-xs text-amber-600 font-medium flex-shrink-0">No client</span>
                <button onClick={() => setConfirmItem(u)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors flex-shrink-0">
                  Excluir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
