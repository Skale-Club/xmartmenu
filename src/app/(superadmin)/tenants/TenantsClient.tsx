'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  ExternalLink, 
  LayoutDashboard, 
  Settings, 
  Users, 
  Menu as MenuIcon, 
  Trash2, 
  Edit3, 
  ChevronDown, 
  ChevronUp,
  Mail,
  Globe,
  Star,
  CheckCircle2,
  XCircle,
  Shield,
  Plus
} from 'lucide-react'
import { getInitials, slugify } from '@/lib/utils'
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
      setError('Failed to update: ' + data.error)
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
      setError(data.error ?? 'Failed to create restaurant')
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
        setError('Failed to delete: ' + data.error)
      }
    } else if (confirmItem.user_id) {
      const res = await fetch(`/api/superadmin/users/${confirmItem.user_id}`, { method: 'DELETE' })
      if (res.ok) {
        setClients(clients.filter(c => c.user_id !== confirmItem.user_id))
      } else {
        const data = await res.json()
        setError('Failed to delete: ' + data.error)
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
    <div className="p-8 w-full">
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

      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Tenants Management</h1>
          <p className="text-sm text-zinc-500 mt-1 font-medium">{withTenant.length} active restaurant(s) in system</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setCredentials(null) }}
          className="bg-zinc-900 text-white px-5 py-2.5 rounded-2xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Restaurant
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 mb-6 text-sm text-red-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {credentials && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-2 text-green-800 font-bold mb-4">
            <CheckCircle2 className="w-5 h-5" />
            Instance Created Successfully!
          </div>
          <div className="bg-white rounded-xl border border-green-100 p-5 space-y-3 font-mono text-sm mb-4 shadow-inner">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Admin Email</span>
              <span className="text-zinc-900 font-bold">{credentials.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Temporary Password</span>
              <span className="text-zinc-900 font-bold tracking-widest bg-zinc-50 px-2 py-0.5 rounded">{credentials.password}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigator.clipboard.writeText(`Email: ${credentials.email}\nPassword: ${credentials.password}`)}
              className="text-xs bg-green-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-800 transition-all"
            >
              Copy Access Details
            </button>
            <button onClick={() => setCredentials(null)} className="text-xs text-green-700 px-4 py-2 rounded-xl font-bold hover:bg-green-100 transition-all">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white border border-zinc-200 rounded-3xl p-8 mb-8 max-w-2xl shadow-xl shadow-zinc-100"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-zinc-900">Add New Restaurant</h2>
              <button onClick={() => setShowForm(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Restaurant Name *</label>
                  <div className="relative">
                    <input required value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="Joe's Burgers"
                      className={`w-full pl-4 ${inp}`} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Slug (URL) *</label>
                  <div className="flex items-center">
                    <span className="px-4 py-2.5 bg-zinc-50 border border-r-0 border-zinc-200 rounded-l-xl text-sm text-zinc-400 font-medium">/</span>
                    <input required value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="burguer-do-ze"
                      className="flex-1 px-4 py-2.5 border border-zinc-200 rounded-r-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Admin Email *</label>
                  <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@restaurant.com"
                    className={`w-full px-4 ${inp}`} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Subscription Plan</label>
                  <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                    className={`w-full bg-white px-4 ${inp}`}>
                    <option value="free">Free Starter</option>
                    <option value="pro">Pro Business</option>
                    <option value="enterprise">Enterprise Custom</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="md:col-span-2 bg-red-50 border border-red-100 p-3 rounded-xl text-xs text-red-600 flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="md:col-span-2 flex gap-3 pt-2">
                <button type="submit" disabled={loading}
                  className="flex-1 bg-zinc-900 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-zinc-800 disabled:opacity-50 transition-all shadow-lg shadow-zinc-200">
                  {loading ? 'Processing...' : 'Create Instance'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-6 py-3 rounded-xl text-sm font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">
                  Discard
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main list */}
      <div className="space-y-4">
        {withTenant.map(client => {
          const td = tenantData[client.id!]
          const isExpanded = expandedId === client.id
          const tab = expandedTab[client.id!] ?? 'staff'

          return (
            <motion.div 
              key={client.id} 
              initial={false}
              className="bg-white border border-zinc-200 rounded-2xl overflow-hidden hover:border-zinc-300 hover:shadow-sm transition-all duration-200"
            >
              {/* Main Row */}
              <div className="p-5 flex flex-col lg:flex-row lg:items-center gap-6">
                {/* 1. Brand & Info */}
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {client.logo_url
                      ? <Image src={client.logo_url} alt={client.name!} width={48} height={48} className="object-contain" />
                      : <div className="text-xl font-bold text-zinc-300">{getInitials(client.name)}</div>}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-zinc-900 truncate flex items-center gap-2">
                      {client.name}
                      {client.plan === 'pro' && <Star className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                      <p className="text-xs text-zinc-500 flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        <span className="opacity-70">/</span>{client.slug}
                      </p>
                      <p className="text-xs text-zinc-500 flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {client.email}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Status & Plan */}
                <div className="flex items-center gap-3 lg:border-l lg:border-zinc-100 lg:pl-6">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Status & Plan</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => toggleActive(client.id!, client.is_active!)}
                        className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                          client.is_active 
                            ? 'bg-green-50 text-green-700 hover:bg-green-100' 
                            : 'bg-zinc-50 text-zinc-500 hover:bg-zinc-100'
                        }`}
                      >
                        {client.is_active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {client.is_active ? 'Active' : 'Inactive'}
                      </button>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-tight ${
                        client.plan === 'pro' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                        client.plan === 'enterprise' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                        'bg-zinc-50 text-zinc-600 border border-zinc-100'
                      }`}>
                        {client.plan}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Actions Group */}
                <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                  {/* External Links Group */}
                  <div className="flex items-center bg-zinc-50 p-1 rounded-xl border border-zinc-100">
                    <a 
                      href={`/${client.slug}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      title="View Public Menu"
                      className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white rounded-lg transition-all"
                    >
                      <MenuIcon className="w-4 h-4" />
                    </a>
                    <a 
                      href={`/api/admin/enter-preview?tenant=${client.id}`}
                      title="Admin Dashboard"
                      className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white rounded-lg transition-all"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                    </a>
                    <a 
                      href={`/customize/${client.id}`}
                      title="Customize Appearance"
                      className="p-2 text-zinc-600 hover:text-zinc-900 hover:bg-white rounded-lg transition-all"
                    >
                      <Settings className="w-4 h-4" />
                    </a>
                  </div>

                  {/* Manage Group */}
                  <div className="h-8 w-px bg-zinc-200 mx-1 hidden sm:block" />
                  
                  <button
                    onClick={() => editingId === client.id ? cancelEdit() : startEdit(client)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      editingId === client.id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
                    }`}
                  >
                    <Edit3 className="w-4 h-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </button>

                  <button
                    onClick={() => toggleExpand(client.id!)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      isExpanded ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span className="hidden sm:inline">{isExpanded ? 'Hide Details' : 'Details'}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  <button 
                    onClick={() => setConfirmItem(client)}
                    className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    title="Delete Tenant"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
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
              <AnimatePresence>
                {isExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="border-t border-zinc-100"
                  >
                    {td?.loading ? (
                      <div className="py-12 flex flex-col items-center justify-center gap-3">
                        <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
                        <p className="text-xs font-medium text-zinc-400">Loading details...</p>
                      </div>
                    ) : (
                      <div>
                        {/* Tabs */}
                        <div className="flex gap-1 border-b border-zinc-100 bg-zinc-50/50 px-5 pt-2">
                          {(['staff', 'menus'] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => setExpandedTab(prev => ({ ...prev, [client.id!]: t }))}
                              className={`px-4 py-3 text-xs font-bold capitalize transition-all border-b-2 -mb-px flex items-center gap-2 ${
                                tab === t 
                                  ? 'border-indigo-600 text-indigo-600' 
                                  : 'border-transparent text-zinc-400 hover:text-zinc-600'
                              }`}
                            >
                              {t === 'staff' ? <Users className="w-3.5 h-3.5" /> : <MenuIcon className="w-3.5 h-3.5" />}
                              {t === 'staff'
                                ? `Staff Members (${td?.staff.length ?? 0})`
                                : `Active Menus (${td?.menus.length ?? 0})`}
                            </button>
                          ))}
                        </div>

                        {/* Staff tab */}
                        {tab === 'staff' && (
                          <div className="p-6 space-y-6">
                            {/* Error / credentials */}
                            {td?.staffError && (
                              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <XCircle className="w-4 h-4" />
                                  {td.staffError}
                                </div>
                                <button onClick={() => setTenantData(prev => ({ ...prev, [client.id!]: { ...prev[client.id!], staffError: null } }))} className="ml-3 text-red-400 hover:text-red-600">✕</button>
                              </div>
                            )}
                            {td?.staffCredentials && (
                              <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-xs">
                                <div className="flex items-center gap-2 font-bold text-green-800 mb-3">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Credentials Generated
                                </div>
                                <div className="bg-white rounded-lg border border-green-100 p-4 space-y-2 font-mono text-zinc-800">
                                  {td.staffCredentials.owner && <p className="flex justify-between border-b border-zinc-50 pb-1">
                                    <span className="text-zinc-400">Name:</span> 
                                    <span className="font-bold">{td.staffCredentials.owner}</span>
                                  </p>}
                                  <p className="flex justify-between border-b border-zinc-50 pb-1">
                                    <span className="text-zinc-400">Email:</span> 
                                    <span className="font-bold">{td.staffCredentials.email}</span>
                                  </p>
                                  <p className="flex justify-between">
                                    <span className="text-zinc-400">Temp Password:</span> 
                                    <span className="font-bold bg-zinc-50 px-1.5 rounded">{td.staffCredentials.password}</span>
                                  </p>
                                </div>
                                <button
                                  onClick={() => setTenantData(prev => ({ ...prev, [client.id!]: { ...prev[client.id!], staffCredentials: null } }))}
                                  className="mt-4 text-xs font-bold text-green-700 hover:underline"
                                >
                                  Done, close these credentials
                                </button>
                              </div>
                            )}

                            {/* Add staff form */}
                            <div className="flex flex-col sm:flex-row gap-3 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                              <div className="flex-1">
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Invite New Staff</p>
                                <div className="flex gap-2">
                                  <input
                                    placeholder="Full Name"
                                    value={inviteForm[client.id!]?.name ?? ''}
                                    onChange={e => setInviteForm(prev => ({ ...prev, [client.id!]: { ...prev[client.id!] ?? { name: '', email: '' }, name: e.target.value } }))}
                                    className="flex-1 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <input
                                    type="email"
                                    placeholder="Email Address"
                                    value={inviteForm[client.id!]?.email ?? ''}
                                    onChange={e => setInviteForm(prev => ({ ...prev, [client.id!]: { ...prev[client.id!] ?? { name: '', email: '' }, email: e.target.value } }))}
                                    className="flex-1 px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <button
                                    onClick={() => handleStaffInvite(client.id!)}
                                    disabled={inviteLoading === client.id}
                                    className="px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 disabled:opacity-50 transition-all shadow-sm"
                                  >
                                    {inviteLoading === client.id ? 'Sending...' : 'Invite'}
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Staff list */}
                            {!td || td.staff.length === 0 ? (
                              <div className="py-8 text-center bg-zinc-50/50 rounded-2xl border border-dashed border-zinc-200">
                                <Users className="w-8 h-8 text-zinc-200 mx-auto mb-2" />
                                <p className="text-xs font-medium text-zinc-400">No staff members yet</p>
                              </div>
                            ) : (
                              <div className="border border-zinc-100 rounded-2xl overflow-hidden shadow-sm">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-zinc-50/80 border-b border-zinc-100">
                                      <th className="text-left px-5 py-3 font-bold text-zinc-500 uppercase tracking-wider">Member</th>
                                      <th className="text-left px-5 py-3 font-bold text-zinc-500 uppercase tracking-wider">Joined</th>
                                      <th className="px-5 py-3" />
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-50">
                                    {td.staff.map(member => (
                                      <tr key={member.id} className="group hover:bg-zinc-50/50 transition-colors">
                                        <td className="px-5 py-4">
                                          <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                                              {(member.full_name ?? member.email ?? '?')[0].toUpperCase()}
                                            </div>
                                            <div>
                                              <p className="font-bold text-zinc-900">{member.full_name ?? 'N/A'}</p>
                                              <p className="text-zinc-400">{member.email}</p>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-5 py-4 text-zinc-500 font-medium">
                                          {new Date(member.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="px-5 py-4">
                                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                              onClick={() => handleStaffResetPassword(client.id!, member)}
                                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-zinc-200 text-zinc-600 rounded-lg hover:bg-zinc-50 font-bold transition-all"
                                            >
                                              Reset Pwd
                                            </button>
                                            <button
                                              onClick={() => setConfirmStaff({ tenantId: client.id!, staffId: member.id, name: member.full_name ?? member.email ?? '' })}
                                              className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                            >
                                              <Trash2 className="w-4 h-4" />
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
                          <div className="p-6">
                            {!td || td.menus.length === 0 ? (
                              <div className="py-8 text-center bg-zinc-50/50 rounded-2xl border border-dashed border-zinc-200">
                                <MenuIcon className="w-8 h-8 text-zinc-200 mx-auto mb-2" />
                                <p className="text-xs font-medium text-zinc-400">No menus created yet</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {td.menus.map(menu => (
                                  <div key={menu.id} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-2 h-2 rounded-full ${menu.is_active ? 'bg-green-500 shadow-sm shadow-green-200' : 'bg-zinc-300'}`} />
                                      <div>
                                        <p className="font-bold text-zinc-900">{menu.name}</p>
                                        <p className="text-[10px] text-zinc-400 font-mono tracking-tight">/{menu.slug}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-right">
                                      <div>
                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Language</p>
                                        <p className="font-bold text-zinc-700 uppercase">{menu.language ?? 'EN'}</p>
                                      </div>
                                      <div className="w-px h-6 bg-zinc-200" />
                                      <div>
                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Status</p>
                                        <p className={`font-bold ${menu.is_active ? 'text-green-600' : 'text-zinc-500'}`}>
                                          {menu.is_active ? 'Active' : 'Draft'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      {/* Users without clients */}
      {withoutTenant.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-5 h-5 text-amber-500" />
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Pending Assignment</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {withoutTenant.map(u => (
              <div key={u.user_id} className="bg-white border border-amber-100 rounded-2xl p-4 flex items-center gap-4 hover:shadow-md hover:shadow-amber-50/50 transition-all">
                <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                  {(u.full_name ?? u.email ?? '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-900 truncate">{u.email}</p>
                  <p className="text-[10px] font-medium text-zinc-400">{u.full_name || 'Anonymous User'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.provider === 'google' && (
                    <span className="text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-600 font-bold uppercase tracking-tight">Google</span>
                  )}
                  <button onClick={() => setConfirmItem(u)}
                    className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
