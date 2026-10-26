'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TenantSettings } from '@/types/database'
import type { Tenant } from '@/types/database'
import type { StripeConnection } from '@/lib/stripe'
import { Store, Globe, Phone, Clock, ShoppingCart, Activity, CreditCard, CheckCircle2, AlertCircle, Save, Info, MapPin, Link2, XCircle, UtensilsCrossed, Percent, LayoutGrid, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import DeliveryZonesSection from './DeliveryZonesSection'
import TablesSection from './TablesSection'
import PlanHintCard from '@/components/admin/PlanHintCard'
import { lockedGroups, type PlanHintItem } from '@/components/admin/plan-hint'
import type { TenantCapabilities } from '@/lib/service-modes'
import type { ServiceNumberKey, ServiceSettingsPatch } from '@/lib/service-settings'

interface Props {
  settings: TenantSettings | null
  tenantId: string
  stripeConnection: StripeConnection | null
  tenant: Pick<Tenant, 'custom_domain' | 'custom_domain_verified'> | null
  tenantSlug?: string
  /** What the plan sells and what is switched on (getTenantCapabilities). */
  capabilities: TenantCapabilities
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

/** What the page would show on the richest plan, so one hint can list what the plan leaves out. */
const PLAN_HINT_ITEMS: PlanHintItem[] = [
  { need: 'orders', label: 'Tables & waiter app' },
  { need: 'orders', label: 'Item notes' },
  { need: 'orders', label: 'Kitchen display timers' },
  { need: 'payments', label: 'Guest ordering' },
  { need: 'payments', label: 'Order types & delivery' },
  { need: 'payments', label: 'Tips' },
  { need: 'stripe', label: 'Online payments' },
]

/** Names for the 403 `locked` list. */
const SERVICE_KEY_LABELS: Record<string, string> = {
  direct_orders_enabled: 'Guest ordering',
  table_management_enabled: 'Tables & waiter app',
  item_notes_enabled: 'Item notes',
  ingredient_customization_enabled: 'Ingredient customization',
  tips_enabled: 'Tips',
  dine_in_enabled: 'Dine-in',
  pickup_enabled: 'Pick-up',
  delivery_enabled: 'Delivery',
  delivery_fee_cents: 'Delivery fee',
  pickup_eta_minutes: 'Pick-up time',
  upsell_enabled: 'Order suggestions',
  amber_threshold_minutes: 'Kitchen display timers',
  red_threshold_minutes: 'Kitchen display timers',
}

type ServiceFlags = {
  orders_enabled: boolean
  whatsapp_orders_enabled: boolean
  direct_orders_enabled: boolean
  table_management_enabled: boolean
  item_notes_enabled: boolean
  ingredient_customization_enabled: boolean
  tips_enabled: boolean
  dine_in_enabled: boolean
  pickup_enabled: boolean
  delivery_enabled: boolean
  whatsapp: string
}
type ServiceNumbers = Record<ServiceNumberKey, number>
type ServiceState = ServiceFlags & ServiceNumbers

function readService(s: Partial<Record<keyof ServiceState, unknown>> | null | undefined): ServiceState {
  return {
    orders_enabled: s?.orders_enabled === true,
    whatsapp_orders_enabled: s?.whatsapp_orders_enabled === true,
    direct_orders_enabled: s?.direct_orders_enabled === true,
    table_management_enabled: s?.table_management_enabled === true,
    item_notes_enabled: s?.item_notes_enabled === true,
    ingredient_customization_enabled: s?.ingredient_customization_enabled === true,
    tips_enabled: s?.tips_enabled === true,
    dine_in_enabled: (s?.dine_in_enabled ?? true) === true,
    pickup_enabled: s?.pickup_enabled === true,
    delivery_enabled: s?.delivery_enabled === true,
    whatsapp: typeof s?.whatsapp === 'string' ? s.whatsapp : '',
    pickup_eta_minutes: typeof s?.pickup_eta_minutes === 'number' ? s.pickup_eta_minutes : 20,
    delivery_fee_cents: typeof s?.delivery_fee_cents === 'number' ? s.delivery_fee_cents : 0,
    amber_threshold_minutes: typeof s?.amber_threshold_minutes === 'number' ? s.amber_threshold_minutes : 10,
    red_threshold_minutes: typeof s?.red_threshold_minutes === 'number' ? s.red_threshold_minutes : 20,
  }
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div
      className="flex items-center justify-between gap-4 group p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
      onClick={() => onChange(!checked)}
    >
      <div className="max-w-[70%]">
        <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">{title}</p>
        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          checked ? "bg-primary" : "bg-zinc-200"
        )}
      >
        <span className={cn(
          "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
          checked ? "translate-x-5" : "translate-x-1"
        )} />
      </button>
    </div>
  )
}

