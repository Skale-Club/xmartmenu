'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownAZ, Building2, Calendar, ChevronDown, Filter, LogIn, Mail, RotateCcw, Save, Search, Shield, Trash2, Users, X, XCircle } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { getInitials } from '@/lib/utils'

interface TenantOption { id: string; name: string; slug: string }
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
type SortOrder = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'recent-login'

const roleOptions = [
  { value: '', label: 'No role' },
  { value: 'superadmin', label: 'Super Admin' },
  { value: 'store-admin', label: 'Store Admin' },
  { value: 'store-staff', label: 'Store Staff' },
  { value: 'customer', label: 'Customer' },
]

function roleNeedsTenant(role: string) { return role === 'store-admin' || role === 'store-staff' }
function formatDate(date: string | null) {
  if (!date) return 'Never'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
}

export default function UsersClient({ users: initial, tenants, currentUserId }: {
  users: UserRow[]
  tenants: TenantOption[]
  currentUserId: string | null
}) {
  const [users, setUsers] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [tenantFilter, setTenantFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const router = useRouter()

  const hasSecondaryFilters = roleFilter !== 'all' || tenantFilter !== 'all' || sortOrder !== 'newest'
  const hasActiveFilters = search.trim() !== '' || hasSecondaryFilters
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    const result = users.filter(user => {
      const assignedTenant = tenants.find(tenant => tenant.id === user.tenant_id)
      const searchable = [user.full_name, user.email, user.role, user.provider, assignedTenant?.name, assignedTenant?.slug]
        .filter(Boolean).join(' ').toLowerCase()
      return (!query || searchable.includes(query))
        && (roleFilter === 'all' || user.role === roleFilter || (roleFilter === 'none' && !user.role))
        && (tenantFilter === 'all' || user.tenant_id === tenantFilter || (tenantFilter === 'unassigned' && !user.tenant_id))
    })
    return [...result].sort((a, b) => {
      if (sortOrder === 'name-asc' || sortOrder === 'name-desc') {
        const comparison = (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
        return sortOrder === 'name-asc' ? comparison : -comparison
      }
      if (sortOrder === 'recent-login') return new Date(b.last_sign_in_at || 0).getTime() - new Date(a.last_sign_in_at || 0).getTime()
      const comparison = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return sortOrder === 'newest' ? comparison : -comparison
    })
  }, [users, tenants, search, roleFilter, tenantFilter, sortOrder])

  function clearFilters() {
    setSearch(''); setRoleFilter('all'); setTenantFilter('all'); setSortOrder('newest'); setMobileFiltersOpen(false)
  }

  async function handleAssign(userId: string, tenantId: string, role: string) {
    setLoading(userId); setError(null)
    try {
      const res = await fetch(`/api/superadmin/users/${userId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId || null, role: role || null }),
      })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Unable to update user') }
      const selectedTenant = tenants.find(tenant => tenant.id === tenantId) ?? null
      setUsers(current => current.map(user => user.id === userId
        ? { ...user, tenant_id: tenantId || null, tenant: selectedTenant, role: role || null }
        : user))
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update user')
    } finally { setLoading(null) }
  }

  async function confirmDelete() {
    if (!confirmId) return
    setError(null)
    try {
      const res = await fetch(`/api/superadmin/users/${confirmId}`, { method: 'DELETE' })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Unable to delete user') }
      setUsers(current => current.filter(user => user.id !== confirmId))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete user')
    } finally { setConfirmId(null) }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:p-6 lg:p-8">
      <ConfirmDialog open={!!confirmId} title="Delete user"
        message={`Delete “${confirmEmail}”? This user will lose access to every associated restaurant.`}
        onConfirm={confirmDelete} onCancel={() => setConfirmId(null)} />

      <header className="mb-6">
        <div className="mb-1 flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Users className="size-5" aria-hidden="true" /></span>
          <h1 className="text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Users Management</h1>
        </div>
        <p className="pl-12 text-sm font-medium text-zinc-500">{users.length} registered {users.length === 1 ? 'account' : 'accounts'} on the platform</p>
      </header>

      {error && <div role="alert" className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
        <XCircle className="size-5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{error}</span>
        <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-red-500 transition-colors hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>}

      <section aria-labelledby="user-filters-title" className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><Filter className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><h2 id="user-filters-title" className="text-sm font-bold text-zinc-900">Find users</h2><p className="text-xs text-zinc-500">{filteredUsers.length} of {users.length} {users.length === 1 ? 'result' : 'results'}</p></div>
          {hasActiveFilters && <button type="button" onClick={clearFilters}
            className="hidden min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-[560px]:flex">
            <RotateCcw className="size-3.5" aria-hidden="true" />Reset
          </button>}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 min-[560px]:grid-cols-[minmax(150px,1.5fr)_minmax(105px,.8fr)_minmax(120px,1fr)_minmax(110px,.8fr)]">
          <label className="relative min-w-0"><span className="sr-only">Search users</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input type="search" placeholder="Name, email, restaurant…" value={search} onChange={event => setSearch(event.target.value)}
              className="min-h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-3 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-zinc-400 hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
          </label>
          <button type="button" onClick={() => setMobileFiltersOpen(open => !open)} aria-expanded={mobileFiltersOpen}
            className={`relative flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-[560px]:hidden ${mobileFiltersOpen || hasSecondaryFilters ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'}`}>
            <Filter className="size-4" aria-hidden="true" />Filters{hasSecondaryFilters && <span className="size-1.5 rounded-full bg-indigo-600" aria-label="Filters active" />}
          </button>
          <div className={`${mobileFiltersOpen ? 'contents' : 'hidden'} min-[560px]:contents`}>
            <FilterSelect label="Filter by role" value={roleFilter} onChange={setRoleFilter}>
              <option value="all">All roles</option><option value="superadmin">Super Admins</option><option value="store-admin">Store Admins</option><option value="store-staff">Store Staff</option><option value="customer">Customers</option><option value="none">No role</option>
            </FilterSelect>
            <FilterSelect label="Filter by restaurant" value={tenantFilter} onChange={setTenantFilter}>
              <option value="all">All restaurants</option><option value="unassigned">Unassigned</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </FilterSelect>
            <label className="relative col-span-2 min-[560px]:col-span-1"><span className="sr-only">Sort users</span>
              <ArrowDownAZ className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <select value={sortOrder} onChange={event => setSortOrder(event.target.value as SortOrder)}
                className="min-h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-8 text-sm font-medium text-zinc-700 outline-none transition-[border-color,box-shadow,background-color] hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100">
                <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name-asc">Name: A–Z</option><option value="name-desc">Name: Z–A</option><option value="recent-login">Recent sign-in</option>
              </select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            </label>
          </div>
        </div>
        {hasActiveFilters && <button type="button" onClick={clearFilters} className="mt-2 min-h-10 text-xs font-bold text-indigo-600 hover:text-indigo-800 min-[560px]:hidden">Reset all filters</button>}
      </section>

      <section aria-label="User accounts" className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <AnimatePresence initial={false} mode="popLayout">
          {filteredUsers.map(user => <UserCard key={user.id} user={user} tenants={tenants} loading={loading === user.id}
            isCurrentUser={user.id === currentUserId} onAssign={handleAssign}
            onDeleteRequest={(id, email) => { setConfirmId(id); setConfirmEmail(email ?? '') }} />)}
        </AnimatePresence>
        {filteredUsers.length === 0 && <div className="px-5 py-14 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><Users className="size-6" aria-hidden="true" /></span>
          <p className="text-sm font-bold text-zinc-900">No users found</p><p className="mt-1 text-xs text-zinc-500">Try another search or reset the filters.</p>
          {hasActiveFilters && <button type="button" onClick={clearFilters} className="mt-4 min-h-10 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white hover:bg-zinc-800">Reset filters</button>}
        </div>}
      </section>
    </main>
  )
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="relative col-span-2 min-[420px]:col-span-1"><span className="sr-only">{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)}
      className="min-h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 pr-8 text-sm font-medium text-zinc-700 outline-none transition-[border-color,box-shadow,background-color] hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100">{children}</select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
  </label>
}

function UserCard({ user, tenants, loading, isCurrentUser, onAssign, onDeleteRequest }: {
  user: UserRow; tenants: TenantOption[]; loading: boolean; isCurrentUser: boolean
  onAssign: (userId: string, tenantId: string, role: string) => void
  onDeleteRequest: (id: string, email: string | undefined) => void
}) {
  const [tenant, setTenant] = useState(user.tenant_id ?? '')
  const [role, setRole] = useState(user.role ?? '')
  const needsTenant = roleNeedsTenant(role)
  const missingRequiredTenant = needsTenant && !tenant
  const changed = tenant !== (user.tenant_id ?? '') || role !== (user.role ?? '')

  return <motion.article layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}
    className="border-b border-zinc-100 p-4 last:border-b-0 sm:p-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-xs font-black text-indigo-600">{getInitials(user.full_name || user.email)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-bold text-zinc-950 sm:text-base">{user.full_name || 'Unnamed user'}</h2>
            {isCurrentUser && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">You</span>}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${user.provider === 'google' ? 'bg-blue-50 text-blue-700' : 'bg-zinc-100 text-zinc-600'}`}>{user.provider}</span>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"><Mail className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{user.email || 'No email address'}</span></p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-zinc-400">
            <span className="flex items-center gap-1.5"><Calendar className="size-3.5" aria-hidden="true" />Joined {formatDate(user.created_at)}</span>
            <span className="flex items-center gap-1.5"><LogIn className="size-3.5" aria-hidden="true" />Signed in {formatDate(user.last_sign_in_at)}</span>
          </div>
        </div>
      </div>
      <div className="grid min-w-0 gap-2 border-t border-zinc-100 pt-4 sm:grid-cols-[minmax(120px,.8fr)_minmax(160px,1.2fr)_auto] lg:w-[570px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <ControlSelect label="Role" icon={<Shield className="size-4" aria-hidden="true" />} value={role} disabled={isCurrentUser}
          onChange={nextRole => { setRole(nextRole); if (!roleNeedsTenant(nextRole)) setTenant('') }}>
          {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </ControlSelect>
        <ControlSelect label="Restaurant" icon={<Building2 className="size-4" aria-hidden="true" />} value={tenant}
          disabled={isCurrentUser || !needsTenant} invalid={missingRequiredTenant} onChange={setTenant}>
          <option value="">{needsTenant ? 'Select restaurant' : 'Not required'}</option>{tenants.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </ControlSelect>
        <div className="flex items-end gap-2 sm:justify-end">
          <motion.button type="button" whileTap={!loading && changed && !missingRequiredTenant && !isCurrentUser ? { scale: 0.97 } : undefined}
            onClick={() => onAssign(user.id, tenant, role)} disabled={loading || !changed || missingRequiredTenant || isCurrentUser}
            className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 sm:flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            {loading ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Save className="size-4" aria-hidden="true" />}{loading ? 'Saving' : 'Save'}
          </motion.button>
          <button type="button" onClick={() => onDeleteRequest(user.id, user.email)} disabled={isCurrentUser}
            aria-label={isCurrentUser ? 'You cannot delete your own account' : `Delete ${user.full_name || user.email || 'user'}`}
            title={isCurrentUser ? 'You cannot delete your own account' : 'Delete user'}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500 transition-[border-color,color,background-color] hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:border-zinc-100 disabled:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
    {missingRequiredTenant && <p className="mt-2 text-right text-xs font-medium text-red-600">Choose a restaurant before saving this role.</p>}
  </motion.article>
}

function ControlSelect({ label, icon, value, disabled, invalid = false, onChange, children }: {
  label: string; icon: React.ReactNode; value: string; disabled: boolean; invalid?: boolean
  onChange: (value: string) => void; children: React.ReactNode
}) {
  return <label className="min-w-0"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
    <span className="relative block"><span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${invalid ? 'text-red-500' : 'text-zinc-400'}`}>{icon}</span>
      <select value={value} disabled={disabled} aria-invalid={invalid} onChange={event => onChange(event.target.value)}
        className={`min-h-10 w-full appearance-none truncate rounded-xl border bg-zinc-50 py-2 pl-9 pr-8 text-xs font-bold text-zinc-700 outline-none transition-[border-color,box-shadow,background-color] hover:bg-white focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 ${invalid ? 'border-red-300 focus:border-red-500' : 'border-zinc-200 focus:border-indigo-500'}`}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
    </span>
  </label>
}
