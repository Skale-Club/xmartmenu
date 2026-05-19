'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TenantSettings } from '@/types/database'
import type { Tenant } from '@/types/database'
import type { StripeConnection } from '@/lib/stripe'
import { Store, Globe, Phone, Clock, ShoppingCart, Activity, CreditCard, CheckCircle2, AlertCircle, Save, Info, MapPin, Link2, XCircle, UtensilsCrossed, Percent } from 'lucide-react'
import { cn } from '@/lib/utils'
import DeliveryZonesSection from './DeliveryZonesSection'

interface Props {
  settings: TenantSettings | null
  tenantId: string
  stripeConnection: StripeConnection | null
  tenant: Pick<Tenant, 'custom_domain' | 'custom_domain_verified'> | null
  isPaymentsPlan?: boolean
}

const CURRENCIES = [
  { value: 'USD', label: 'USD | US Dollar ($)' },
  { value: 'BRL', label: 'BRL | Brazilian Real (R$)' },
  { value: 'EUR', label: 'EUR | Euro (€)' },
  { value: 'GBP', label: 'GBP | British Pound (£)' },
  { value: 'CAD', label: 'CAD | Canadian Dollar (CA$)' },
  { value: 'AUD', label: 'AUD | Australian Dollar (A$)' },
  { value: 'MXN', label: 'MXN | Mexican Peso (MX$)' },
  { value: 'ARS', label: 'ARS | Argentine Peso ($)' },
  { value: 'CLP', label: 'CLP | Chilean Peso ($)' },
  { value: 'COP', label: 'COP | Colombian Peso ($)' },
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
]

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

