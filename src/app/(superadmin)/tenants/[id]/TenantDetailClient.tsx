'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Eye,
  LayoutDashboard,
  Menu as MenuIcon,
  Plus,
  RefreshCw,
  Sparkles,
  Store,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

interface Tenant {
  id: string
  name: string
  slug: string
  plan: string | null
  is_active: boolean | null
  created_at: string
  logo_url: string | null
  xphere_account_id: string | null
  xphere_contact_id: string | null
  xphere_opportunity_id: string | null
  xphere_synced_at: string | null
  xphere_sync_error: string | null
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
  supported_languages?: string[]
}

interface Plan {
  id: string
  name: string
  monthly_price: number
  annual_price: number
  transaction_fee_pct: number
}

interface Subscription {
  id: string
  tenant_id: string
  plan_id: string
  billing_cycle: 'monthly' | 'annual'
  status: string
  override_monthly_price: number | null
  override_annual_price: number | null
  override_transaction_fee_pct: number | null
  override_notes: string | null
  plan: Plan | null
}

interface Credentials { email: string; password: string }

export default function TenantDetailClient({
  tenant,
  initialStaff,
  initialMenus,
  businessType,
  initialSubscription,
  availablePlans,
  canUseAiTools,
}: {
  tenant: Tenant
  initialStaff: StaffMember[]
  initialMenus: Menu[]
  businessType: string | null
  initialSubscription: Subscription | null
  availablePlans: Array<{ id: string; name: string; slug: string }>
  canUseAiTools: boolean
}) {
  const [tab, setTab] = useState<'staff' | 'menus' | 'subscription'>('staff')
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

  // AI Tools state
  const [seedLoading, setSeedLoading] = useState(false)
  const [seedStatus, setSeedStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [selectedMenuId, setSelectedMenuId] = useState<string>(initialMenus[0]?.id ?? '')
  const [businessTypeInput, setBusinessTypeInput] = useState('')
  const [perItemLoading, setPerItemLoading] = useState<string | null>(null)
  const [perItemError, setPerItemError] = useState<string | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')
  const [menuCategories, setMenuCategories] = useState<{ id: string; name: string }[]>([])

  // Image seeding state | Phase 10: AI-07, AI-08, AI-09
  const [imageSeedLoading, setImageSeedLoading] = useState<string | null>(null)
  const [imageSeedStatus, setImageSeedStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [menuProducts, setMenuProducts] = useState<{ id: string; name: string }[]>([])

  // OCR photo upload state | AI-10, AI-11
  const [ocrFile, setOcrFile] = useState<File | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrStatus, setOcrStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // CRM Sync (Xphere) state | OBS-01
  const [resyncLoading, setResyncLoading] = useState(false)
  const [resyncStatus, setResyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

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

  // Fetch categories for selected menu (per-item Seed product)
  useEffect(() => {
    if (!selectedMenuId) { setMenuCategories([]); setSelectedCategoryId(''); return }
    fetch(`/api/superadmin/tenants/${tenant.id}/menus/${selectedMenuId}/categories-list`)
      .then(r => r.json())
      .then(d => setMenuCategories(d.categories ?? []))
      .catch(() => setMenuCategories([]))
    setSelectedCategoryId('')
  }, [selectedMenuId, tenant.id])

  // Fetch products for selected category | for single-product image seed (AI-09)
  useEffect(() => {
    if (!selectedMenuId || !selectedCategoryId) { setMenuProducts([]); setSelectedProductId(''); return }
    fetch(`/api/superadmin/tenants/${tenant.id}/menus/${selectedMenuId}/products-list?categoryId=${selectedCategoryId}`)
      .then(r => r.json())
      .then((d: { products?: { id: string; name: string }[] }) => {
        setMenuProducts(d.products ?? [])
      })
      .catch(() => setMenuProducts([]))
    setSelectedProductId('')
  }, [selectedMenuId, selectedCategoryId, tenant.id])

  function buildSuccessMessage(type: string, data: { categoriesCreated?: number; productsCreated?: number }): string {
    const cats = data.categoriesCreated ?? 0
    const prods = data.productsCreated ?? 0
    if (type === 'menu') {
      if (cats === 0 && prods === 0) return 'Nothing added. All generated items already exist.'
      return `Menu seeded. ${cats} ${cats === 1 ? 'category' : 'categories'} and ${prods} ${prods === 1 ? 'product' : 'products'} added.`
    }
    if (type === 'categories') {
      if (cats === 0) return 'Nothing added. All generated items already exist.'
      return `${cats} ${cats === 1 ? 'category' : 'categories'} added.`
    }
    if (type === 'products') {
      if (prods === 0) return 'Nothing added. All generated items already exist.'
      return `${prods} ${prods === 1 ? 'product' : 'products'} added.`
    }
    if (type === 'copy') return 'Restaurant copy updated.'
    if (type === 'single_category') return cats > 0 ? 'Category added.' : 'Nothing added. Already exists.'
    if (type === 'single_product') return prods > 0 ? 'Product added.' : 'Nothing added. Already exists.'
    return 'Done.'
  }

  async function handleSeed(type: string) {
    if (!selectedMenuId) {
      setSeedStatus({ type: 'error', message: 'Select a menu before seeding.' })
      return
    }
    const effectiveBusinessType = businessTypeInput.trim() || businessType || ''
    if (!effectiveBusinessType) {
      setSeedStatus({ type: 'error', message: 'Enter a business type before seeding.' })
      return
    }
    setSeedLoading(true)
    setSeedStatus(null)
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenant.id}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          menuId: selectedMenuId,
          businessType: effectiveBusinessType,
          companyName: tenant.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSeedStatus({ type: 'error', message: data.error ?? 'Seeding failed. Check the API logs and retry.' })
      } else {
        setSeedStatus({ type: 'success', message: buildSuccessMessage(type, data) })
      }
    } catch {
      setSeedStatus({ type: 'error', message: 'Seeding failed. Check the API logs and retry.' })
    }
    setSeedLoading(false)
  }

  async function handleSeedSingle(type: 'single_category' | 'single_product', categoryId?: string) {
    if (!selectedMenuId) return
    const effectiveBusinessType = businessTypeInput.trim() || businessType || ''
    const key = type === 'single_product' ? (categoryId ?? 'prod') : 'cat'
    setPerItemLoading(key)
    setPerItemError(null)
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenant.id}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          menuId: selectedMenuId,
          categoryId,
          businessType: effectiveBusinessType,
          companyName: tenant.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPerItemError(data.error ?? 'Failed. Retry?')
        setTimeout(() => setPerItemError(null), 5000)
      }
    } catch {
      setPerItemError('Failed. Retry?')
      setTimeout(() => setPerItemError(null), 5000)
    }
    setPerItemLoading(null)
  }

  async function handleSeedImage(type: 'image_cover' | 'image_products' | 'image_single_product') {
    if (!selectedMenuId) {
      setImageSeedStatus({ type: 'error', message: 'Select a menu before seeding images.' })
      return
    }
    const effectiveBusinessType = businessTypeInput.trim() || businessType || ''
    if (type === 'image_single_product' && !selectedProductId) {
      setImageSeedStatus({ type: 'error', message: 'Select a product to seed an image for.' })
      return
    }
    setImageSeedLoading(type)
    setImageSeedStatus(null)
    try {
      const body: Record<string, string> = {
        type,
        menuId: selectedMenuId,
        businessType: effectiveBusinessType,
        companyName: tenant.name,
      }
      if (type === 'image_single_product' && selectedProductId) {
        body.productId = selectedProductId
      }
      const res = await fetch(`/api/superadmin/tenants/${tenant.id}/seed-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as {
        success?: boolean; error?: string; message?: string
        imagesCreated?: number; skipped?: boolean; partial?: boolean
      }
      if (!res.ok) {
        const errMsg = data.partial
          ? `Partial success: ${data.imagesCreated ?? 0} images created. Error: ${data.error ?? 'Unknown'}`
          : (data.error ?? 'Image seeding failed. Check API logs.')
        setImageSeedStatus({ type: 'error', message: errMsg })
      } else {
        setImageSeedStatus({ type: 'success', message: data.message ?? 'Done.' })
      }
    } catch {
      setImageSeedStatus({ type: 'error', message: 'Image seeding failed. Check API logs.' })
    }
    setImageSeedLoading(null)
  }

  async function handleOcrUpload() {
    if (!ocrFile) {
      setOcrStatus({ type: 'error', message: 'Select a menu photo first.' })
      return
    }
    if (!selectedMenuId) {
      setOcrStatus({ type: 'error', message: 'Select a menu before uploading.' })
      return
    }
    setOcrLoading(true)
    setOcrStatus(null)
    try {
      // Step 1: Get signed upload URL from ocr-upload-token route
      const tokenRes = await fetch(
        `/api/superadmin/tenants/${tenant.id}/ocr-upload-token?filename=${encodeURIComponent(ocrFile.name)}`
      )
      const tokenData = await tokenRes.json()
      if (!tokenRes.ok) {
        setOcrStatus({ type: 'error', message: tokenData.error ?? 'Failed to get upload URL.' })
        setOcrLoading(false)
        return
      }
      const { uploadUrl, storagePath } = tokenData as { uploadUrl: string; storagePath: string }

      // Step 2: PUT file directly to Supabase Storage (bypasses Vercel 4.5 MB body limit)
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': ocrFile.type || 'image/jpeg' },
        body: ocrFile,
      })
      if (!uploadRes.ok) {
        setOcrStatus({ type: 'error', message: `Storage upload failed: ${uploadRes.status}` })
        setOcrLoading(false)
        return
      }

      // Step 3: Call ocr-menu route to extract and write to DB
      const ocrRes = await fetch(`/api/superadmin/tenants/${tenant.id}/ocr-menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath, menuId: selectedMenuId }),
      })
      const ocrData = await ocrRes.json()
      if (!ocrRes.ok) {
        setOcrStatus({ type: 'error', message: ocrData.error ?? 'OCR extraction failed. Check server logs.' })
      } else {
        const cats = ocrData.categoriesCreated ?? 0
        const prods = ocrData.productsCreated ?? 0
        const msg = cats === 0 && prods === 0
          ? 'No new items extracted. All detected items already exist.'
          : `OCR complete. ${cats} ${cats === 1 ? 'category' : 'categories'} and ${prods} ${prods === 1 ? 'product' : 'products'} added.`
        setOcrStatus({ type: 'success', message: msg })
        setOcrFile(null)
      }
    } catch {
      setOcrStatus({ type: 'error', message: 'OCR upload failed. Check the API logs and retry.' })
    }
    setOcrLoading(false)
  }

  // CRM Sync re-sync handler | OBS-01: re-enqueues a full Xphere sync for this tenant
  async function handleResync() {
    setResyncLoading(true)
    setResyncStatus(null)
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenant.id}/xphere-resync`, { method: 'POST' })
      if (res.ok) {
        setResyncStatus({ type: 'success', message: 'Re-sync enqueued.' })
      } else {
        const data = await res.json().catch(() => ({}))
        setResyncStatus({ type: 'error', message: data.error ?? 'Re-sync failed.' })
      }
    } catch {
      setResyncStatus({ type: 'error', message: 'Re-sync failed.' })
    }
    setResyncLoading(false)
  }

  // Subscription form state
  const [subscription, setSubscription] = useState(initialSubscription)
  const [selectedPlanId, setSelectedPlanId] = useState(initialSubscription?.plan_id ?? availablePlans[0]?.id ?? '')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>(initialSubscription?.billing_cycle ?? 'monthly')
  const [overrideMonthlyPrice, setOverrideMonthlyPrice] = useState(initialSubscription?.override_monthly_price?.toString() ?? '')
  const [overrideAnnualPrice, setOverrideAnnualPrice] = useState(initialSubscription?.override_annual_price?.toString() ?? '')
  const [overrideTransactionFee, setOverrideTransactionFee] = useState(initialSubscription?.override_transaction_fee_pct?.toString() ?? '')
  const [overrideNotes, setOverrideNotes] = useState(initialSubscription?.override_notes ?? '')
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)

  const input = 'min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50'
  const planBadge = tenant.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
    tenant.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' : 'bg-zinc-100 text-zinc-600'
  const hasXphereConnection = Boolean(
    tenant.xphere_account_id ||
    tenant.xphere_contact_id ||
    tenant.xphere_opportunity_id ||
    tenant.xphere_synced_at ||
    tenant.xphere_sync_error
  )

  return (
    <div className="w-full px-4 py-5 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-7xl">
      <ConfirmDialog
        open={!!confirmId}
        title="Remove staff member"
        message={`Remove "${confirmName}"? They will lose access to the dashboard.`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setConfirmId(null)}
      />

      {/* Header */}
      <Link href="/tenants" className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-zinc-500 transition-[background-color,color,scale] duration-150 hover:bg-zinc-100 hover:text-zinc-900 active:scale-96">
        <ArrowLeft className="size-4" />
        All restaurants
      </Link>

      <header className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50 sm:size-14">
              {tenant.logo_url
                ? <Image src={tenant.logo_url} alt={tenant.name} width={56} height={56} className="size-full object-contain outline outline-1 -outline-offset-1 outline-black/10" />
                : <Store className="size-5 text-zinc-400" />}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold text-zinc-950 text-balance sm:text-2xl">{tenant.name}</h1>
                <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-[11px] font-bold uppercase ${planBadge}`}>{tenant.plan ?? 'No plan'}</span>
                <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${tenant.is_active ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
                  {tenant.is_active && <CheckCircle2 className="size-3.5" />}
                  {tenant.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-zinc-500">/{tenant.slug}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:flex lg:shrink-0">
            <a
              href={`/${tenant.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View live menu for ${tenant.name}`}
              className="group flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white shadow-sm shadow-zinc-200 transition-[background-color,box-shadow,scale] duration-150 hover:bg-zinc-800 hover:shadow-md active:scale-96"
            >
              <Eye className="size-4" />
              Live menu
              <ExternalLink className="size-3.5 opacity-60 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
            <a
              href={`/api/admin/enter-preview?tenant=${tenant.id}`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96"
            >
              <LayoutDashboard className="size-4" />
              Dashboard
            </a>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}<button onClick={() => setError(null)} aria-label="Dismiss error" className="ml-4 flex size-10 shrink-0 items-center justify-center rounded-lg text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"><X className="size-4" /></button>
        </div>
      )}

      {credentials && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 sm:p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="mb-3 text-sm font-semibold text-green-800">Credentials generated:</p>
              <div className="space-y-1 font-mono text-sm text-green-900">
                {credentialsOwner?.full_name && <p><span className="text-green-600">Name:</span> {credentialsOwner.full_name}</p>}
                <p><span className="text-green-600">Email:</span> {credentials.email}</p>
                <p><span className="text-green-600">Password:</span> {credentials.password}</p>
              </div>
            </div>
            <button onClick={() => { setCredentials(null); setCredentialsOwner(null) }} aria-label="Dismiss credentials" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-green-500 transition-colors hover:bg-green-100 hover:text-green-700"><X className="size-4" /></button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <nav aria-label="Restaurant management sections" className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
        {(['staff', 'menus', 'subscription'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition-[background-color,color,box-shadow,scale] duration-150 active:scale-96 sm:px-4 sm:text-sm ${tab === t ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'}`}
          >
            {t === 'staff' ? <Users className="size-4 shrink-0" /> : t === 'menus' ? <MenuIcon className="size-4 shrink-0" /> : <CreditCard className="size-4 shrink-0" />}
            <span className="truncate">{t === 'staff' ? 'Staff' : t === 'menus' ? 'Menus' : 'Subscription'}</span>
            {t !== 'subscription' && <span className={`hidden min-w-6 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums sm:inline-flex sm:justify-center ${tab === t ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{t === 'staff' ? staff.length : menus.length}</span>}
          </button>
        ))}
      </nav>

      {/* Staff tab */}
      {tab === 'staff' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><UserPlus className="size-4" /></span>
              <div>
                <h2 className="text-sm font-bold text-zinc-950">Add staff member</h2>
                <p className="text-xs text-zinc-500">Create dashboard access for a restaurant teammate.</p>
              </div>
            </div>
            <form onSubmit={handleInvite}>
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <label className="block text-xs font-bold text-zinc-600">
                  Name
                  <input required value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jane Doe" className={`mt-2 ${input}`} />
                </label>
                <label className="block text-xs font-bold text-zinc-600">
                  Email
                  <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="jane@restaurant.com" className={`mt-2 ${input}`} />
                </label>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  {inviteLoading ? 'Adding…' : 'Add staff'}
                </button>
              </div>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            {staff.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><Users className="size-5" /></span>
                <h3 className="text-sm font-bold text-zinc-900">No staff members yet</h3>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">Add the first teammate above to give them access to this restaurant&apos;s dashboard.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {staff.map(member => (
                  <article key={member.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-zinc-900">{member.full_name ?? 'N/A'}</p>
                      <p className="truncate text-xs text-zinc-500">{member.email}</p>
                      {member.phone && <p className="text-xs text-zinc-500">{member.phone}</p>}
                      <p className="mt-1 text-[11px] text-zinc-400">Added {new Date(member.created_at).toLocaleDateString('en-US')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                      <button onClick={() => void handleResetPassword(member)} className="min-h-10 rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96">New password</button>
                      <button onClick={() => { setConfirmId(member.id); setConfirmName(member.full_name ?? member.email ?? '') }} className="min-h-10 rounded-xl bg-red-50 px-3 text-xs font-bold text-red-600 transition-[background-color,scale] duration-150 hover:bg-red-100 active:scale-96">Remove</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Menus tab */}
      {tab === 'menus' && (
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {menus.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><MenuIcon className="size-5" /></span>
              <h2 className="text-sm font-bold text-zinc-900">No menus yet</h2>
              <p className="mx-auto mb-4 mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">Create a menu before adding categories, products, or AI-generated content.</p>
              <a
                href={`/api/admin/enter-preview?tenant=${tenant.id}&next=${encodeURIComponent('/menus')}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96"
              >
                <Plus className="size-4" />
                Create menu
              </a>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {menus.map(menu => (
                <article key={menu.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500"><MenuIcon className="size-4" /></span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-zinc-900">{menu.name}</p>
                      <p className="truncate text-xs text-zinc-500">/{menu.slug}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] text-xs text-zinc-500 sm:justify-end sm:pl-0">
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-semibold uppercase">{menu.language ?? 'N/A'}</span>
                    <span className={`rounded-full px-2.5 py-1 font-semibold ${menu.is_active ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>{menu.is_active ? 'Active' : 'Inactive'}</span>
                    <span className="tabular-nums">Created {new Date(menu.created_at).toLocaleDateString('en-US')}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Subscription tab */}
      {tab === 'subscription' && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          {!subscription?.plan ? (
            <div className="mx-auto max-w-md py-6 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400"><CreditCard className="size-5" /></span>
              <h2 className="text-sm font-bold text-zinc-900">Assign a subscription plan</h2>
              <p className="mb-4 mt-1 text-xs leading-relaxed text-zinc-500">Choose the plan that controls this restaurant&apos;s available features.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedPlanId}
                  onChange={event => setSelectedPlanId(event.target.value)}
                  className="min-h-11 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
                >
                  {availablePlans.length === 0 && <option value="">No active plans available</option>}
                  {availablePlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
                <button
                  disabled={!selectedPlanId || subscriptionLoading}
                  onClick={async () => {
                    setSubscriptionLoading(true)
                    setError(null)
                    try {
                      const res = await fetch(`/api/superadmin/tenants/${tenant.id}/subscription`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ plan_id: selectedPlanId }),
                      })
                      const data = await res.json().catch(() => null)
                      if (!res.ok) throw new Error(data?.error ?? 'Failed to assign plan')
                      setSubscription(data)
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Failed to assign plan')
                    } finally {
                      setSubscriptionLoading(false)
                    }
                  }}
                  className="min-h-11 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
                >
                  {subscriptionLoading ? 'Assigning...' : 'Assign plan'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Current Plan */}
              <div className="rounded-xl bg-zinc-50 p-4">
                <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Current Plan</p>
                <p className="text-lg font-semibold text-zinc-900">{subscription.plan.name}</p>
              </div>

              {/* Effective Pricing */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-zinc-50 p-4">
                  <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Monthly Price</p>
                  <p className="text-lg font-semibold text-zinc-900">
                    {subscription.override_monthly_price !== null
                      ? `$${subscription.override_monthly_price}`
                      : `$${subscription.plan.monthly_price}`}
                  </p>
                  {subscription.override_monthly_price !== null && (
                    <p className="text-xs text-green-600 mt-1">Override applied</p>
                  )}
                </div>
                <div className="rounded-xl bg-zinc-50 p-4">
                  <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Annual Price</p>
                  <p className="text-lg font-semibold text-zinc-900">
                    {subscription.override_annual_price !== null
                      ? `$${subscription.override_annual_price}`
                      : `$${subscription.plan.annual_price}`}
                  </p>
                  {subscription.override_annual_price !== null && (
                    <p className="text-xs text-green-600 mt-1">Override applied</p>
                  )}
                </div>
              </div>

              {/* Transaction Fee */}
              <div className="rounded-xl bg-zinc-50 p-4">
                <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Transaction Fee</p>
                <p className="text-lg font-semibold text-zinc-900">
                  {subscription.override_transaction_fee_pct !== null
                    ? `${subscription.override_transaction_fee_pct}%`
                    : `${subscription.plan.transaction_fee_pct}%`}
                </p>
                {subscription.override_transaction_fee_pct !== null && (
                  <p className="text-xs text-green-600 mt-1">Override applied</p>
                )}
              </div>

              {/* Billing Cycle */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-2">Billing Cycle</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`min-h-10 rounded-xl px-4 text-sm font-bold transition-[background-color,scale] duration-150 active:scale-96 ${
                      billingCycle === 'monthly'
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`min-h-10 rounded-xl px-4 text-sm font-bold transition-[background-color,scale] duration-150 active:scale-96 ${
                      billingCycle === 'annual'
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  >
                    Annual
                  </button>
                </div>
              </div>

              {/* Override Fields */}
              <div>
                <p className="text-sm font-medium text-zinc-700 mb-3">Price Overrides (leave empty to use base)</p>
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Override Monthly Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={overrideMonthlyPrice}
                      onChange={e => setOverrideMonthlyPrice(e.target.value)}
                      placeholder={subscription.plan.monthly_price.toString()}
                      className={input}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Override Annual Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={overrideAnnualPrice}
                      onChange={e => setOverrideAnnualPrice(e.target.value)}
                      placeholder={subscription.plan.annual_price.toString()}
                      className={input}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Override Fee (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={overrideTransactionFee}
                      onChange={e => setOverrideTransactionFee(e.target.value)}
                      placeholder={subscription.plan.transaction_fee_pct.toString()}
                      className={input}
                    />
                  </div>
                </div>

                {/* Override Notes */}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Override Notes</label>
                  <textarea
                    value={overrideNotes}
                    onChange={e => setOverrideNotes(e.target.value)}
                    placeholder="Reason for override..."
                    rows={2}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
                  />
                </div>

                <button
                  onClick={async () => {
                    setSubscriptionLoading(true)
                    setError(null)

                    const res = await fetch(`/api/superadmin/tenants/${tenant.id}/subscription`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        billing_cycle: billingCycle,
                        override_monthly_price: overrideMonthlyPrice === '' ? null : Number(overrideMonthlyPrice),
                        override_annual_price: overrideAnnualPrice === '' ? null : Number(overrideAnnualPrice),
                        override_transaction_fee_pct: overrideTransactionFee === '' ? null : Number(overrideTransactionFee),
                        override_notes: overrideNotes || null,
                      }),
                    })

                    if (res.ok) {
                      const data = await res.json()
                      setSubscription(data)
                      setError(null)
                    } else {
                      const data = await res.json()
                      setError(data.error ?? 'Failed to save override')
                    }

                    setSubscriptionLoading(false)
                  }}
                  disabled={subscriptionLoading}
                  className="min-h-11 rounded-xl bg-zinc-900 px-5 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
                >
                  {subscriptionLoading ? 'Saving...' : 'Save Override'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* AI Tools section | D-02: placed below Tabs, always visible */}
      {canUseAiTools && (
      <details className="group mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 [&::-webkit-details-marker]:hidden sm:px-5">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Sparkles className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-zinc-950">AI tools</span>
              <span className="block truncate text-xs text-zinc-500">Generate content, images and import a photographed menu.</span>
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="border-t border-zinc-100 p-4 sm:p-5">

        {/* Business type context line */}
        {businessType && !businessTypeInput ? (
          <p className="text-xs text-zinc-400 mb-4">
            Seeding for: <span className="font-medium text-zinc-700">{businessType}</span>
          </p>
        ) : (
          <div className="mb-4">
            <p className="text-xs text-zinc-400 mb-1">Business type not set. Enter it to enable seeding:</p>
            <input
              type="text"
              value={businessTypeInput}
              onChange={e => setBusinessTypeInput(e.target.value)}
              placeholder="e.g. pizzeria, cafe, bar"
              className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 sm:w-64"
            />
          </div>
        )}

        {/* Menu selector | shown only when tenant has multiple menus */}
        {menus.length > 1 && (
          <select
            value={selectedMenuId}
            onChange={e => setSelectedMenuId(e.target.value)}
            className="mb-4 block min-h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 sm:w-auto"
            disabled={seedLoading}
          >
            <option value="">Select menu to seed...</option>
            {menus.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        {/* No menus state */}
        {menus.length === 0 && (
          <p className="text-xs text-zinc-400 mb-4">No menus yet. Create a menu first to enable seeding.</p>
        )}

        {/* Bulk seed buttons | D-03 */}
        {menus.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              onClick={() => void handleSeed('menu')}
              disabled={seedLoading || !selectedMenuId}
              className="min-h-10 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
            >
              {seedLoading ? 'Seeding...' : 'Seed menu'}
            </button>
            <button
              onClick={() => void handleSeed('categories')}
              disabled={seedLoading || !selectedMenuId}
              className="min-h-10 rounded-xl bg-zinc-100 px-4 text-sm font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
            >
              Seed categories
            </button>
            <button
              onClick={() => void handleSeed('products')}
              disabled={seedLoading || !selectedMenuId}
              className="min-h-10 rounded-xl bg-zinc-100 px-4 text-sm font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
            >
              Seed products
            </button>
            <button
              onClick={() => void handleSeed('copy')}
              disabled={seedLoading || !selectedMenuId}
              className="min-h-10 rounded-xl bg-zinc-100 px-4 text-sm font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
            >
              Seed copy
            </button>
          </div>
        )}

        {/* Loading pulse message */}
        {seedLoading && (
          <p className="text-xs text-zinc-400 mt-3 animate-pulse">
            Generating menu content. This may take up to 20 seconds...
          </p>
        )}

        {/* Success banner */}
        {seedStatus?.type === 'success' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-green-800">{seedStatus.message}</p>
              <button onClick={() => setSeedStatus(null)} className="text-green-500 hover:text-green-700 text-xl">✕</button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {seedStatus?.type === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-4 text-sm text-red-700 flex items-center justify-between">
            {seedStatus.message}
            <button onClick={() => setSeedStatus(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Per-item seed section | D-03: single category and single product | AI-06 */}
        {menus.length > 0 && selectedMenuId && (
          <div className="mt-5 pt-4 border-t border-zinc-100">
            <p className="text-xs text-zinc-400 mb-3">Per-item seeding</p>

            {/* Seed category row */}
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => void handleSeedSingle('single_category')}
                disabled={!!perItemLoading || seedLoading}
                className="min-h-10 rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
              >
                {perItemLoading === 'cat' ? 'Seeding...' : 'Seed category'}
              </button>
            </div>

            {/* Seed product row | requires category selection */}
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedCategoryId}
                onChange={e => setSelectedCategoryId(e.target.value)}
                disabled={!!perItemLoading || seedLoading}
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-xs outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 disabled:opacity-50"
              >
                <option value="">Select category...</option>
                {menuCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (!selectedCategoryId) {
                    setPerItemError('Select a category first.')
                    setTimeout(() => setPerItemError(null), 3000)
                    return
                  }
                  void handleSeedSingle('single_product', selectedCategoryId)
                }}
                disabled={!!perItemLoading || seedLoading || !selectedCategoryId}
                className="min-h-10 rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
              >
                {perItemLoading === selectedCategoryId ? 'Seeding...' : 'Seed product'}
              </button>
            </div>

            {perItemError && (
              <p className="text-xs text-red-500 mt-2">{perItemError}</p>
            )}
          </div>
        )}

        {/* Image Seeding | Phase 10: AI-07, AI-08, AI-09 */}
        {menus.length > 0 && selectedMenuId && (
          <div className="mt-5 pt-4 border-t border-zinc-100">
            <p className="text-xs text-zinc-400 mb-3">Image seeding</p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => void handleSeedImage('image_cover')}
                disabled={!!imageSeedLoading || seedLoading}
                className="min-h-10 rounded-xl bg-zinc-100 px-4 text-sm font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
              >
                {imageSeedLoading === 'image_cover' ? 'Generating cover...' : 'Seed cover'}
              </button>
              <button
                onClick={() => void handleSeedImage('image_products')}
                disabled={!!imageSeedLoading || seedLoading}
                className="min-h-10 rounded-xl bg-zinc-100 px-4 text-sm font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
              >
                {imageSeedLoading === 'image_products' ? 'Seeding images...' : 'Seed product images'}
              </button>
            </div>
            {imageSeedLoading === 'image_products' && (
              <p className="text-xs text-zinc-400 mb-3 animate-pulse">
                Generating images. This may take several minutes. Keep this tab open.
              </p>
            )}
            {imageSeedLoading === 'image_cover' && (
              <p className="text-xs text-zinc-400 mb-3 animate-pulse">
                Generating cover photo. This may take up to 30 seconds...
              </p>
            )}
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                disabled={!!imageSeedLoading || seedLoading || menuProducts.length === 0}
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-xs outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50 disabled:opacity-50"
              >
                <option value="">
                  {menuProducts.length === 0
                    ? (selectedCategoryId ? 'No products in this category' : 'Select a category above first')
                    : 'Select product...'}
                </option>
                {menuProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={() => void handleSeedImage('image_single_product')}
                disabled={!!imageSeedLoading || seedLoading || !selectedProductId}
                className="min-h-10 rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
              >
                {imageSeedLoading === 'image_single_product' ? 'Generating...' : 'Seed image'}
              </button>
            </div>
            {imageSeedStatus?.type === 'success' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-green-800">{imageSeedStatus.message}</p>
                  <button onClick={() => setImageSeedStatus(null)} className="text-green-500 hover:text-green-700 text-xl">✕</button>
                </div>
              </div>
            )}
            {imageSeedStatus?.type === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-4 text-sm text-red-700 flex items-center justify-between">
                {imageSeedStatus.message}
                <button onClick={() => setImageSeedStatus(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
              </div>
            )}
          </div>
        )}

        {/* OCR photo upload section | AI-10, AI-11 */}
        {menus.length > 0 && selectedMenuId && (
          <div className="mt-5 pt-4 border-t border-zinc-100">
            <p className="text-xs text-zinc-400 mb-3">Menu photo OCR</p>

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <input
                type="file"
                accept="image/*"
                disabled={ocrLoading}
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setOcrFile(f)
                  setOcrStatus(null)
                }}
                className="min-w-0 flex-1 text-xs text-zinc-600 file:mr-2 file:min-h-10 file:rounded-xl file:border-0 file:bg-zinc-100 file:px-3 file:text-xs file:font-bold file:text-zinc-700 hover:file:bg-zinc-200 disabled:opacity-50"
              />
              <button
                onClick={() => void handleOcrUpload()}
                disabled={ocrLoading || !ocrFile || !!imageSeedLoading || seedLoading}
                className="min-h-10 rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-700 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
              >
                {ocrLoading ? 'Extracting...' : 'Upload & Extract'}
              </button>
            </div>
            {ocrFile && ocrFile.size > 4 * 1024 * 1024 && (
              <p className="text-xs text-amber-600 mt-1">Large photos may take longer; results may vary.</p>
            )}

            {ocrLoading && (
              <p className="text-xs text-zinc-400 mt-2 animate-pulse">
                Extracting menu. This may take up to 30 seconds...
              </p>
            )}

            {ocrStatus?.type === 'success' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mt-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-green-800">{ocrStatus.message}</p>
                  <button onClick={() => setOcrStatus(null)} className="text-green-500 hover:text-green-700 text-xl">✕</button>
                </div>
              </div>
            )}

            {ocrStatus?.type === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-3 text-sm text-red-700 flex items-center justify-between">
                {ocrStatus.message}
                <button onClick={() => setOcrStatus(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
              </div>
            )}
          </div>
        )}
        </div>
      </details>
      )}

      {/* CRM Sync section | OBS-01: surface Xphere sync state + manual re-sync */}
      {canUseAiTools && hasXphereConnection && (
      <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><RefreshCw className="size-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-zinc-950">Xphere sync</h2>
            <p className="text-xs text-zinc-500">Internal CRM connection status and manual synchronization.</p>
          </div>
        </div>

        <div className="space-y-1 mb-4">
          <p className="text-xs text-zinc-500">
            {tenant.xphere_synced_at
              ? <>Last synced: <span className="font-medium text-zinc-700">{new Date(tenant.xphere_synced_at).toLocaleString('en-US')}</span></>
              : <span className="text-zinc-400">Never synced</span>}
          </p>
          <p className="text-xs">
            {tenant.xphere_account_id
              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Linked</span>
              : <span className="inline-flex items-center px-2 py-0.5 rounded-full font-medium bg-zinc-100 text-zinc-500">Not linked</span>}
          </p>
        </div>

        {tenant.xphere_sync_error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
            {tenant.xphere_sync_error}
          </div>
        )}

        <button
          onClick={() => void handleResync()}
          disabled={resyncLoading}
          className="flex min-h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${resyncLoading ? 'animate-spin' : ''}`} />
          {resyncLoading ? 'Re-syncing...' : 'Re-sync now'}
        </button>

        {resyncStatus?.type === 'success' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mt-4 text-sm text-green-800 flex items-center justify-between">
            {resyncStatus.message}
            <button onClick={() => setResyncStatus(null)} className="ml-4 text-green-500 hover:text-green-700">✕</button>
          </div>
        )}
        {resyncStatus?.type === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-4 text-sm text-red-700 flex items-center justify-between">
            {resyncStatus.message}
            <button onClick={() => setResyncStatus(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
      </section>
      )}
      </div>
    </div>
  )
}
