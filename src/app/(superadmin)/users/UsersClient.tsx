'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Users, 
  Search, 
  Mail, 
  Shield, 
  Building2, 
  Trash2, 
  Save, 
  MoreVertical, 
  Filter,
  CheckCircle2,
  XCircle,
  Calendar,
  ChevronDown
} from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { getInitials } from '@/lib/utils'

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

function roleNeedsTenant(role: string) {
  return role === 'store-admin' || role === 'store-staff'
}

export default function UsersClient({ users: initial, tenants }: { users: UserRow[]; tenants: TenantOption[] }) {
  const [users, setUsers] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  
  const router = useRouter()

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch = 
        (u.email?.toLowerCase() || '').includes(search.toLowerCase()) ||
        (u.full_name?.toLowerCase() || '').includes(search.toLowerCase())
      
      const matchesRole = roleFilter === 'all' || u.role === roleFilter
      
      return matchesSearch && matchesRole
    })
  }, [users, search, roleFilter])

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
      setError('Error updating user: ' + data.error)
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
      setError('Error deleting user: ' + data.error)
    }
    setConfirmId(null)
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <ConfirmDialog
        open={!!confirmId}
        title="Delete User"
        message={`Delete "${confirmEmail}"? This user will lose access to all associated tenants.`}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />

      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <div className="flex items-center gap-3 mb-1">
          <Users className="w-5 h-5 text-indigo-600" />
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Users Management</h1>
        </div>
        <p className="text-sm text-zinc-500 font-medium">{users.length} registered accounts in the platform</p>
      </motion.div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 mb-8 text-sm text-red-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 mb-8 flex flex-col md:flex-row items-center gap-4 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input 
            type="text" 
            placeholder="Search by name or email..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className="w-4 h-4 text-zinc-400" />
          <select 
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="bg-zinc-50 border border-zinc-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all min-w-[140px] appearance-none cursor-pointer"
          >
            <option value="all">All Roles</option>
            <option value="superadmin">Super Admins</option>
            <option value="store-admin">Store Admins</option>
            <option value="store-staff">Store Staff</option>
            <option value="customer">Customers</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="text-left px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Account Information</th>
                <th className="text-left px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Access & Provider</th>
                <th className="text-left px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Permissions</th>
                <th className="text-left px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Assignment</th>
                <th className="px-8 py-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              <AnimatePresence mode="popLayout">
                {filteredUsers.map((user, idx) => (
                  <motion.tr 
                    key={user.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: idx * 0.02 }}
                    className="group hover:bg-zinc-50/50 transition-colors"
                  >
                    <UserRowComponent
                      user={user}
                      tenants={tenants}
                      loading={loading === user.id}
                      onAssign={handleAssign}
                      onDeleteRequest={(id, email) => { setConfirmId(id); setConfirmEmail(email ?? '') }}
                    />
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="text-center py-24 bg-zinc-50/30">
            <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-zinc-300" />
            </div>
            <p className="text-sm font-bold text-zinc-900">No users found</p>
            <p className="text-xs text-zinc-400 mt-1">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  )
}

function UserRowComponent({
  user,
  tenants,
  loading,
  onAssign,
  onDeleteRequest,
}: {
  user: UserRow
  tenants: TenantOption[]
  loading: boolean
  onAssign: (userId: string, tenantId: string, role: string) => void
  onDeleteRequest: (id: string, email: string | undefined) => void
}) {
  const [tenant, setTenant] = useState(user.tenant_id ?? '')
  const [role, setRole] = useState(user.role ?? '')
  const missingRequiredTenant = roleNeedsTenant(role) && !tenant
  const changed = tenant !== (user.tenant_id ?? '') || role !== (user.role ?? '')

  return (
    <>
      <td className="px-8 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs ring-2 ring-white">
            {getInitials(user.full_name || user.email)}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-zinc-900 truncate">{user.full_name || 'Anonymous User'}</p>
            <p className="text-[11px] text-zinc-400 flex items-center gap-1">
              <Mail className="w-3 h-3" />
              {user.email}
            </p>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tight ${
              user.provider === 'google' ? 'bg-blue-50 text-blue-600' : 'bg-zinc-100 text-zinc-500'
            }`}>
              {user.provider}
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 flex items-center gap-1 font-medium">
            <Calendar className="w-3 h-3" />
            Since {new Date(user.created_at).toLocaleDateString()}
          </p>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="relative group/select">
          <Shield className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 group-hover/select:text-indigo-500 transition-colors pointer-events-none" />
          <select
            value={role}
            onChange={e => {
              const nextRole = e.target.value
              setRole(nextRole)
              if (!roleNeedsTenant(nextRole)) setTenant('')
            }}
            className="w-full pl-8 pr-8 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-xs font-bold text-zinc-700 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer hover:bg-white transition-all min-w-[130px]"
          >
            <option value="">No role</option>
            <option value="superadmin">Super Admin</option>
            <option value="store-admin">Store Admin</option>
            <option value="store-staff">Store Staff</option>
            <option value="customer">Customer</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="relative group/select">
          <Building2 className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 group-hover/select:text-indigo-500 transition-colors pointer-events-none ${missingRequiredTenant ? 'text-red-500' : 'text-zinc-400'}`} />
          <select
            value={tenant}
            onChange={e => setTenant(e.target.value)}
            className={`w-full pl-8 pr-8 py-2 bg-zinc-50 border rounded-xl text-xs font-bold text-zinc-700 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer hover:bg-white transition-all max-w-[180px] ${
              missingRequiredTenant ? 'border-red-200' : 'border-zinc-100'
            }`}
          >
            <option value="">No tenant</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
        </div>
      </td>
      <td className="px-8 py-4">
        <div className="flex items-center gap-2 justify-end">
          {changed && (
            <button
              onClick={() => onAssign(user.id, tenant, role)}
              disabled={loading || missingRequiredTenant}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100 active:scale-95"
            >
              {loading ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {loading ? '...' : 'Save'}
            </button>
          )}
          <button
            onClick={() => onDeleteRequest(user.id, user.email)}
            className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
            title="Delete User"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </>
  )
}