export default function StoreClient({ settings, tenantId, stripeConnection, tenant, isPaymentsPlan = false }: Props) {
  const hours = (settings?.business_hours ?? {}) as Record<string, string>

  const [form, setForm] = useState({
    currency: settings?.currency ?? 'USD',
    language: settings?.language ?? 'en',
    address: settings?.address ?? '',
    phone: settings?.phone ?? '',
    item_notes_enabled: settings?.item_notes_enabled ?? false,
    amber_threshold_minutes: settings?.amber_threshold_minutes ?? 10,
    red_threshold_minutes: settings?.red_threshold_minutes ?? 20,
    dine_in_enabled: settings?.dine_in_enabled ?? true,
    pickup_enabled: settings?.pickup_enabled ?? false,
    delivery_enabled: settings?.delivery_enabled ?? false,
    pickup_eta_minutes: settings?.pickup_eta_minutes ?? 20,
    delivery_fee_cents: settings?.delivery_fee_cents ?? 0,
    tips_enabled: settings?.tips_enabled ?? false,
    tip_percentage_1: settings?.tip_percentage_1 ?? 15,
    tip_percentage_2: settings?.tip_percentage_2 ?? 18,
    tip_percentage_3: settings?.tip_percentage_3 ?? 20,
  })
  const [businessHours, setBusinessHours] = useState<Record<string, string>>(
    Object.fromEntries(DAYS.map(d => [d.key, hours[d.key] ?? '']))
  )
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [stripeStatus, setStripeStatus] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const [customDomain, setCustomDomain] = useState(tenant?.custom_domain ?? '')
  const [domainVerified, setDomainVerified] = useState(tenant?.custom_domain_verified ?? false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; reason?: string } | null>(null)
  const [savingDomain, setSavingDomain] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const status = params.get('stripe')
      if (status) setStripeStatus(status)
    }
  }, [])

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect your Stripe account?')) return
    setDisconnecting(true)
    const res = await fetch('/api/stripe/connect/disconnect', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      window.location.reload()
    } else {
      setDisconnecting(false)
      alert('Failed to disconnect: ' + (data.error || 'Unknown error'))
    }
  }

  async function handleSaveDomain() {
    if (!customDomain.trim()) return
    setSavingDomain(true)
    const res = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: customDomain }),
    })
    const data = await res.json()
    if (data.tenant) {
      setDomainVerified(data.tenant.custom_domain_verified)
      setVerifyResult(null)
    } else {
      setError(data.error || 'Failed to save domain')
    }
    setSavingDomain(false)
  }

  async function handleVerifyDomain() {
    if (!customDomain.trim()) return
    setVerifying(true)
    setVerifyResult(null)
    const res = await fetch(`/api/admin/tenants/${tenantId}/verify-domain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: customDomain }),
    })
    const data = await res.json()
    setVerifyResult({ verified: data.verified, reason: data.reason })
    setVerifying(false)
  }

  const stripeStatusMessages: Record<string, { type: 'success' | 'error' | 'info'; message: string }> = {
    connected: { type: 'success', message: 'Stripe account connected successfully!' },
    access_denied: { type: 'error', message: 'Stripe authorization was denied.' },
    missing_code: { type: 'error', message: 'Authorization code missing from Stripe response.' },
    invalid_state: { type: 'error', message: 'Invalid or expired authorization request.' },
    exchange_failed: { type: 'error', message: 'Failed to exchange authorization code with Stripe.' },
    db_error: { type: 'error', message: 'Database error while saving Stripe connection.' },
    already_connected: { type: 'info', message: 'You already have a Stripe account connected.' },
    feature_not_available: { type: 'error', message: 'Stripe Connect requires the Menu + Payments plan.' },
  }

  const supabase = createClient()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (form.amber_threshold_minutes <= 0 || form.red_threshold_minutes <= 0) {
      setError('Thresholds must be greater than zero')
      setLoading(false)
      return
    }
    if (form.amber_threshold_minutes >= form.red_threshold_minutes) {
      setError('The amber threshold must be lower than the red threshold')
      setLoading(false)
      return
    }
    if (!form.dine_in_enabled && !form.pickup_enabled && !form.delivery_enabled) {
      setError('At least one order type must be active.')
      setLoading(false)
      return
    }

    const filteredHours = Object.fromEntries(
      Object.entries(businessHours).filter(([, v]) => v.trim() !== '')
    )

    const { error: err } = await supabase
      .from('tenant_settings')
      .upsert({
        tenant_id: tenantId,
        ...form,
        business_hours: Object.keys(filteredHours).length > 0 ? filteredHours : null,
      }, { onConflict: 'tenant_id' })

    if (err) setError(err.message)
    else { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    setLoading(false)
  }

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  const labelClassName = "block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1"

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Administration</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Store Settings</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Configure regional preferences, logistics, and operations</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-red-600 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="p-2 hover:bg-red-100 rounded-full transition-colors">✕</button>
        </div>
      )}

      {stripeStatus && stripeStatusMessages[stripeStatus] && (
        <div className={cn(
          "rounded-[1rem] px-8 py-4 text-sm font-bold flex items-center justify-between shadow-sm border",
          stripeStatusMessages[stripeStatus].type === 'success' ? 'bg-green-50 border-green-100 text-green-700' :
          stripeStatusMessages[stripeStatus].type === 'error' ? 'bg-red-50 border-red-100 text-red-700' :
          'bg-blue-50 border-blue-100 text-blue-700'
        )}>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5" />
            {stripeStatusMessages[stripeStatus].message}
          </div>
          <button onClick={() => setStripeStatus(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors">✕</button>
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="space-y-10">
          {/* Regional */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Regional</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClassName}>Currency</label>
                <select
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  className={inputClassName}
                >
                  {CURRENCIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClassName}>Language</label>
                <select
                  value={form.language}
                  onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                  className={inputClassName}
                >
                  {LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Contact Information</h2>
            </div>
            <div className="space-y-6">
              <div>
                <label className={labelClassName}>Physical Address</label>
                <input
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. 123 Main St, New York, NY"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={labelClassName}>Contact Phone</label>
                <div className="relative">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <Phone className="w-5 h-5" />
                  </div>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+1 (555) 000-0000"
                    className={cn(inputClassName, "pl-14")}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Ordering & KDS */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Operations</h2>
              </div>
              <div 
                className="flex items-center justify-between group p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
                onClick={() => setForm(f => ({ ...f, item_notes_enabled: !f.item_notes_enabled }))}
              >
                <div className="max-w-[70%]">
                  <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">Item Notes</p>
                  <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Allow customers to add special instructions to each item.</p>
                </div>
                <button
                  type="button"
                  className={cn(
                    "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
                    form.item_notes_enabled ? "bg-primary" : "bg-zinc-200"
                  )}
                >
                  <span className={cn(
                    "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                    form.item_notes_enabled ? "translate-x-5" : "translate-x-1"
                  )} />
                </button>
              </div>
            </div>

            <div className="pt-8 border-t border-zinc-50">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">KDS Time Thresholds</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className={labelClassName}>Amber Alert (Min)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={form.amber_threshold_minutes}
                    onChange={e => setForm(f => ({ ...f, amber_threshold_minutes: Number(e.target.value) }))}
                    className={cn(inputClassName, "font-black text-lg")}
                  />
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest ml-1">Warning State</p>
                </div>
                <div className="space-y-2">
                  <label className={labelClassName}>Red Alert (Min)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={form.red_threshold_minutes}
                    onChange={e => setForm(f => ({ ...f, red_threshold_minutes: Number(e.target.value) }))}
                    className={cn(inputClassName, "font-black text-lg")}
                  />
                  <p className="text-[9px] font-bold text-red-400 uppercase tracking-widest ml-1">Critical State</p>
                </div>
              </div>
            </div>
          </div>

          {/* Order Types */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-4 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <UtensilsCrossed className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Order Types</h2>
            </div>

            {/* Dine-In toggle */}
            <div
              className="flex items-center justify-between group p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
              onClick={() => setForm(f => ({ ...f, dine_in_enabled: !f.dine_in_enabled }))}
            >
              <div className="max-w-[70%]">
                <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">Dine-In</p>
                <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Customers can order for table service at your restaurant.</p>
              </div>
              <button
                type="button"
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
                  form.dine_in_enabled ? "bg-primary" : "bg-zinc-200"
                )}
              >
                <span className={cn(
                  "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                  form.dine_in_enabled ? "translate-x-5" : "translate-x-1"
                )} />
              </button>
            </div>

            {/* Pick-Up toggle */}
            <div
              className="flex items-center justify-between group p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
              onClick={() => setForm(f => ({ ...f, pickup_enabled: !f.pickup_enabled }))}
            >
              <div className="max-w-[70%]">
                <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">Pick-Up</p>
                <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Customers can place orders for pick-up at your location.</p>
              </div>
              <button
                type="button"
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
                  form.pickup_enabled ? "bg-primary" : "bg-zinc-200"
                )}
              >
                <span className={cn(
                  "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                  form.pickup_enabled ? "translate-x-5" : "translate-x-1"
                )} />
              </button>
            </div>

            {/* Pick-up ETA field — shown only when pickup_enabled */}
            {form.pickup_enabled && (
              <div className="space-y-2 mt-4 px-5 pb-2">
                <label className={labelClassName}>Estimated Pick-Up Time (Min)</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={form.pickup_eta_minutes}
                  onChange={e => setForm(f => ({ ...f, pickup_eta_minutes: Number(e.target.value) }))}
                  className={cn(inputClassName, "font-black text-lg")}
                />
                <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Minutes</p>
              </div>
            )}

            {/* Delivery toggle */}
            <div
              className="flex items-center justify-between group p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
              onClick={() => setForm(f => ({ ...f, delivery_enabled: !f.delivery_enabled }))}
            >
              <div className="max-w-[70%]">
                <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">Delivery</p>
                <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Customers can request home delivery of their orders.</p>
              </div>
              <button
                type="button"
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
                  form.delivery_enabled ? "bg-primary" : "bg-zinc-200"
                )}
              >
                <span className={cn(
                  "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                  form.delivery_enabled ? "translate-x-5" : "translate-x-1"
                )} />
              </button>
            </div>

            {/* Delivery fee field — shown only when delivery_enabled */}
            {form.delivery_enabled && (
              <div className="space-y-2 mt-4 px-5 pb-2">
                <label className={labelClassName}>Flat Delivery Fee (fallback)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={(form.delivery_fee_cents / 100).toFixed(2)}
                  onChange={e => setForm(f => ({ ...f, delivery_fee_cents: Math.round(Number(e.target.value) * 100) }))}
                  className={cn(inputClassName, "font-black text-lg")}
                />
                <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Used when no delivery zone matches the customer's zipcode</p>
              </div>
            )}

            {/* Delivery Zones — shown only when delivery_enabled */}
            {form.delivery_enabled && (
              <div className="mt-6 px-5 pb-2">
                <DeliveryZonesSection />
              </div>
            )}
          </div>

          {/* Tips — payments plan only */}
          {isPaymentsPlan && (
            <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-4 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Percent className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Tips</h2>
              </div>

              <div
                className="flex items-center justify-between group p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
                onClick={() => setForm(f => ({ ...f, tips_enabled: !f.tips_enabled }))}
              >
                <div className="max-w-[70%]">
                  <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">Enable Tips at Checkout</p>
                  <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Customers can add a gratuity when placing an order. Tips go 100% to your restaurant.</p>
                </div>
                <button
                  type="button"
                  className={cn(
                    "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
                    form.tips_enabled ? "bg-primary" : "bg-zinc-200"
                  )}
                >
                  <span className={cn(
                    "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                    form.tips_enabled ? "translate-x-5" : "translate-x-1"
                  )} />
                </button>
              </div>

              {form.tips_enabled && (
                <div className="space-y-2 mt-4 px-5 pb-2">
                  <label className={labelClassName}>Tip Presets (%)</label>
                  <div className="grid grid-cols-3 gap-4">
                    {(['tip_percentage_1', 'tip_percentage_2', 'tip_percentage_3'] as const).map((key, i) => (
                      <div key={key} className="space-y-1">
                        <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Option {i + 1}</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={form[key]}
                          onChange={e => setForm(f => ({ ...f, [key]: Math.min(100, Math.max(1, Number(e.target.value))) }))}
                          className={cn(inputClassName, "font-black text-lg")}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">A "Custom" option is always available to customers</p>
                </div>
              )}
            </div>
          )}

          {/* Custom Domain */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Link2 className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Custom Domain</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelClassName}>Your domain</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customDomain}
                    onChange={e => setCustomDomain(e.target.value)}
                    placeholder="yourdomain.com"
                    className={inputClassName}
                  />
                  <button
                    type="button"
                    onClick={handleSaveDomain}
                    disabled={savingDomain || !customDomain.trim()}
                    className="px-5 py-3 bg-primary text-zinc-950 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-white transition-all disabled:opacity-50 shrink-0"
                  >
                    {savingDomain ? '...' : 'Save Domain'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">No https:// — e.g. yourdomain.com</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleVerifyDomain}
                  disabled={verifying || !customDomain.trim()}
                  className="px-4 py-2 border border-zinc-200 text-zinc-600 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-zinc-50 transition-all disabled:opacity-50"
                >
                  {verifying ? 'Verifying...' : 'Verify DNS'}
                </button>
                {domainVerified ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-green-600">
                    <CheckCircle2 className="w-4 h-4" /> Active
                  </span>
                ) : customDomain && verifyResult ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-red-500">
                    <XCircle className="w-4 h-4" /> Not verified
                  </span>
                ) : null}
              </div>

              {verifyResult && (
                <div className={cn(
                  "p-4 rounded-xl text-sm font-bold",
                  verifyResult.verified
                    ? "bg-green-50 border border-green-100 text-green-700"
                    : "bg-red-50 border border-red-100 text-red-700"
                )}>
                  {verifyResult.verified
                    ? 'Domain verified! Your site is live at ' + customDomain
                    : `Verification failed: ${verifyResult.reason ?? 'check your DNS settings'}`}
                </div>
              )}

              {customDomain && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                  <h4 className="font-semibold text-blue-900 text-sm">Configure DNS</h4>
                  <p className="text-xs text-blue-700">In your domain registrar's panel, create a CNAME record:</p>
                  <div className="bg-blue-100 rounded p-3 font-mono text-xs space-y-1">
                    <div><span className="font-semibold text-blue-800">Type:</span> CNAME</div>
                    <div><span className="font-semibold text-blue-800">Host:</span> @ (ou vazio)</div>
                    <div><span className="font-semibold text-blue-800">Target:</span> xmartmenu.skale.club</div>
                  </div>
                  <p className="text-xs text-blue-600">DNS propagation may take up to 24 hours.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-10">
          {/* Business Hours */}
          <div className="bg-zinc-950 rounded-[1.5rem] p-10 space-y-8 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -mr-32 -mt-32 transition-opacity group-hover:opacity-100 opacity-50" />
            <div className="relative z-10 flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <Clock className="w-4 h-4 text-zinc-950" />
              </div>
              <h2 className="text-xl font-black text-white tracking-tight">Business Hours</h2>
            </div>
            <div className="relative z-10 space-y-3">
              {DAYS.map(day => (
                <div key={day.key} className="flex items-center gap-4 bg-white/5 border border-white/10 p-4 rounded-xl group/day hover:bg-white/10 transition-all">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 w-24 shrink-0 group-hover/day:text-primary transition-colors">{day.label}</span>
                  <input
                    value={businessHours[day.key] ?? ''}
                    onChange={e => setBusinessHours(h => ({ ...h, [day.key]: e.target.value }))}
                    placeholder="Closed"
                    className="flex-1 bg-transparent border-none text-white font-bold text-sm focus:ring-0 placeholder:text-zinc-700 placeholder:italic"
                  />
                </div>
              ))}
            </div>
            <p className="relative z-10 text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2 px-1">
              <Info className="w-3 h-3" />
              Example format: 09:00 - 22:00
            </p>
          </div>

          {/* Stripe Connect */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Payments Pipeline</h2>
            </div>

            {stripeConnection ? (
              <div className="bg-zinc-50 rounded-xl p-6 border border-zinc-100 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-black text-zinc-950 uppercase tracking-tight">System Online</span>
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Linked: {new Date(stripeConnection.connected_at).toLocaleDateString()}</span>
                </div>
                <div className="bg-white p-4 rounded-xl border border-zinc-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Stripe Account ID</p>
                  <p className="text-sm font-mono font-bold text-zinc-950">{stripeConnection.stripe_account_id}</p>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="w-full py-4 border-2 border-red-50 text-red-500 rounded-full text-xs font-black uppercase tracking-widest hover:bg-red-50 transition-all disabled:opacity-50"
                >
                  {disconnecting ? 'Terminating...' : 'Disconnect Pipeline'}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-zinc-50 rounded-xl p-8 text-center border-2 border-dashed border-zinc-200">
                  <p className="text-sm font-bold text-zinc-500 mb-1">Accept online payments directly</p>
                  <p className="text-[10px] text-zinc-400 font-medium">Link your business with Stripe for automated payouts.</p>
                </div>
                <a
                  href="/api/stripe/connect/oauth"
                  className="flex items-center justify-center gap-3 w-full py-5 bg-[#635BFF] text-white rounded-full text-sm font-black uppercase tracking-widest hover:bg-[#5552E5] transition-all shadow-xl shadow-indigo-500/20"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.217 22.842 8.315 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                  </svg>
                  Sync with Stripe
                </a>
              </div>
            )}
          </div>

          {/* Deploy Action */}
          <div className="bg-zinc-950 rounded-[1.25rem] p-8 shadow-2xl flex items-center justify-between gap-6 border border-white/5">
            <div className="hidden sm:block">
              <p className="text-white font-black tracking-tight text-lg">System Audit</p>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Configuration integrity verified.</p>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className={cn(
                "flex-1 sm:flex-none bg-primary text-zinc-950 px-12 py-5 rounded-full text-lg font-black transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg shadow-primary/20",
                saved ? "bg-green-500 text-white" : "hover:bg-white"
              )}
            >
              {loading ? 'Processing...' : saved ? (
                <>
                  <CheckCircle2 className="w-6 h-6" />
                  Synced
                </>
              ) : (
                <>
                  <Save className="w-6 h-6" />
                  Apply Settings
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
