'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Tenant {
  id: string
  name: string
  slug: string
  plan: string | null
  is_active: boolean | null
  created_at: string
  logo_url: string | null
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
}: {
  tenant: Tenant
  initialStaff: StaffMember[]
  initialMenus: Menu[]
  businessType: string | null
  initialSubscription: Subscription | null
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

  // Subscription form state
  const [subscription, setSubscription] = useState(initialSubscription)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>(initialSubscription?.billing_cycle ?? 'monthly')
  const [overrideMonthlyPrice, setOverrideMonthlyPrice] = useState(initialSubscription?.override_monthly_price?.toString() ?? '')
  const [overrideAnnualPrice, setOverrideAnnualPrice] = useState(initialSubscription?.override_annual_price?.toString() ?? '')
  const [overrideTransactionFee, setOverrideTransactionFee] = useState(initialSubscription?.override_transaction_fee_pct?.toString() ?? '')
  const [overrideNotes, setOverrideNotes] = useState(initialSubscription?.override_notes ?? '')
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'
  const planBadge = tenant.plan === 'pro' ? 'bg-blue-100 text-blue-700' :
    tenant.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' : 'bg-zinc-100 text-zinc-600'

  return (
    <div className="p-8 w-full">
      <ConfirmDialog
        open={!!confirmId}
        title="Remove staff member"
        message={`Remove "${confirmName}"? They will lose access to the dashboard.`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setConfirmId(null)}
      />

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <a href="/tenants" className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors">← Clients</a>
        <div className="w-px h-4 bg-zinc-200" />
        <div className="flex items-center gap-3">
          {tenant.logo_url
            ? <Image src={tenant.logo_url} alt={tenant.name} width={40} height={40} className="rounded-lg object-contain border border-zinc-100" />
            : <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center text-lg">🏪</div>}
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{tenant.name}</h1>
            <p className="text-xs text-zinc-400">/{tenant.slug}</p>
          </div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ml-1 ${planBadge}`}>{tenant.plan}</span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tenant.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
          {tenant.is_active ? 'Active' : 'Inactive'}
        </span>
        <div className="ml-auto flex gap-2">
          <a
            href={`/api/admin/enter-preview?tenant=${tenant.id}`}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium"
          >
            Dashboard
          </a>
          <a
            href={`/${tenant.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            View menu
          </a>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 flex items-center justify-between">
          {error}<button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {credentials && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-800 mb-3">Credentials generated:</p>
              <div className="space-y-1 font-mono text-sm text-green-900">
                {credentialsOwner?.full_name && <p><span className="text-green-600">Name:</span> {credentialsOwner.full_name}</p>}
                <p><span className="text-green-600">Email:</span> {credentials.email}</p>
                <p><span className="text-green-600">Password:</span> {credentials.password}</p>
              </div>
            </div>
            <button onClick={() => { setCredentials(null); setCredentialsOwner(null) }} className="text-green-500 hover:text-green-700 text-xl">✕</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-200">
        {(['staff', 'menus', 'subscription'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}
          >
            {t === 'staff' ? `Staff (${staff.length})` : t === 'menus' ? `Menus (${menus.length})` : 'Subscription'}
          </button>
        ))}
      </div>

      {/* Staff tab */}
      {tab === 'staff' && (
        <div>
          <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-4">
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Add staff member</h2>
            <form onSubmit={handleInvite} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
                  <input required value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jane Doe" className={input} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
                  <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="jane@restaurant.com" className={input} />
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

          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {staff.length === 0 ? (
              <div className="py-12 text-center text-zinc-400 text-sm">No staff members yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Member</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Added</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {staff.map(member => (
                    <tr key={member.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-900">{member.full_name ?? 'N/A'}</p>
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
      )}

      {/* Menus tab */}
      {tab === 'menus' && (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          {menus.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">No menus yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Menu</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Language</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {menus.map(menu => (
                  <tr key={menu.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-zinc-900">{menu.name}</p>
                      <p className="text-xs text-zinc-400">/{menu.slug}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-zinc-500">{menu.language ?? 'N/A'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${menu.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
                        {menu.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-zinc-400">
                      {new Date(menu.created_at).toLocaleDateString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Subscription tab */}
      {tab === 'subscription' && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          {!subscription?.plan ? (
            <p className="text-sm text-zinc-400 text-center py-8">
              No subscription found. This tenant needs to be assigned to a plan first.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Current Plan */}
              <div className="bg-zinc-50 rounded-lg p-4">
                <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Current Plan</p>
                <p className="text-lg font-semibold text-zinc-900">{subscription.plan.name}</p>
              </div>

              {/* Effective Pricing */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 rounded-lg p-4">
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
                <div className="bg-zinc-50 rounded-lg p-4">
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
              <div className="bg-zinc-50 rounded-lg p-4">
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
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      billingCycle === 'monthly'
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Override Monthly Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={overrideMonthlyPrice}
                      onChange={e => setOverrideMonthlyPrice(e.target.value)}
                      placeholder={subscription.plan.monthly_price.toString()}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
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
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
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
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
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
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
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
                        override_monthly_price: overrideMonthlyPrice === '' ? null : parseFloat(overrideMonthlyPrice) || null,
                        override_annual_price: overrideAnnualPrice === '' ? null : parseFloat(overrideAnnualPrice) || null,
                        override_transaction_fee_pct: overrideTransactionFee === '' ? null : parseFloat(overrideTransactionFee) || null,
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
                  className="bg-zinc-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  {subscriptionLoading ? 'Saving...' : 'Save Override'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Tools section | D-02: placed below Tabs, always visible */}
      <div className="mt-8 bg-white border border-zinc-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-1">AI Tools</h2>

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
              className="w-64 px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        )}

        {/* Menu selector | shown only when tenant has multiple menus */}
        {menus.length > 1 && (
          <select
            value={selectedMenuId}
            onChange={e => setSelectedMenuId(e.target.value)}
            className="px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 mb-4 block"
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleSeed('menu')}
              disabled={seedLoading || !selectedMenuId}
              className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {seedLoading ? 'Seeding...' : 'Seed menu'}
            </button>
            <button
              onClick={() => void handleSeed('categories')}
              disabled={seedLoading || !selectedMenuId}
              className="border border-zinc-200 text-zinc-700 bg-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              Seed categories
            </button>
            <button
              onClick={() => void handleSeed('products')}
              disabled={seedLoading || !selectedMenuId}
              className="border border-zinc-200 text-zinc-700 bg-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              Seed products
            </button>
            <button
              onClick={() => void handleSeed('copy')}
              disabled={seedLoading || !selectedMenuId}
              className="border border-zinc-200 text-zinc-700 bg-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
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
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => void handleSeedSingle('single_category')}
                disabled={!!perItemLoading || seedLoading}
                className="border border-zinc-200 text-zinc-700 bg-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
              >
                {perItemLoading === 'cat' ? 'Seeding...' : 'Seed category'}
              </button>
            </div>

            {/* Seed product row | requires category selection */}
            <div className="flex items-center gap-2">
              <select
                value={selectedCategoryId}
                onChange={e => setSelectedCategoryId(e.target.value)}
                disabled={!!perItemLoading || seedLoading}
                className="px-3 py-1 border border-zinc-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
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
                className="border border-zinc-200 text-zinc-700 bg-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
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
                className="border border-zinc-200 text-zinc-700 bg-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
              >
                {imageSeedLoading === 'image_cover' ? 'Generating cover...' : 'Seed cover'}
              </button>
              <button
                onClick={() => void handleSeedImage('image_products')}
                disabled={!!imageSeedLoading || seedLoading}
                className="border border-zinc-200 text-zinc-700 bg-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
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
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                disabled={!!imageSeedLoading || seedLoading || menuProducts.length === 0}
                className="px-3 py-1 border border-zinc-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
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
                className="border border-zinc-200 text-zinc-700 bg-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
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

            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                disabled={ocrLoading}
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setOcrFile(f)
                  setOcrStatus(null)
                }}
                className="text-xs text-zinc-600 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border file:border-zinc-200 file:text-xs file:font-medium file:bg-white file:text-zinc-700 hover:file:bg-zinc-50 disabled:opacity-50"
              />
              <button
                onClick={() => void handleOcrUpload()}
                disabled={ocrLoading || !ocrFile || !!imageSeedLoading || seedLoading}
                className="border border-zinc-200 text-zinc-700 bg-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
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
    </div>
  )
}
