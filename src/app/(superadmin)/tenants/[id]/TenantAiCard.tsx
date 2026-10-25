'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Loader2, Receipt, Save, Sparkles } from 'lucide-react'
import OpenRouterKeyField from '@/components/ai/OpenRouterKeyField'
import type { AiBillingMode } from '@/lib/ai/billing-rules'
import { BILLING_MODE_HELP, BILLING_MODE_LABELS, BILLING_MODES, formatBrl, formatUsd, type UsageMonth } from '@/lib/ai/labels'

interface Payload {
  billing_mode: AiBillingMode | null
  effective_mode: AiBillingMode
  openrouter_api_key: string
  markup_pct: number | null
  effective_markup_pct: number
  last_key_error: string | null
  last_key_error_at: string | null
  global_key_configured: boolean
  usd_to_brl: number
  month: UsageMonth | null
  unbilled_charge_usd: number
  can_bill: boolean
}

interface BillResult {
  billed?: boolean
  reason?: 'no_stripe_customer' | 'nothing_to_bill' | 'below_minimum'
  events?: number
  amountMinor?: number
  currency?: string
  error?: string
}

const BILL_REASONS: Record<NonNullable<BillResult['reason']>, string> = {
  no_stripe_customer: 'This client has no Stripe customer yet (no card on file).',
  nothing_to_bill: 'Nothing to bill: no billable usage pending.',
  below_minimum: 'Pending usage is under one cent; it keeps accumulating.',
}

