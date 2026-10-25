'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Save, Sparkles } from 'lucide-react'
import OpenRouterKeyField from '@/components/ai/OpenRouterKeyField'
import type { AiBillingMode } from '@/lib/ai/billing-rules'
import { BILLING_MODE_HELP, BILLING_MODE_LABELS, BILLING_MODES, formatBrl, formatUsd, type UsageMonth } from '@/lib/ai/labels'

interface TenantRow {
  id: string
  name: string
  slug: string
  billing_mode: AiBillingMode | null
  effective_mode: AiBillingMode
  has_key: boolean
  markup_pct: number | null
  last_key_error: string | null
  last_key_error_at: string | null
  month: UsageMonth | null
}

interface Payload {
  settings: {
    openrouter_api_key: string
    key_source: 'panel' | 'env' | 'none'
    default_billing_mode: AiBillingMode
    default_markup_pct: number
    usd_to_brl: number
  }
  platform_usage: UsageMonth | null
  tenants: TenantRow[]
}

const KEY_SOURCE: Record<Payload['settings']['key_source'], { label: string; tone: string }> = {
  panel: { label: 'Set in this panel', tone: 'bg-green-50 text-green-700' },
  env: { label: 'From the OPENROUTER_API_KEY env var', tone: 'bg-amber-50 text-amber-700' },
  none: { label: 'Not configured', tone: 'bg-red-50 text-red-700' },
}

const SETTINGS_URL = '/api/superadmin/ai/settings'