export default function StoreClient({ settings, tenantId, tenantSlug, stripeConnection, tenant, capabilities }: Props) {
  const [caps, setCaps] = useState(capabilities)
  const hours = (settings?.business_hours ?? {}) as Record<string, string>

  // Regional, contact and tip presets: saved together by "Apply Settings".
  const [form, setForm] = useState({
    currency: settings?.currency ?? 'USD',
    language: settings?.language ?? 'en',
    address: settings?.address ?? '',
    phone: settings?.phone ?? '',
    city: settings?.city ?? '',
    region: settings?.region ?? '',
    postal_code: settings?.postal_code ?? '',
    country: settings?.country ?? '',
    latitude: settings?.latitude != null ? String(settings.latitude) : '',
    longitude: settings?.longitude != null ? String(settings.longitude) : '',
    price_range: settings?.price_range ?? '',
    tip_percentage_1: settings?.tip_percentage_1 ?? 15,
    tip_percentage_2: settings?.tip_percentage_2 ?? 18,
    tip_percentage_3: settings?.tip_percentage_3 ?? 20,
  })

  // Service switches: each change is saved at once through
  // PATCH /api/admin/service-settings (optimistic, reverted on failure).
  const initialService = readService(settings as Partial<Record<keyof ServiceState, unknown>> | null)
  const [service, setService] = useState<ServiceState>(initialService)
  const confirmed = useRef<ServiceState>(initialService)
  const [numbers, setNumbers] = useState<ServiceNumbers>({
    pickup_eta_minutes: initialService.pickup_eta_minutes,
    delivery_fee_cents: initialService.delivery_fee_cents,
    amber_threshold_minutes: initialService.amber_threshold_minutes,
    red_threshold_minutes: initialService.red_threshold_minutes,
  })
  const [whatsappDraft, setWhatsappDraft] = useState(initialService.whatsapp)
  const [serviceError, setServiceError] = useState<string | null>(null)

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

  const locked = lockedGroups(caps.plan, PLAN_HINT_ITEMS)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const status = params.get('stripe')
      if (status) setStripeStatus(status)
    }
  }, [])

  useEffect(() => {
    if (!serviceError) return
    const timer = setTimeout(() => setServiceError(null), 6000)
    return () => clearTimeout(timer)
  }, [serviceError])

  /** Saves a subset of the service switches; on failure puts the last saved values back. */
  async function saveService(patch: ServiceSettingsPatch): Promise<boolean> {
    setServiceError(null)
    setService(s => ({ ...s, ...patch, whatsapp: patch.whatsapp !== undefined ? patch.whatsapp ?? '' : s.whatsapp }))
    const keys = Object.keys(patch) as (keyof ServiceState)[]
    const revert = () => {
      const back = Object.fromEntries(keys.map(key => [key, confirmed.current[key]]))
      setService(s => ({ ...s, ...back }))
      setNumbers(n => ({ ...n, ...Object.fromEntries(keys.filter(key => key in n).map(key => [key, confirmed.current[key]])) }))
      if (keys.includes('whatsapp')) setWhatsappDraft(confirmed.current.whatsapp)
    }
    try {
      const res = await fetch('/api/admin/service-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; locked?: string[]; settings?: Record<string, unknown>; capabilities?: TenantCapabilities }
      if (!res.ok) {
        revert()
        if (res.status === 403 && Array.isArray(data.locked) && data.locked.length > 0) {
          const names = [...new Set(data.locked.map(key => SERVICE_KEY_LABELS[key] ?? key))]
          setServiceError(`Not included in your plan: ${names.join(', ')}.`)
        } else {
          setServiceError(data.error ?? 'Could not save this setting')
        }
        return false
      }
      const next = readService({ ...confirmed.current, ...(data.settings ?? {}) })
      confirmed.current = next
      const fromServer = Object.fromEntries(keys.map(key => [key, next[key]]))
      setService(s => ({ ...s, ...fromServer }))
      setNumbers(n => ({ ...n, ...Object.fromEntries(keys.filter(key => key in n).map(key => [key, next[key]])) }))
      if (keys.includes('whatsapp')) setWhatsappDraft(next.whatsapp)
      if (data.capabilities) setCaps(data.capabilities)
      return true
    } catch {
      revert()
      setServiceError('Could not save this setting. Check your connection and try again.')
      return false
    }
  }

  function commitWhatsapp() {
    if (whatsappDraft.trim() === confirmed.current.whatsapp) return
    void saveService({ whatsapp: whatsappDraft.trim() === '' ? null : whatsappDraft.trim() })
  }

  function commitNumber(key: 'pickup_eta_minutes' | 'delivery_fee_cents') {
    const value = numbers[key]
    if (value === confirmed.current[key]) return
    void saveService({ [key]: value })
  }

  function commitThresholds() {
    const { amber_threshold_minutes: amber, red_threshold_minutes: red } = numbers
    if (amber === confirmed.current.amber_threshold_minutes && red === confirmed.current.red_threshold_minutes) return
    if (!(amber > 0 && red > 0) || amber >= red) {
      setServiceError('The amber threshold must be lower than the red threshold, and both above zero.')
      setNumbers(n => ({
        ...n,
        amber_threshold_minutes: confirmed.current.amber_threshold_minutes,
        red_threshold_minutes: confirmed.current.red_threshold_minutes,
      }))
      return
    }
    void saveService({ amber_threshold_minutes: amber, red_threshold_minutes: red })
  }

  function toggleOrderType(key: 'dine_in_enabled' | 'pickup_enabled' | 'delivery_enabled') {
    const next = { dine_in_enabled: service.dine_in_enabled, pickup_enabled: service.pickup_enabled, delivery_enabled: service.delivery_enabled }
    next[key] = !next[key]
    if (!next.dine_in_enabled && !next.pickup_enabled && !next.delivery_enabled) {
      setServiceError('At least one order type must be active.')
      return
    }
    void saveService({ [key]: next[key] })
  }

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

    const filteredHours = Object.fromEntries(
      Object.entries(businessHours).filter(([, v]) => v.trim() !== '')
    )

    const parseCoord = (v: string) => {
      const t = v.trim()
      if (t === '') return null
      const n = Number(t)
      return Number.isFinite(n) ? n : null
    }

    // Tip presets only exist on the plan that sells guest ordering.
    const { tip_percentage_1, tip_percentage_2, tip_percentage_3, ...regionalAndContact } = form
    const tipPresets = caps.plan.payments ? { tip_percentage_1, tip_percentage_2, tip_percentage_3 } : {}

    const { error: err } = await supabase
      .from('tenant_settings')
      .upsert({
        tenant_id: tenantId,
        ...regionalAndContact,
        ...tipPresets,
        // Coerce local-SEO fields: empty strings → null, coordinates → number.
        city: form.city.trim() || null,
        region: form.region.trim() || null,
        postal_code: form.postal_code.trim() || null,
        country: form.country.trim() || null,
        price_range: form.price_range.trim() || null,
        latitude: parseCoord(form.latitude),
        longitude: parseCoord(form.longitude),
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
                <label className={labelClassName}>Street Address</label>
                <input
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. 123 Main St"
                  className={inputClassName}
                />
              </div>
              {/* SEED-014 local SEO: structured address powers Google "near me" + Maps */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClassName}>City</label>
                  <input
                    value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="New York"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className={labelClassName}>State / Region</label>
                  <input
                    value={form.region}
                    onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                    placeholder="NY"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className={labelClassName}>Postal Code</label>
                  <input
                    value={form.postal_code}
                    onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))}
                    placeholder="10001"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className={labelClassName}>Country</label>
                  <input
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="US"
                    className={inputClassName}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClassName}>Latitude</label>
                  <input
                    value={form.latitude}
                    onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                    inputMode="decimal"
                    placeholder="40.7128"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className={labelClassName}>Longitude</label>
                  <input
                    value={form.longitude}
                    onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                    inputMode="decimal"
                    placeholder="-74.0060"
                    className={inputClassName}
                  />
                </div>
              </div>
              <p className="text-[11px] text-zinc-400 -mt-3 ml-1">
                Coordinates power &ldquo;near me&rdquo; search and Google Maps. Tip: right-click your spot in Google Maps to copy lat/long.
              </p>
              <div>
                <label className={labelClassName}>Price Range</label>
                <div className="flex gap-2">
                  {['$', '$$', '$$$', '$$$$'].map(pr => (
                    <button
                      key={pr}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, price_range: f.price_range === pr ? '' : pr }))}
                      className={cn(
                        'px-5 py-2.5 rounded-xl text-sm font-black border transition-all',
                        form.price_range === pr
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:border-primary/40',
                      )}
                    >
                      {pr}
                    </button>
                  ))}
                </div>
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

          {/* How you take orders */}
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-4 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">How you take orders</h2>
            </div>

            <ToggleRow
              title="Accept orders"
              description="Master switch. Turn it off to pause every way of ordering at once."
              checked={service.orders_enabled}
              onChange={checked => saveService({ orders_enabled: checked })}
            />

            <ToggleRow
              title="WhatsApp orders"
              description="Guests send their cart to your WhatsApp number from the menu. Works on every plan."
              checked={service.whatsapp_orders_enabled}
              onChange={checked => saveService({ whatsapp_orders_enabled: checked })}
            />
            <div className="px-5 pb-2">
              <label className={labelClassName} htmlFor="whatsapp-number">WhatsApp number</label>
              <div className="relative">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <input
                  id="whatsapp-number"
                  type="tel"
                  inputMode="tel"
                  value={whatsappDraft}
                  onChange={e => setWhatsappDraft(e.target.value)}
                  onBlur={commitWhatsapp}
                  placeholder="e.g. 15550000000"
                  className={cn(inputClassName, 'pl-14')}
                />
              </div>
              <p className="mt-2 ml-1 text-[10px] font-medium text-zinc-400">
                Country code + area code + number, digits only.
                {service.whatsapp_orders_enabled && !service.whatsapp ? ' WhatsApp orders stay off until you add a number.' : ''}
              </p>
            </div>

            {caps.plan.payments && (
              <ToggleRow
                title="Guests order from the menu"
                description={caps.plan.stripe ? 'Guests build a cart and check out from the menu, and pay online when Stripe is connected.' : 'Guests build a cart and check out from the menu.'}
                checked={service.direct_orders_enabled}
                onChange={checked => saveService({ direct_orders_enabled: checked })}
              />
            )}

            {caps.plan.orders && (
              <>
                <ToggleRow
                  title="Tables & waiter app"
                  description="Staff take orders at the table on a phone or tablet. Orders reach the Orders screen with the table name."
                  checked={service.table_management_enabled}
                  onChange={checked => saveService({ table_management_enabled: checked })}
                />
                {service.table_management_enabled && tenantSlug && (
                  <a href={`/${tenantSlug}/waiter`} target="_blank" rel="noreferrer" className="inline-flex px-1 text-xs font-black uppercase tracking-widest text-primary hover:underline">
                    Open the waiter app
                  </a>
                )}
              </>
            )}
          </div>

          <PlanHintCard groups={locked} />

          {/* Operations — staff ordering (Menu + Orders and up) */}
          {caps.plan.orders && (
            <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="text-xl font-black text-zinc-950 tracking-tight">Operations</h2>
                </div>
                <div className="space-y-4">
                  <ToggleRow
                    title="Item Notes"
                    description="Allow special instructions on each item, in the waiter app and at guest checkout."
                    checked={service.item_notes_enabled}
                    onChange={checked => saveService({ item_notes_enabled: checked })}
                  />
                  <ToggleRow
                    title="Ingredient customization"
                    description="Let people add or remove ingredients on a dish. Set them up under Ingredients."
                    checked={service.ingredient_customization_enabled}
                    onChange={checked => saveService({ ingredient_customization_enabled: checked })}
                  />
                </div>
              </div>

              <div className="pt-8 border-t border-zinc-50">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-primary" />
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
                      value={numbers.amber_threshold_minutes}
                      onChange={e => setNumbers(n => ({ ...n, amber_threshold_minutes: Number(e.target.value) }))}
                      onBlur={commitThresholds}
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
                      value={numbers.red_threshold_minutes}
                      onChange={e => setNumbers(n => ({ ...n, red_threshold_minutes: Number(e.target.value) }))}
                      onBlur={commitThresholds}
                      className={cn(inputClassName, "font-black text-lg")}
                    />
                    <p className="text-[9px] font-bold text-red-400 uppercase tracking-widest ml-1">Critical State</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Order Types — guest ordering (Menu + Payments) */}
          {caps.plan.payments && (
            <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-4 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <UtensilsCrossed className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Order Types</h2>
              </div>

              <ToggleRow
                title="Dine-In"
                description="Customers can order for table service at your restaurant."
                checked={service.dine_in_enabled}
                onChange={() => toggleOrderType('dine_in_enabled')}
              />

              <ToggleRow
                title="Pick-Up"
                description="Customers can place orders for pick-up at your location."
                checked={service.pickup_enabled}
                onChange={() => toggleOrderType('pickup_enabled')}
              />

              {service.pickup_enabled && (
                <div className="space-y-2 mt-4 px-5 pb-2">
                  <label className={labelClassName}>Estimated Pick-Up Time (Min)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={numbers.pickup_eta_minutes}
                    onChange={e => setNumbers(n => ({ ...n, pickup_eta_minutes: Number(e.target.value) }))}
                    onBlur={() => commitNumber('pickup_eta_minutes')}
                    className={cn(inputClassName, "font-black text-lg")}
                  />
                  <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Minutes</p>
                </div>
              )}

              <ToggleRow
                title="Delivery"
                description="Customers can request home delivery of their orders."
                checked={service.delivery_enabled}
                onChange={() => toggleOrderType('delivery_enabled')}
              />

              {service.delivery_enabled && (
                <div className="space-y-2 mt-4 px-5 pb-2">
                  <label className={labelClassName}>Flat Delivery Fee (fallback)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={(numbers.delivery_fee_cents / 100).toFixed(2)}
                    onChange={e => setNumbers(n => ({ ...n, delivery_fee_cents: Math.round(Number(e.target.value) * 100) }))}
                    onBlur={() => commitNumber('delivery_fee_cents')}
                    className={cn(inputClassName, "font-black text-lg")}
                  />
                  <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Used when no delivery zone matches the customer&apos;s zipcode</p>
                </div>
              )}

              {service.delivery_enabled && (
                <div className="mt-6 px-5 pb-2">
                  <DeliveryZonesSection />
                </div>
              )}
            </div>
          )}

          {/* Tables — staff ordering (Menu + Orders and up) */}
          {caps.plan.orders && (
            <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-4 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <LayoutGrid className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Tables</h2>
              </div>
              <TablesSection tenantId={tenantId} tenantSlug={tenantSlug} tableLinksEnabled={caps.plan.payments} />
            </div>
          )}

          {/* Tips — guest ordering (Menu + Payments) */}
          {caps.plan.payments && (
            <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-4 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Percent className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Tips</h2>
              </div>

              <ToggleRow
                title="Enable Tips at Checkout"
                description="Customers can add a gratuity when placing an order. Tips go 100% to your restaurant."
                checked={service.tips_enabled}
                onChange={checked => saveService({ tips_enabled: checked })}
              />

              {service.tips_enabled && (
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
                  <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Presets are saved with Apply Settings. A &quot;Custom&quot; option is always available to customers</p>
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
                    className="px-5 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-black uppercase tracking-widest hover:bg-white transition-all disabled:opacity-50 shrink-0"
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

          {/* Stripe Connect — Menu + Payments */}
          {caps.plan.stripe && (
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
          )}

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
                "flex-1 sm:flex-none bg-primary text-primary-foreground px-12 py-5 rounded-full text-lg font-black transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg shadow-primary/20",
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
      {serviceError && (
        <div role="alert" className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-[1rem] border border-red-100 bg-white px-5 py-4 text-sm font-bold text-red-600 shadow-xl">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <span className="min-w-0 flex-1">{serviceError}</span>
          <button type="button" onClick={() => setServiceError(null)} aria-label="Dismiss" className="-m-1 rounded-full p-1 hover:bg-red-50">✕</button>
        </div>
      )}
    </div>
  )
}