/** Superadmin › client: how this client's AI is paid for, and its usage. */
export default function TenantAiCard({ tenantId }: { tenantId: string }) {
  const url = `/api/superadmin/tenants/${tenantId}/ai`
  const [data, setData] = useState<Payload | null>(null)
  const [mode, setMode] = useState<string>('')
  const [markup, setMarkup] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'bill' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function apply(next: Payload) {
    setData(next)
    setMode(next.billing_mode ?? '')
    setMarkup(next.markup_pct == null ? '' : String(next.markup_pct))
    setKey(next.openrouter_api_key)
  }

  useEffect(() => {
    fetch(url).then(async res => { if (res.ok) apply((await res.json()) as Payload) }).catch(() => {})
  }, [url])

  async function save(body: Record<string, unknown>) {
    setBusy('save')
    setMessage(null)
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return setMessage({ ok: false, text: json.error ?? 'Could not save' })
    apply(json as Payload)
    setMessage({ ok: true, text: 'Saved' })
  }

  async function billNow() {
    setBusy('bill')
    setMessage(null)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bill' }) })
    const json = (await res.json().catch(() => ({}))) as BillResult
    setBusy(null)
    if (!res.ok) return setMessage({ ok: false, text: json.error ?? 'Billing failed' })
    if (json.billed) {
      const amount = ((json.amountMinor ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: (json.currency ?? 'brl').toUpperCase() })
      setMessage({ ok: true, text: `${amount} for ${json.events} calls added to the client's next Stripe invoice.` })
      fetch(url).then(async r => { if (r.ok) apply((await r.json()) as Payload) }).catch(() => {})
    } else {
      setMessage({ ok: false, text: json.reason ? BILL_REASONS[json.reason] : 'Nothing billed' })
    }
  }

  const input = 'min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50'
  const shownMode = (mode || data?.effective_mode || 'platform') as AiBillingMode

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="tenant-ai-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600"><Sparkles className="size-4" /></span>
          <div>
            <h2 id="tenant-ai-title" className="text-sm font-bold text-zinc-950">AI usage & billing</h2>
            <p className="text-xs text-zinc-500">Who pays for this client&apos;s AI calls. Defaults live in <Link href="/admin/ai" className="font-semibold text-indigo-600 hover:underline">AI & billing</Link>.</p>
          </div>
        </div>
      </div>

      {!data ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" />Loading…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            {data.last_key_error && (
              <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>The client&apos;s key was rejected on {new Date(data.last_key_error_at ?? '').toLocaleString()} ({data.last_key_error}). Calls fell back to the platform key and are billed with margin.</span>
              </p>
            )}
            {!data.global_key_configured && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />No global key configured: there is no fallback if this client&apos;s key fails.
              </p>
            )}
            <div>
              <label htmlFor="tenant-ai-mode" className="mb-1.5 block text-xs font-bold text-zinc-600">Billing mode</label>
              <select id="tenant-ai-mode" value={mode} onChange={e => setMode(e.target.value)} className={input}>
                <option value="">Platform default</option>
                {BILLING_MODES.map(m => <option key={m} value={m}>{BILLING_MODE_LABELS[m]}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-zinc-500">{!mode && <>Now: {BILLING_MODE_LABELS[data.effective_mode]}. </>}{BILLING_MODE_HELP[shownMode]}</p>
            </div>
            <div>
              <label htmlFor="tenant-ai-markup" className="mb-1.5 block text-xs font-bold text-zinc-600">Margin over cost (%)</label>
              <input id="tenant-ai-markup" type="number" min={0} max={1000} step={1} value={markup} placeholder={`Default (${data.effective_markup_pct}%)`} onChange={e => setMarkup(e.target.value)} className={input} />
            </div>
            <OpenRouterKeyField
              label="Client's OpenRouter key"
              value={key}
              stored={data.openrouter_api_key}
              onChange={setKey}
              testUrl={url}
              onRemove={() => void save({ openrouter_api_key: null })}
              help="Used when the mode is the client's own key. The client can also paste it in their panel (Settings › AI & billing)."
            />
            <button
              type="button"
              onClick={() => void save({ billing_mode: mode || null, markup_pct: markup === '' ? null : Number(markup), openrouter_api_key: key })}
              disabled={busy !== null}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
            >
              {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save
            </button>
          </div>

          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-zinc-50 p-3"><dt className="text-xs text-zinc-500">Calls this month</dt><dd className="mt-0.5 font-bold tabular-nums text-zinc-900">{data.month?.calls ?? 0}</dd><dd className="text-xs text-zinc-500">{data.month?.byKey.tenant ?? 0} on client key · {data.month?.byKey.platform ?? 0} on platform key</dd></div>
              <div className="rounded-xl bg-zinc-50 p-3"><dt className="text-xs text-zinc-500">OpenRouter cost</dt><dd className="mt-0.5 font-bold tabular-nums text-zinc-900">{formatUsd(data.month?.costUsd)}</dd></div>
              <div className="rounded-xl bg-zinc-50 p-3"><dt className="text-xs text-zinc-500">Charge this month</dt><dd className="mt-0.5 font-bold tabular-nums text-zinc-900">{formatUsd(data.month?.chargeUsd)}</dd><dd className="text-xs text-zinc-500">{formatBrl(data.month?.chargeUsd, data.usd_to_brl)}</dd></div>
              <div className="rounded-xl bg-zinc-50 p-3"><dt className="text-xs text-zinc-500">Not yet billed (all time)</dt><dd className="mt-0.5 font-bold tabular-nums text-zinc-900">{formatUsd(data.unbilled_charge_usd)}</dd><dd className="text-xs text-zinc-500">{formatBrl(data.unbilled_charge_usd, data.usd_to_brl)}</dd></div>
            </dl>
            <p className="text-xs text-zinc-500">Billable usage goes automatically on the plan&apos;s monthly renewal invoice. &quot;Bill now&quot; adds it as a pending item that Stripe puts on the next invoice.</p>
            <button
              type="button"
              onClick={() => void billNow()}
              disabled={busy !== null || !data.can_bill || data.unbilled_charge_usd <= 0}
              title={data.can_bill ? undefined : BILL_REASONS.no_stripe_customer}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-zinc-100 px-4 text-sm font-bold text-zinc-800 transition-[background-color,scale] duration-150 hover:bg-zinc-200 active:scale-96 disabled:opacity-50"
            >
              {busy === 'bill' ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}Bill now
            </button>
            {!data.can_bill && <p className="text-xs text-zinc-500">{BILL_REASONS.no_stripe_customer}</p>}
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${message.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}{message.text}
        </p>
      )}
    </section>
  )
}