export default function AiBillingClient() {
  const [data, setData] = useState<Payload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [mode, setMode] = useState<AiBillingMode>('platform')
  const [markup, setMarkup] = useState('30')
  const [rate, setRate] = useState('5.50')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function apply(next: Payload) {
    setData(next)
    setKey(next.settings.openrouter_api_key)
    setMode(next.settings.default_billing_mode)
    setMarkup(String(next.settings.default_markup_pct))
    setRate(String(next.settings.usd_to_brl))
  }

  useEffect(() => {
    fetch(SETTINGS_URL)
      .then(async res => (res.ok ? apply((await res.json()) as Payload) : setLoadError(`Could not load (${res.status})`)))
      .catch(() => setLoadError('Could not load'))
  }, [])

  async function save(body: Record<string, unknown>) {
    setSaving(true)
    setMessage(null)
    const res = await fetch(SETTINGS_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setMessage({ ok: false, text: json.error ?? 'Could not save' })
    apply(json as Payload)
    setMessage({ ok: true, text: 'Saved' })
  }

  const input = 'min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50'
  const card = 'rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5'
  const usdToBrl = data?.settings.usd_to_brl ?? 5.5

  return (
    <div className="w-full px-4 py-5 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <header>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-400"><Sparkles className="size-4" />Super admin</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">AI & billing</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Every AI call (chat, voice, translation, blog, seeding) goes through OpenRouter. The global key below is the default for every client and the fallback when a client&apos;s own key fails. Billable usage is charged at real cost plus margin on the client&apos;s monthly plan invoice.
          </p>
        </header>

        {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>}
        {!data && !loadError && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" />Loading…</p>}

        {data && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className={card}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><KeyRound className="size-4" /></span>
                    <div>
                      <h2 className="text-sm font-bold text-zinc-950">Global OpenRouter key</h2>
                      <p className="text-xs text-zinc-500">Default for all clients and fallback.</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${KEY_SOURCE[data.settings.key_source].tone}`}>{KEY_SOURCE[data.settings.key_source].label}</span>
                </div>
                <OpenRouterKeyField
                  value={key}
                  stored={data.settings.openrouter_api_key}
                  onChange={setKey}
                  testUrl={SETTINGS_URL}
                  onRemove={() => void save({ openrouter_api_key: null })}
                  help={data.settings.key_source === 'env' ? 'Saving a key here replaces the environment variable.' : 'Create one at openrouter.ai/keys. Keep credit on it: every client without its own key uses it.'}
                />
                <button
                  type="button"
                  onClick={() => void save({ openrouter_api_key: key })}
                  disabled={saving || key === data.settings.openrouter_api_key}
                  className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
                >
                  <Save className="size-4" />Save key
                </button>
              </section>

              <section className={card}>
                <h2 className="text-sm font-bold text-zinc-950">Defaults for clients</h2>
                <p className="mb-4 text-xs text-zinc-500">Used by every client that has no setting of its own.</p>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="ai-default-mode" className="mb-1.5 block text-xs font-bold text-zinc-600">Billing mode</label>
                    <select id="ai-default-mode" value={mode} onChange={e => setMode(e.target.value as AiBillingMode)} className={input}>
                      {BILLING_MODES.map(m => <option key={m} value={m}>{BILLING_MODE_LABELS[m]}</option>)}
                    </select>
                    <p className="mt-1.5 text-xs text-zinc-500">{BILLING_MODE_HELP[mode]}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="ai-default-markup" className="mb-1.5 block text-xs font-bold text-zinc-600">Margin over cost (%)</label>
                      <input id="ai-default-markup" type="number" min={0} max={1000} step={1} value={markup} onChange={e => setMarkup(e.target.value)} className={input} />
                    </div>
                    <div>
                      <label htmlFor="ai-usd-brl" className="mb-1.5 block text-xs font-bold text-zinc-600">USD → BRL rate</label>
                      <input id="ai-usd-brl" type="number" min={0.01} step={0.01} value={rate} onChange={e => setRate(e.target.value)} className={input} />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">Example: US$ 1.00 of OpenRouter cost is billed as {formatBrl(1 + (Number(markup) || 0) / 100, Number(rate) || 0)}.</p>
                  <button
                    type="button"
                    onClick={() => void save({ default_billing_mode: mode, default_markup_pct: Number(markup), usd_to_brl: Number(rate) })}
                    disabled={saving}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
                  >
                    <Save className="size-4" />Save defaults
                  </button>
                </div>
              </section>
            </div>

            {message && (
              <p role="status" className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${message.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {message.ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}{message.text}
              </p>
            )}

            <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-100 p-4 sm:p-5">
                <div>
                  <h2 className="text-sm font-bold text-zinc-950">Clients this month</h2>
                  <p className="text-xs text-zinc-500">Open a client to change its mode, key or margin, or to bill its usage now.</p>
                </div>
                {data.platform_usage && (
                  <p className="text-xs text-zinc-500">Platform&apos;s own usage (no client): {data.platform_usage.calls} calls · {formatUsd(data.platform_usage.costUsd)}</p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-zinc-50 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-4 py-2.5">Client</th>
                      <th className="px-4 py-2.5">Mode</th>
                      <th className="px-4 py-2.5">Margin</th>
                      <th className="px-4 py-2.5 text-right">Calls</th>
                      <th className="px-4 py-2.5 text-right">Cost</th>
                      <th className="px-4 py-2.5 text-right">Charge</th>
                      <th className="px-4 py-2.5 text-right">Not yet billed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.tenants.map(t => (
                      <tr key={t.id} className="hover:bg-zinc-50">
                        <td className="px-4 py-2.5">
                          <Link href={`/tenants/${t.id}`} className="font-semibold text-zinc-900 hover:text-indigo-600">{t.name}</Link>
                          <span className="block text-xs text-zinc-400">/{t.slug}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-zinc-700">{BILLING_MODE_LABELS[t.effective_mode]}</span>
                          {!t.billing_mode && <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500">default</span>}
                          {t.effective_mode === 'own_key' && !t.has_key && <span className="block text-xs font-semibold text-amber-600">No key saved: using the platform key</span>}
                          {t.last_key_error && <span className="block text-xs font-semibold text-red-600" title={t.last_key_error}>Key failing since {new Date(t.last_key_error_at ?? '').toLocaleDateString()}</span>}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-zinc-700">{t.markup_pct ?? data.settings.default_markup_pct}%{t.markup_pct == null && <span className="text-zinc-400"> (default)</span>}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{t.month?.calls ?? 0}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatUsd(t.month?.costUsd)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatUsd(t.month?.chargeUsd)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatUsd(t.month?.unbilledChargeUsd)}
                          <span className="block text-xs text-zinc-400">{formatBrl(t.month?.unbilledChargeUsd, usdToBrl)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
