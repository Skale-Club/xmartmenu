'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugify } from '@/lib/utils'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface ClientRow {
  id: string | null          // tenant id (null = sem tenant)
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

interface Credentials { email: string; password: string }

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

  const withTenant = clients.filter(c => c.id !== null)
  const withoutTenant = clients.filter(c => c.id === null)

  return (
    <div className="p-8">
      <ConfirmDialog
        open={!!confirmItem}
        title="Delete client"
        message={`Delete "${confirmItem?.name ?? confirmItem?.email}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmItem(null)}
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
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900" />
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
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900" />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Plan</label>
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900">
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
        {withTenant.map(client => (
          <div key={client.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-4">
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
          </div>
        ))}
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
