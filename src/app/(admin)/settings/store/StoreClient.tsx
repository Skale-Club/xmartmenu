'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TenantSettings } from '@/types/database'

interface Props {
  settings: TenantSettings | null
  tenantId: string
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

export default function StoreClient({ settings, tenantId }: Props) {
  const hours = (settings?.business_hours ?? {}) as Record<string, string>

  const [form, setForm] = useState({
    currency: settings?.currency ?? 'USD',
    language: settings?.language ?? 'en',
    address: settings?.address ?? '',
    phone: settings?.phone ?? '',
    item_notes_enabled: settings?.item_notes_enabled ?? false,  // NOTE-01
    amber_threshold_minutes: settings?.amber_threshold_minutes ?? 10,  // KDS-07
    red_threshold_minutes: settings?.red_threshold_minutes ?? 20,      // KDS-07
  })
  const [businessHours, setBusinessHours] = useState<Record<string, string>>(
    Object.fromEntries(DAYS.map(d => [d.key, hours[d.key] ?? '']))
  )
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'
  const label = 'block text-sm font-medium text-zinc-700 mb-1'
  const section = 'bg-white border border-zinc-200 rounded-xl p-5 space-y-4'

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">Store Settings</h1>
      <p className="text-sm text-zinc-500 mb-6">Regional preferences, contact info and opening hours</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-center justify-between">
          {error}<button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">

        {/* Regional */}
        <div className={section}>
          <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">Regional</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className={input}
              >
                {CURRENCIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Language</label>
              <select
                value={form.language}
                onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                className={input}
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className={section}>
          <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">Contact</h2>
          <div>
            <label className={label}>Address</label>
            <input
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="123 Main St, New York, NY"
              className={input}
            />
          </div>
          <div>
            <label className={label}>Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000"
              className={input}
            />
          </div>
        </div>

        {/* Business Hours */}
        <div className={section}>
          <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">Business Hours</h2>
          <p className="text-xs text-zinc-400">Leave blank for closed. Example: 09:00 - 22:00</p>
          <div className="space-y-2">
            {DAYS.map(day => (
              <div key={day.key} className="flex items-center gap-4">
                <span className="text-sm text-zinc-600 w-24 flex-shrink-0">{day.label}</span>
                <input
                  value={businessHours[day.key] ?? ''}
                  onChange={e => setBusinessHours(h => ({ ...h, [day.key]: e.target.value }))}
                  placeholder="Closed"
                  className="flex-1 px-3 py-1.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Ordering */}
        <div className={section}>
          <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">Ordering</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-700">Item notes</p>
              <p className="text-xs text-zinc-400 mt-0.5">Allow customers to add a note to each order item</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, item_notes_enabled: !f.item_notes_enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${form.item_notes_enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}
              aria-label="Enable item notes"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.item_notes_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* KDS time alerts */}
        <div className={section}>
          <h2 className="text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100">KDS | Time alerts</h2>
          <p className="text-xs text-zinc-400 mb-2">Wait time before changing the card color on the kitchen display</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Amber threshold (min)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={form.amber_threshold_minutes}
                onChange={e => setForm(f => ({ ...f, amber_threshold_minutes: Number(e.target.value) }))}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Red threshold (min)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={form.red_threshold_minutes}
                onChange={e => setForm(f => ({ ...f, red_threshold_minutes: Number(e.target.value) }))}
                className={input}
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
        </button>
      </form>
    </div>
  )
}
