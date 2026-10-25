'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Save, Sparkles } from 'lucide-react'
import OpenRouterKeyField from '@/components/ai/OpenRouterKeyField'
import type { AiBillingMode } from '@/lib/ai/billing-rules'
import { formatBrl } from '@/lib/ai/labels'
import { cn } from '@/lib/utils'

interface Payload {
  effective_mode: AiBillingMode
  openrouter_api_key: string
  last_key_error: string | null
  last_key_error_at: string | null
  usd_to_brl: number
  month: { calls: number; charge_usd: number; calls_on_own_key: number } | null
}

const MODE_TEXT: Record<AiBillingMode, { title: string; body: string }> = {
  own_key: {
    title: 'You pay OpenRouter directly',
    body: 'AI runs on your own OpenRouter key and OpenRouter charges your card. If your key stops working (invalid or out of credit), we keep the assistant running on our key and add that usage to your plan invoice.',
  },
  platform: {
    title: 'Billed on your plan invoice',
    body: 'AI runs on our key. What you use is added to your monthly plan invoice. Prefer to pay OpenRouter yourself? Paste your own key below.',
  },
  included: {
    title: 'Included in your plan',
    body: 'AI usage is included: nothing extra is charged.',
  },
}

const API = '/api/admin/ai'

/** The restaurant's AI page: their own OpenRouter key and this month's usage. */
export default function AiSettingsClient() {
  const [data, setData] = useState<Payload | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function apply(next: Payload) {
    setData(next)
    setKey(next.openrouter_api_key)
  }

  useEffect(() => {
    fetch(API).then(async res => { if (res.ok) apply((await res.json()) as Payload) }).catch(() => {})
  }, [])

  async function save(value: string | null) {
    setSaving(true)
    setMessage(null)
    const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openrouter_api_key: value }) })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setMessage({ ok: false, text: json.error ?? 'Could not save' })
    apply(json as Payload)
    setMessage({ ok: true, text: value ? 'Key saved: AI now runs on your OpenRouter account.' : 'Key removed.' })
  }

  const mode = data ? MODE_TEXT[data.effective_mode] : null

  return (
    <div className="w-full space-y-10 p-8">
      <div className="flex flex-col justify-between gap-6 border-b border-zinc-100 pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Administration</span>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-zinc-950">AI & billing</h1>
          <p className="mt-1 text-sm font-bold text-zinc-500">How the AI features (chat, voice, translations) are paid for</p>
        </div>
      </div>

      {!data ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" />Loading…</p>
      ) : (
        <div className="space-y-6">
          {mode && (
            <div className="rounded-[1.25rem] border border-blue-200 bg-blue-50 p-6 text-sm text-blue-900">
              <p className="font-bold">{mode.title}</p>
              <p className="mt-1">{mode.body}</p>
            </div>
          )}

          {data.last_key_error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>OpenRouter rejected your key on {new Date(data.last_key_error_at ?? '').toLocaleString()}. Check its credit at openrouter.ai, or paste a new key. Until then, AI usage runs on our key and goes on your plan invoice.</span>
            </p>
          )}

          <div className="space-y-5 rounded-[1.25rem] border border-zinc-100 bg-white p-8 shadow-sm">
            <OpenRouterKeyField
              label="Your OpenRouter API key"
              value={key}
              stored={data.openrouter_api_key}
              onChange={setKey}
              testUrl={API}
              onRemove={() => void save(null)}
              help="Create a key at openrouter.ai/keys and add credit there. With your own key, OpenRouter bills you directly for the AI your customers use."
            />
            <button
              type="button"
              onClick={() => void save(key)}
              disabled={saving || !key || key === data.openrouter_api_key}
              className="flex items-center gap-3 rounded-full bg-zinc-950 px-8 py-3.5 text-sm font-black uppercase tracking-widest text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}Save key
            </button>
            {message && (
              <p role="status" className={cn('flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold', message.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700')}>
                {message.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}{message.text}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[1.25rem] border border-zinc-100 bg-white p-6 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">AI calls this month</p>
              <p className="mt-2 text-3xl font-black tabular-nums text-zinc-950">{data.month?.calls ?? 0}</p>
              {!!data.month?.calls_on_own_key && <p className="mt-1 text-xs text-zinc-500">{data.month.calls_on_own_key} on your own key</p>}
            </div>
            <div className="rounded-[1.25rem] border border-zinc-100 bg-white p-6 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Added to your invoice this month</p>
              <p className="mt-2 text-3xl font-black tabular-nums text-zinc-950">{formatBrl(data.month?.charge_usd, data.usd_to_brl)}</p>
              <p className="mt-1 text-xs text-zinc-500">Estimate. Usage on your own key is billed by OpenRouter, not here.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
