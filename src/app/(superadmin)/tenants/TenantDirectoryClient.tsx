'use client'

import { FormEvent, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit3,
  Eye,
  ExternalLink,
  Globe,
  LayoutDashboard,
  Mail,
  Plus,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Star,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { getInitials, slugify } from '@/lib/utils'

interface ClientRow {
  id: string | null
  name: string | null
  slug: string | null
  plan: string | null
  plan_id: string | null
  plan_name: string | null
  plan_slug: string | null
  subscription_status: string | null
  is_active: boolean | null
  created_at: string
  logo_url: string | null
  user_id: string | null
  email: string | null
  full_name: string | null
  provider: string
}

interface PlanOption {
  id: string
  name: string
  slug: string
  is_active: boolean
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
  loadError: string | null
  staffError: string | null
  credentials: { email: string; password: string; owner: string } | null
}

const emptyTenantData: TenantData = {
  staff: [],
  menus: [],
  loading: false,
  loadError: null,
  staffError: null,
  credentials: null,
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}

async function getResponseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return typeof data?.error === 'string' ? data.error : fallback
}

export default function TenantDirectoryClient({ clients: initialClients, plans }: { clients: ClientRow[]; plans: PlanOption[] }) {
  const router = useRouter()
  const [clients, setClients] = useState(initialClients)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', slug: '', email: '', plan_id: plans[0]?.id ?? '' })
  const [newCredentials, setNewCredentials] = useState<{ email: string; password: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', plan_id: '' })
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedTab, setExpandedTab] = useState<Record<string, 'staff' | 'menus'>>({})
  const [tenantData, setTenantData] = useState<Record<string, TenantData>>({})
  const [inviteForm, setInviteForm] = useState<Record<string, { name: string; email: string }>>({})
  const [inviteLoading, setInviteLoading] = useState<string | null>(null)
  const [staffDeleteTarget, setStaffDeleteTarget] = useState<{ tenantId: string; member: StaffMember } | null>(null)
  const [staffResetTarget, setStaffResetTarget] = useState<{ tenantId: string; member: StaffMember } | null>(null)
  const [staffMutationLoading, setStaffMutationLoading] = useState(false)
  const [assignmentTenant, setAssignmentTenant] = useState<Record<string, string>>({})
  const [assignmentLoading, setAssignmentLoading] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<'name-asc' | 'name-desc' | 'newest' | 'oldest'>('name-asc')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const restaurants = useMemo(() => clients.filter(client => client.id), [clients])
  const pendingUsers = useMemo(() => clients.filter(client => !client.id), [clients])
  const activeCount = restaurants.filter(client => client.is_active).length
  const availablePlans = useMemo(() => {
    const planNames = new Map<string, string>()
    restaurants.forEach(restaurant => {
      if (restaurant.plan_slug) planNames.set(restaurant.plan_slug, restaurant.plan_name ?? restaurant.plan_slug)
    })
    return [...planNames].sort((a, b) => a[1].localeCompare(b[1]))
  }, [restaurants])
  const filteredRestaurants = useMemo(() => {
    const terms = normalizeSearchValue(searchQuery).split(/\s+/).filter(Boolean)
    return restaurants
      .filter(restaurant => {
        const haystack = normalizeSearchValue([
          restaurant.name,
          restaurant.slug,
          restaurant.email,
          restaurant.full_name,
          restaurant.plan_name,
          restaurant.plan_slug,
        ].filter(Boolean).join(' '))
        const matchesSearch = terms.every(term => haystack.includes(term))
        const matchesStatus = statusFilter === 'all'
          || (statusFilter === 'active' ? restaurant.is_active : !restaurant.is_active)
        const matchesPlan = planFilter === 'all'
          || (planFilter === 'no-plan' ? !restaurant.plan_slug : restaurant.plan_slug === planFilter)
        return matchesSearch && matchesStatus && matchesPlan
      })
      .sort((a, b) => {
        if (sortOrder === 'newest' || sortOrder === 'oldest') {
          const difference = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          return sortOrder === 'newest' ? -difference : difference
        }
        const difference = (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
        return sortOrder === 'name-desc' ? -difference : difference
      })
  }, [restaurants, searchQuery, statusFilter, planFilter, sortOrder])
  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || planFilter !== 'all' || sortOrder !== 'name-asc'
  const hasSecondaryFilters = statusFilter !== 'all' || planFilter !== 'all' || sortOrder !== 'name-asc'

  function clearFilters() {
    setSearchQuery('')
    setStatusFilter('all')
    setPlanFilter('all')
    setSortOrder('name-asc')
    setMobileFiltersOpen(false)
  }

  async function copyCredentials(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy credentials. Select and copy them manually.')
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setCreateLoading(true)
    setError(null)
    setNewCredentials(null)
    try {
      const response = await fetch('/api/superadmin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to create restaurant')
      const plan = data.subscription?.plan
      const client: ClientRow = {
        id: data.tenant.id,
        name: data.tenant.name,
        slug: data.tenant.slug,
        plan: plan?.slug ?? data.tenant.plan,
        plan_id: plan?.id ?? createForm.plan_id,
        plan_name: plan?.name ?? null,
        plan_slug: plan?.slug ?? null,
        subscription_status: data.subscription?.status ?? 'active',
        is_active: data.tenant.is_active,
        created_at: data.tenant.created_at,
        logo_url: data.tenant.logo_url ?? null,
        user_id: data.owner_id ?? null,
        email: createForm.email,
        full_name: null,
        provider: 'email',
      }
      setClients(current => [client, ...current])
      setCreateForm({ name: '', slug: '', email: '', plan_id: plans[0]?.id ?? '' })
      setShowCreate(false)
      setNewCredentials(data.credentials ?? null)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create restaurant')
    } finally {
      setCreateLoading(false)
    }
  }

  function startEdit(client: ClientRow) {
    setEditingId(client.id)
    setEditForm({ name: client.name ?? '', plan_id: client.plan_id ?? plans[0]?.id ?? '' })
  }

  async function handleSave(client: ClientRow) {
    if (!client.id) return
    setEditLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/tenants/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editForm.name }),
      })
      if (!response.ok) throw new Error(await getResponseError(response, 'Failed to update restaurant'))
      const tenant = await response.json()
      setClients(current => current.map(item => item.id === client.id ? { ...item, name: tenant.name } : item))

      if (editForm.plan_id && editForm.plan_id !== client.plan_id) {
        const planResponse = await fetch(`/api/superadmin/tenants/${client.id}/subscription`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: editForm.plan_id }),
        })
        if (!planResponse.ok) throw new Error(await getResponseError(planResponse, 'Restaurant saved, but its plan could not be updated'))
        const subscription = await planResponse.json()
        setClients(current => current.map(item => item.id === client.id ? {
          ...item,
          plan: subscription.plan?.slug ?? item.plan,
          plan_id: subscription.plan?.id ?? editForm.plan_id,
          plan_name: subscription.plan?.name ?? item.plan_name,
          plan_slug: subscription.plan?.slug ?? item.plan_slug,
          subscription_status: subscription.status ?? item.subscription_status,
        } : item))
      }
      setEditingId(null)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update restaurant')
    } finally {
      setEditLoading(false)
    }
  }

  async function toggleStatus(client: ClientRow) {
    if (!client.id) return
    setStatusLoadingId(client.id)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/tenants/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !client.is_active }),
      })
      if (!response.ok) throw new Error(await getResponseError(response, 'Failed to change restaurant status'))
      const data = await response.json()
      setClients(current => current.map(item => item.id === client.id ? { ...item, is_active: data.is_active } : item))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to change restaurant status')
    } finally {
      setStatusLoadingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    setError(null)
    try {
      const target = deleteTarget.id
        ? `/api/superadmin/tenants/${deleteTarget.id}`
        : deleteTarget.user_id ? `/api/superadmin/users/${deleteTarget.user_id}` : null
      if (!target) throw new Error('This record cannot be deleted')
      const response = await fetch(target, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getResponseError(response, 'Failed to delete record'))
      setClients(current => current.filter(item => deleteTarget.id ? item.id !== deleteTarget.id : item.user_id !== deleteTarget.user_id))
      setDeleteTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete record')
    } finally {
      setDeleteLoading(false)
    }
  }

  async function toggleDetails(tenantId: string, force = false) {
    if (expandedId === tenantId && !force) {
      setExpandedId(null)
      return
    }
    setExpandedId(tenantId)
    if (tenantData[tenantId] && !force && !tenantData[tenantId].loadError) return
    setTenantData(current => ({ ...current, [tenantId]: { ...emptyTenantData, loading: true } }))
    try {
      const [staffResponse, menuResponse] = await Promise.all([
        fetch(`/api/superadmin/tenants/${tenantId}/staff`),
        fetch(`/api/superadmin/tenants/${tenantId}/menus`),
      ])
      if (!staffResponse.ok) throw new Error(await getResponseError(staffResponse, 'Failed to load staff'))
      if (!menuResponse.ok) throw new Error(await getResponseError(menuResponse, 'Failed to load menus'))
      const [staff, menus] = await Promise.all([staffResponse.json(), menuResponse.json()])
      setTenantData(current => ({ ...current, [tenantId]: { ...emptyTenantData, staff, menus } }))
    } catch (cause) {
      setTenantData(current => ({
        ...current,
        [tenantId]: { ...emptyTenantData, loadError: cause instanceof Error ? cause.message : 'Failed to load details' },
      }))
    }
  }

  async function handleInvite(tenantId: string) {
    const invite = inviteForm[tenantId] ?? { name: '', email: '' }
    if (!invite.name.trim() || !invite.email.trim()) return
    setInviteLoading(tenantId)
    setTenantData(current => ({ ...current, [tenantId]: { ...current[tenantId], staffError: null } }))
    try {
      const response = await fetch(`/api/superadmin/tenants/${tenantId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invite),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to invite staff member')
      const member: StaffMember = {
        id: data.staff?.id ?? crypto.randomUUID(),
        email: data.staff?.email ?? invite.email,
        full_name: data.staff?.full_name ?? invite.name,
        phone: null,
        created_at: new Date().toISOString(),
      }
      setTenantData(current => ({
        ...current,
        [tenantId]: {
          ...current[tenantId],
          staff: [member, ...current[tenantId].staff],
          credentials: data.credentials ? { ...data.credentials, owner: member.full_name ?? member.email ?? '' } : null,
        },
      }))
      setInviteForm(current => ({ ...current, [tenantId]: { name: '', email: '' } }))
    } catch (cause) {
      setTenantData(current => ({
        ...current,
        [tenantId]: { ...current[tenantId], staffError: cause instanceof Error ? cause.message : 'Failed to invite staff member' },
      }))
    } finally {
      setInviteLoading(null)
    }
  }

  async function handleResetPassword() {
    if (!staffResetTarget) return
    const { tenantId, member } = staffResetTarget
    setStaffMutationLoading(true)
    try {
      const response = await fetch(`/api/superadmin/tenants/${tenantId}/staff/${member.id}`, { method: 'PATCH' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? 'Failed to reset password')
      setTenantData(current => ({
        ...current,
        [tenantId]: {
          ...current[tenantId],
          staffError: null,
          credentials: data.credentials ? { ...data.credentials, owner: member.full_name ?? member.email ?? '' } : null,
        },
      }))
      setStaffResetTarget(null)
    } catch (cause) {
      setTenantData(current => ({
        ...current,
        [tenantId]: { ...current[tenantId], staffError: cause instanceof Error ? cause.message : 'Failed to reset password' },
      }))
    } finally {
      setStaffMutationLoading(false)
    }
  }

  async function handleDeleteStaff() {
    if (!staffDeleteTarget) return
    const { tenantId, member } = staffDeleteTarget
    setStaffMutationLoading(true)
    try {
      const response = await fetch(`/api/superadmin/tenants/${tenantId}/staff/${member.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getResponseError(response, 'Failed to remove staff member'))
      setTenantData(current => ({
        ...current,
        [tenantId]: { ...current[tenantId], staff: current[tenantId].staff.filter(item => item.id !== member.id), staffError: null },
      }))
      setStaffDeleteTarget(null)
    } catch (cause) {
      setTenantData(current => ({
        ...current,
        [tenantId]: { ...current[tenantId], staffError: cause instanceof Error ? cause.message : 'Failed to remove staff member' },
      }))
    } finally {
      setStaffMutationLoading(false)
    }
  }

  async function handleAssign(user: ClientRow) {
    if (!user.user_id) return
    const tenantId = assignmentTenant[user.user_id]
    if (!tenantId) return
    setAssignmentLoading(user.user_id)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/users/${user.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, role: 'store-admin' }),
      })
      if (!response.ok) throw new Error(await getResponseError(response, 'Failed to assign user'))
      setClients(current => current
        .filter(item => item.user_id !== user.user_id)
        .map(item => item.id === tenantId && !item.user_id
          ? { ...item, user_id: user.user_id, email: user.email, full_name: user.full_name, provider: user.provider }
          : item))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to assign user')
    } finally {
      setAssignmentLoading(null)
    }
  }

  return (
    <div className="w-full p-8">
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete client"
        message={`Delete "${deleteTarget?.name ?? deleteTarget?.email}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => { if (!deleteLoading) setDeleteTarget(null) }}
        loading={deleteLoading}
      />
      <ConfirmDialog
        open={!!staffDeleteTarget}
        title="Remove staff member"
        message={`Remove "${staffDeleteTarget?.member.full_name ?? staffDeleteTarget?.member.email}"? They will lose dashboard access.`}
        confirmLabel="Remove"
        onConfirm={handleDeleteStaff}
        onCancel={() => { if (!staffMutationLoading) setStaffDeleteTarget(null) }}
        loading={staffMutationLoading}
      />
      <ConfirmDialog
        open={!!staffResetTarget}
        title="Reset password"
        message={`Generate a new temporary password for "${staffResetTarget?.member.full_name ?? staffResetTarget?.member.email}"? Their current password will stop working.`}
        confirmLabel="Reset password"
        onConfirm={handleResetPassword}
        onCancel={() => { if (!staffMutationLoading) setStaffResetTarget(null) }}
        loading={staffMutationLoading}
      />

      <header className="mb-8 flex flex-col items-stretch justify-between gap-4 sm:mb-10 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-900">Tenants Management</h1>
          <p className="mt-1 text-sm font-medium text-zinc-500">{activeCount} active of {restaurants.length} restaurant(s)</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setNewCredentials(null) }}
          className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-zinc-200 hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" /> New Restaurant
        </button>
      </header>

      {error && (
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
          <span className="flex items-center gap-2"><XCircle className="h-5 w-5" />{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">✕</button>
        </div>
      )}

      {newCredentials && (
        <div className="mb-6 rounded-2xl border border-green-100 bg-green-50 p-6">
          <p className="mb-3 flex items-center gap-2 font-bold text-green-800"><CheckCircle2 className="h-5 w-5" />Restaurant created</p>
          <div className="mb-4 space-y-2 rounded-xl border border-green-100 bg-white p-4 font-mono text-sm">
            <p><span className="text-zinc-400">Email: </span>{newCredentials.email}</p>
            <p><span className="text-zinc-400">Temporary password: </span>{newCredentials.password}</p>
          </div>
          <button onClick={() => copyCredentials(`Email: ${newCredentials.email}\nPassword: ${newCredentials.password}`)} className="mr-3 rounded-xl bg-green-700 px-4 py-2 text-xs font-bold text-white">
            {copied ? 'Copied!' : 'Copy access details'}
          </button>
          <button onClick={() => setNewCredentials(null)} className="px-4 py-2 text-xs font-bold text-green-700">Dismiss</button>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-8 grid max-w-2xl grid-cols-1 gap-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-100 sm:p-6 md:grid-cols-2 lg:rounded-3xl lg:p-8">
          <div className="md:col-span-2 flex items-center justify-between">
            <h2 className="text-xl font-bold">Add New Restaurant</h2>
            <button type="button" onClick={() => setShowCreate(false)} aria-label="Close form"><XCircle className="h-6 w-6 text-zinc-400" /></button>
          </div>
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Restaurant name
            <input required value={createForm.name} onChange={event => setCreateForm(current => ({ ...current, name: event.target.value, slug: slugify(event.target.value) }))} className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-normal normal-case" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Admin email
            <input required type="email" value={createForm.email} onChange={event => setCreateForm(current => ({ ...current, email: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-normal normal-case" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">URL slug
            <input required value={createForm.slug} onChange={event => setCreateForm(current => ({ ...current, slug: slugify(event.target.value) }))} className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-normal normal-case" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Subscription plan
            <select required value={createForm.plan_id} onChange={event => setCreateForm(current => ({ ...current, plan_id: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-normal normal-case">
              {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          {plans.length === 0 && <p className="md:col-span-2 text-xs text-red-600">Create an active plan before adding a restaurant.</p>}
          <div className="md:col-span-2 flex gap-3">
            <button disabled={createLoading || plans.length === 0} className="flex-1 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{createLoading ? 'Creating…' : 'Create restaurant'}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-6 py-3 text-sm font-bold text-zinc-500">Cancel</button>
          </div>
        </form>
      )}

      <section aria-label="Restaurant filters" className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"><SlidersHorizontal className="h-4 w-4" /></span>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <h2 className="text-sm font-bold text-zinc-900">Find restaurants</h2>
              <p aria-live="polite" className="text-xs tabular-nums text-zinc-500">{filteredRestaurants.length} of {restaurants.length} result(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(open => !open)}
              aria-expanded={mobileFiltersOpen}
              aria-controls="secondary-restaurant-filters"
              className="relative flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-zinc-600 transition-[background-color,color,scale] duration-150 hover:bg-zinc-100 hover:text-zinc-900 active:scale-96 min-[560px]:hidden"
            >
              Filters
              {hasSecondaryFilters && <span className="size-1.5 rounded-full bg-indigo-500" aria-label="Secondary filters active" />}
              <ChevronDown className={`size-3.5 transition-transform duration-150 ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
            </button>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="flex min-h-10 items-center rounded-xl px-3 text-xs font-bold text-zinc-500 transition-[background-color,color,scale] duration-150 hover:bg-zinc-100 hover:text-zinc-900 active:scale-96">
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-[minmax(10rem,1.8fr)_repeat(3,minmax(6rem,1fr))]">
          <label className="relative block">
            <span className="sr-only">Search restaurants</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search name, slug, email or plan…"
              className="min-h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-4 text-sm text-zinc-900 outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
            />
          </label>

          <div id="secondary-restaurant-filters" className={mobileFiltersOpen || hasSecondaryFilters ? 'contents' : 'hidden min-[560px]:contents'}>
          <label className="block">
            <span className="sr-only">Filter by status</span>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')} className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 min-[700px]:px-3 min-[700px]:text-sm">
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>

          <label className="block">
            <span className="sr-only">Filter by plan</span>
            <select value={planFilter} onChange={event => setPlanFilter(event.target.value)} className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 min-[700px]:px-3 min-[700px]:text-sm">
              <option value="all">All plans</option>
              {availablePlans.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
              <option value="no-plan">No plan</option>
            </select>
          </label>

          <label className="block">
            <span className="sr-only">Sort restaurants</span>
            <select value={sortOrder} onChange={event => setSortOrder(event.target.value as 'name-asc' | 'name-desc' | 'newest' | 'oldest')} className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 min-[700px]:px-3 min-[700px]:text-sm">
              <option value="name-asc">Name: A–Z</option>
              <option value="name-desc">Name: Z–A</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {filteredRestaurants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-5 py-12 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><Search className="h-5 w-5" /></div>
            <h2 className="text-sm font-bold text-zinc-900">No restaurants found</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">Try a different name, email, slug, status or subscription plan.</p>
            <button type="button" onClick={clearFilters} className="mt-4 min-h-10 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96">Clear filters</button>
          </div>
        ) : filteredRestaurants.map(client => {
          const tenantId = client.id!
          const data = tenantData[tenantId]
          const expanded = expandedId === tenantId
          const tab = expandedTab[tenantId] ?? 'staff'
          return (
            <section key={tenantId} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-shadow duration-150 hover:shadow-sm">
              <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50">
                      {client.logo_url ? <Image src={client.logo_url} alt={client.name ?? ''} width={48} height={48} className="object-contain outline outline-1 -outline-offset-1 outline-black/10" /> : <span className="text-xl font-bold text-zinc-300">{getInitials(client.name)}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="flex min-w-0 items-center gap-2 font-bold text-zinc-900">
                        <Link href={`/tenants/${tenantId}`} className="truncate hover:text-indigo-600">{client.name}</Link>
                        {client.plan_slug !== 'menu' && <Star className="h-3.5 w-3.5 flex-shrink-0 fill-blue-500 text-blue-500" />}
                      </h2>
                      <div className="mt-1 grid min-w-0 gap-1 text-xs text-zinc-500 sm:grid-cols-2 sm:gap-x-4">
                        <span className="flex min-w-0 items-center gap-1"><Globe className="h-3 w-3 flex-shrink-0" /><span className="truncate">/{client.slug}</span></span>
                        <span className="flex min-w-0 items-center gap-1" title={client.email ?? 'No administrator'}><Mail className="h-3 w-3 flex-shrink-0" /><span className="truncate">{client.email ?? 'No administrator'}</span></span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-[3.75rem]">
                    <button onClick={() => toggleStatus(client)} disabled={statusLoadingId === tenantId} className={`flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-[background-color,color,scale] duration-150 active:scale-96 disabled:opacity-60 ${client.is_active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                      {statusLoadingId === tenantId ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : client.is_active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {statusLoadingId === tenantId ? 'Saving' : client.is_active ? 'Active' : 'Inactive'}
                    </button>
                    <span className={`flex min-h-8 max-w-full items-center rounded-full border px-3 text-xs font-semibold uppercase ${client.plan_slug === 'payments' ? 'border-purple-100 bg-purple-50 text-purple-700' : client.plan_slug === 'orders' ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-zinc-100 bg-zinc-50 text-zinc-600'}`}>{client.plan_name ?? client.plan_slug ?? 'No plan'}</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <a href={`/${client.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`View live menu for ${client.name}`} className="group flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 pl-4 pr-3.5 text-xs font-bold text-white shadow-sm shadow-zinc-200 transition-[background-color,box-shadow,scale] duration-150 hover:bg-zinc-800 hover:shadow-md active:scale-96"><Eye className="h-4 w-4" />Live menu <ExternalLink className="h-3.5 w-3.5 opacity-60 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></a>
                    <Link href={`/tenants/${tenantId}`} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-zinc-50 px-3 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-100 active:scale-96">Manage <ChevronRight className="h-3.5 w-3.5" /></Link>
                    <a href={`/api/admin/enter-preview?tenant=${tenantId}`} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-zinc-50 px-3 text-xs font-bold text-zinc-600 transition-[background-color,scale] duration-150 hover:bg-zinc-100 active:scale-96"><LayoutDashboard className="h-4 w-4" />Dashboard</a>
                    <a href={`/api/admin/enter-preview?tenant=${tenantId}&next=${encodeURIComponent('/settings/branding')}`} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-zinc-50 px-3 text-xs font-bold text-zinc-600 transition-[background-color,scale] duration-150 hover:bg-zinc-100 active:scale-96"><Settings className="h-4 w-4" />Branding</a>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => toggleDetails(tenantId)} className={`flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-[background-color,color,scale] duration-150 active:scale-96 ${expanded ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-50'}`}><Users className="h-4 w-4" />Details {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => editingId === tenantId ? setEditingId(null) : startEdit(client)} className="flex size-10 items-center justify-center rounded-xl text-zinc-500 transition-[background-color,color,scale] duration-150 hover:bg-zinc-100 active:scale-96" aria-label={`Edit ${client.name}`}><Edit3 className="h-4 w-4" /></button>
                      <button onClick={() => setDeleteTarget(client)} className="flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-[background-color,color,scale] duration-150 hover:bg-red-50 hover:text-red-600 active:scale-96" aria-label={`Delete ${client.name}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              </div>

              {editingId === tenantId && (
                <div className="flex flex-col gap-3 border-t border-zinc-100 bg-zinc-50 p-5 sm:flex-row sm:items-end">
                  <label className="flex-1 text-xs font-medium text-zinc-600">Name<input value={editForm.name} onChange={event => setEditForm(current => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium text-zinc-600">Plan<select value={editForm.plan_id} onChange={event => setEditForm(current => ({ ...current, plan_id: event.target.value }))} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
                  <button onClick={() => handleSave(client)} disabled={editLoading} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{editLoading ? 'Saving…' : 'Save'}</button>
                </div>
              )}

              {expanded && (
                <div className="border-t border-zinc-100">
                  {data?.loading ? (
                    <div className="flex items-center justify-center gap-3 py-12 text-xs text-zinc-400"><span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-800" />Loading details…</div>
                  ) : data?.loadError ? (
                    <div className="py-10 text-center text-sm text-red-700"><p>{data.loadError}</p><button onClick={() => toggleDetails(tenantId, true)} className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-bold text-white">Retry</button></div>
                  ) : (
                    <>
                      <div className="flex gap-1 border-b border-zinc-100 bg-zinc-50 px-5 pt-2">
                        {(['staff', 'menus'] as const).map(item => <button key={item} onClick={() => setExpandedTab(current => ({ ...current, [tenantId]: item }))} className={`border-b-2 px-4 py-3 text-xs font-bold capitalize ${tab === item ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-zinc-400'}`}>{item} ({item === 'staff' ? data?.staff.length ?? 0 : data?.menus.length ?? 0})</button>)}
                      </div>
                      {tab === 'staff' ? (
                        <div className="space-y-5 p-4 sm:p-6">
                          {data?.staffError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{data.staffError}</div>}
                          {data?.credentials && <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-xs text-green-800"><p className="mb-2 font-bold">Credentials for {data.credentials.owner}</p><p className="font-mono">{data.credentials.email} · {data.credentials.password}</p><button onClick={() => copyCredentials(`Email: ${data.credentials!.email}\nPassword: ${data.credentials!.password}`)} className="mt-3 font-bold underline">{copied ? 'Copied!' : 'Copy credentials'}</button></div>}
                          <form onSubmit={event => { event.preventDefault(); handleInvite(tenantId) }} className="flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 sm:flex-row">
                            <input required placeholder="Full name" value={inviteForm[tenantId]?.name ?? ''} onChange={event => setInviteForm(current => ({ ...current, [tenantId]: { ...(current[tenantId] ?? { name: '', email: '' }), name: event.target.value } }))} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs" />
                            <input required type="email" placeholder="Email address" value={inviteForm[tenantId]?.email ?? ''} onChange={event => setInviteForm(current => ({ ...current, [tenantId]: { ...(current[tenantId] ?? { name: '', email: '' }), email: event.target.value } }))} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs" />
                            <button disabled={inviteLoading === tenantId} className="rounded-xl bg-zinc-900 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50">{inviteLoading === tenantId ? 'Sending…' : 'Invite'}</button>
                          </form>
                          {!data?.staff.length ? <p className="py-8 text-center text-xs text-zinc-400">No staff members yet</p> : (
                            <div className="divide-y divide-zinc-100 rounded-2xl border border-zinc-100">
                              {data.staff.map(member => <div key={member.id} className="group flex flex-wrap items-center gap-3 px-5 py-4"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">{(member.full_name ?? member.email ?? '?')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><p className="text-xs font-bold text-zinc-900">{member.full_name ?? 'N/A'}</p><p className="truncate text-xs text-zinc-400">{member.email}</p></div><div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><button onClick={() => setStaffResetTarget({ tenantId, member })} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-bold text-zinc-600">Reset password</button><button onClick={() => setStaffDeleteTarget({ tenantId, member })} className="rounded-lg p-1.5 text-zinc-400 hover:text-red-600" aria-label={`Remove ${member.full_name ?? member.email}`}><Trash2 className="h-4 w-4" /></button></div></div>)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 p-4 sm:p-6 md:grid-cols-2">
                          {!data?.menus.length ? <p className="col-span-full py-8 text-center text-xs text-zinc-400">No menus created yet</p> : data.menus.map(menu => <a key={menu.id} href={`/${client.slug}/${menu.slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-2xl border border-zinc-100 bg-zinc-50 p-4"><span><span className="block text-sm font-bold text-zinc-900">{menu.name}</span><span className="text-xs text-zinc-400">/{menu.slug}</span></span><span className={`text-xs font-bold ${menu.is_active ? 'text-green-600' : 'text-zinc-400'}`}>{menu.is_active ? 'Active' : 'Draft'}</span></a>)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {pendingUsers.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400"><Shield className="h-5 w-5 text-amber-500" />Pending Assignment</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {pendingUsers.map(user => <div key={user.user_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-100 bg-white p-4"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 font-bold text-amber-600">{(user.full_name ?? user.email ?? '?')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{user.email}</p><p className="text-xs text-zinc-400">{user.full_name ?? 'Anonymous user'}</p></div>{user.provider === 'google' && <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">Google</span>}<button onClick={() => setDeleteTarget(user)} className="flex size-10 items-center justify-center text-zinc-300 hover:text-red-600" aria-label={`Delete ${user.email}`}><Trash2 className="h-4 w-4" /></button><div className="basis-full flex flex-col gap-2 border-t border-amber-50 pt-3 sm:flex-row"><select value={user.user_id ? assignmentTenant[user.user_id] ?? '' : ''} onChange={event => user.user_id && setAssignmentTenant(current => ({ ...current, [user.user_id!]: event.target.value }))} className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs"><option value="">Choose restaurant…</option>{restaurants.map(tenant => <option key={tenant.id} value={tenant.id!}>{tenant.name}</option>)}</select><button onClick={() => handleAssign(user)} disabled={!user.user_id || !assignmentTenant[user.user_id] || assignmentLoading === user.user_id} className="min-h-11 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{assignmentLoading === user.user_id ? 'Assigning…' : 'Assign'}</button></div></div>)}
          </div>
        </section>
      )}
    </div>
  )
}
