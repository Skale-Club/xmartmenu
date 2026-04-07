'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugify } from '@/lib/utils'

interface TenantRow {
  id: string
  slug: string
  name: string
  plan: string
  is_active: boolean
  created_at: string
  tenant_settings: { logo_url: string | null } | null
  profiles: { id: string; full_name: string | null }[]
}

interface Credentials {
  email: string
  password: string
}

export default function TenantsClient({ tenants: initial }: { tenants: TenantRow[] }) {
  const [tenants, setTenants] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', email: '', plan: 'free' })
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const router = useRouter()

  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, slug: slugify(name) }))
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
      setTenants([data.tenant, ...tenants])
      setShowForm(false)
      setForm({ name: '', slug: '', email: '', plan: 'free' })
      if (data.credentials) setCredentials(data.credentials)
      router.refresh()
    }
    setLoading(false)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir "${name}"? Isso irá remover o tenant, todos os produtos, categorias e usuários. Esta ação é irreversível.`)) return
    const res = await fetch(`/api/superadmin/tenants/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setTenants(tenants.filter(t => t.id !== id))
    } else {
      const data = await res.json()
      alert('Erro ao excluir: ' + data.error)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch(`/api/superadmin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
    setTenants(tenants.map(t => t.id === id ? { ...t, is_active: !current } : t))
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Clientes</h1>
          <p className="text-sm text-zinc-500 mt-1">{tenants.length} cliente(s) cadastrado(s)</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setCredentials(null) }}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + Novo cliente
        </button>
      </div>

      {/* Credenciais geradas */}
      {credentials && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-green-800 mb-3">Cliente criado! Credenciais de acesso:</p>
          <div className="bg-white rounded-lg border border-green-200 p-4 space-y-2 font-mono text-sm mb-3">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 text-xs">E-mail</span>
              <span className="text-zinc-900 font-medium">{credentials.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 text-xs">Senha temporária</span>
              <span className="text-zinc-900 font-medium tracking-wider">{credentials.password}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(`E-mail: ${credentials.email}\nSenha: ${credentials.password}`)}
              className="text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg hover:bg-green-800 transition-colors"
            >
              Copiar credenciais
            </button>
            <button
              onClick={() => setCredentials(null)}
              className="text-xs text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-6 max-w-lg">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">Novo cliente</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do restaurante *</label>
              <input
                required
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="Burguer do Zé"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Slug (URL) *</label>
              <div className="flex items-center">
                <span className="px-3 py-2 bg-zinc-100 border border-r-0 border-zinc-300 rounded-l-lg text-sm text-zinc-500">/</span>
                <input
                  required
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  placeholder="burguer-do-ze"
                  className="flex-1 px-3 py-2 border border-zinc-300 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">E-mail do admin *</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="admin@restaurante.com"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Plano</label>
              <select
                value={form.plan}
                onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Criando...' : 'Criar cliente'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {tenants.map(tenant => (
          <div key={tenant.id} className="bg-white border border-zinc-200 rounded-xl px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center overflow-hidden flex-shrink-0">
              {tenant.tenant_settings?.logo_url ? (
                <img src={tenant.tenant_settings.logo_url} alt={tenant.name} className="w-full h-full object-contain" />
              ) : (
                <span className="text-lg">🏪</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900">{tenant.name}</p>
              <p className="text-xs text-zinc-500">/{tenant.slug}</p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              tenant.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
              tenant.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
              'bg-zinc-100 text-zinc-600'
            }`}>
              {tenant.plan}
            </span>
            <button
              onClick={() => toggleActive(tenant.id, tenant.is_active)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                tenant.is_active
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
              }`}
            >
              {tenant.is_active ? 'Ativo' : 'Inativo'}
            </button>
            <a
              href={`/api/admin/enter-preview?tenant=${tenant.id}`}
              className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
            >
              Acessar painel
            </a>
            <button
              onClick={() => handleDelete(tenant.id, tenant.name)}
              className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
            >
              Excluir
            </a>
            <a
              href={`/${tenant.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2.5 py-1 rounded-full font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
            >
              Ver cardápio
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
