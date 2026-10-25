'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, Sparkles, Mic, MessageSquare, AlertCircle, CheckCircle2, Save, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const MODELS = [
  { value: 'openai/gpt-4o-mini',                       label: 'GPT-4o mini — fast & cheap' },
  { value: 'openai/gpt-4o',                            label: 'GPT-4o — high quality' },
  { value: 'anthropic/claude-haiku-4.5',               label: 'Claude Haiku 4.5 — fast' },
  { value: 'anthropic/claude-sonnet-4.5',              label: 'Claude Sonnet 4.5 — balanced' },
  { value: 'google/gemini-2.5-flash',                  label: 'Gemini 2.5 Flash — fast' },
  { value: 'meta-llama/llama-3.3-70b-instruct',        label: 'Llama 3.3 70B — open weight' },
  { value: 'mistralai/mixtral-8x7b-instruct',          label: 'Mixtral 8x7B — open weight' },
]

interface Status {
  available: boolean
  active: boolean
  enabled: boolean
  overrideApplied: boolean
}

interface Settings {
  enabled: boolean
  openrouter_model: string
  audio_enabled: boolean
  text_enabled: boolean
  audio_provider: 'whisper' | 'deepgram' | null
  rate_limit_per_phone_per_day: number
}

export default function ChatAddonClient({ initialSettings, status }: { initialSettings: any; status: Status }) {
  const [form, setForm] = useState<Settings>({
    enabled: initialSettings?.enabled ?? false,
    openrouter_model: initialSettings?.openrouter_model ?? 'openai/gpt-4o-mini',
    audio_enabled: initialSettings?.audio_enabled ?? false,
    text_enabled: initialSettings?.text_enabled ?? true,
    audio_provider: initialSettings?.audio_provider ?? 'whisper',
    rate_limit_per_phone_per_day: initialSettings?.rate_limit_per_phone_per_day ?? 30,
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    const res = await fetch('/api/admin/chat-addon/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
  }

  const canPurchase = !status.available
  const planActive = status.available && !status.overrideApplied && !status.active

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Administration</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">AI Chat</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Embed a menu-aware AI assistant on your public page</p>
        </div>
        <div>
          {status.active ? (
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-full text-xs font-black text-green-700 uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Addon Active
            </span>
          ) : canPurchase ? (
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full text-xs font-black text-amber-700 uppercase tracking-widest">
              <Sparkles className="w-3 h-3" /> Upgrade required
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-full text-xs font-black text-zinc-500 uppercase tracking-widest">
              Addon inactive
            </span>
          )}
        </div>
      </div>

      {/* Upgrade banner */}
      {canPurchase && (
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 rounded-[1.25rem] p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-lg font-black text-zinc-950 mb-1">Activate AI Chat — $20/month</p>
            <p className="text-sm text-zinc-700">A menu-aware assistant that helps customers explore your dishes, recommend pairings, and add items to their cart.</p>
          </div>
          <a
            href="/api/admin/chat-addon/billing/checkout"
            className="px-6 py-3 bg-zinc-950 text-white rounded-full text-sm font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all whitespace-nowrap"
          >
            Activate Addon
          </a>
        </div>
      )}

      {planActive && (
        <div className="bg-blue-50 border border-blue-200 rounded-[1.25rem] p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-bold">Your plan includes AI Chat.</p>
            <p>Activate the addon below to start using it.</p>
          </div>
        </div>
      )}

      {/* Settings — only editable when active */}
      <div className={cn("bg-white border border-zinc-100 rounded-[1.25rem] p-10 space-y-8 shadow-sm", !status.available && "opacity-60 pointer-events-none")}>
        {/* Enable toggle */}
        <div
          className="flex items-center justify-between p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
          onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
        >
          <div className="max-w-[70%]">
            <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">Enable chat widget</p>
            <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Show the floating chat button on your public menu pages.</p>
          </div>
          <button type="button" className={cn(
            "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
            form.enabled ? "bg-primary" : "bg-zinc-200"
          )}>
            <span className={cn(
              "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
              form.enabled ? "translate-x-5" : "translate-x-1"
            )} />
          </button>
        </div>

        {/* OpenRouter config */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-zinc-950 uppercase tracking-wide">OpenRouter</h3>

          <Link
            href="/settings/ai"
            className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 transition-colors hover:bg-zinc-100"
          >
            <span>
              <span className="block text-sm font-black text-zinc-950">AI key & billing</span>
              <span className="block text-[11px] text-zinc-500 mt-0.5">Use your own OpenRouter key, or let usage go on your plan invoice.</span>
            </span>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </Link>

          <div>
            <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Model</label>
            <select
              value={form.openrouter_model}
              onChange={e => setForm(f => ({ ...f, openrouter_model: e.target.value }))}
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Rate limit (messages per phone per day)</label>
            <input
              type="number"
              min={1}
              max={500}
              value={form.rate_limit_per_phone_per_day}
              onChange={e => setForm(f => ({ ...f, rate_limit_per_phone_per_day: Math.max(1, Math.min(500, Number(e.target.value) || 30)) }))}
              className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-[10px] text-zinc-400 mt-2 ml-1">Per-phone, rolling 24-hour window.</p>
          </div>
        </div>

        {/* Channels: how guests may talk to the assistant */}
        <div className="space-y-4 pt-4 border-t border-zinc-100">
          <div
            className="flex items-center justify-between p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
            onClick={() => setForm(f => ({ ...f, text_enabled: !f.text_enabled }))}
          >
            <div className="max-w-[70%]">
              <p className="text-sm font-black text-zinc-950 uppercase tracking-tight flex items-center gap-2"><MessageSquare className="w-4 h-4" />Text messages</p>
              <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Customers can type to the assistant. Turn off to take voice messages only.</p>
            </div>
            <button type="button" aria-pressed={form.text_enabled} aria-label="Text messages" className={cn(
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
              form.text_enabled ? "bg-primary" : "bg-zinc-200"
            )}>
              <span className={cn(
                "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                form.text_enabled ? "translate-x-5" : "translate-x-1"
              )} />
            </button>
          </div>

          <div
            className="flex items-center justify-between p-5 rounded-[1rem] bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
            onClick={() => setForm(f => ({ ...f, audio_enabled: !f.audio_enabled }))}
          >
            <div className="max-w-[70%]">
              <p className="text-sm font-black text-zinc-950 uppercase tracking-tight flex items-center gap-2"><Mic className="w-4 h-4" />Voice messages (STT)</p>
              <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">Customers can speak their order instead of typing: voice notes up to 60 seconds, transcribed and answered in text.</p>
            </div>
            <button type="button" aria-pressed={form.audio_enabled} aria-label="Voice messages" className={cn(
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none",
              form.audio_enabled ? "bg-primary" : "bg-zinc-200"
            )}>
              <span className={cn(
                "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                form.audio_enabled ? "translate-x-5" : "translate-x-1"
              )} />
            </button>
          </div>

          {form.audio_enabled && (
            <div className="space-y-4 px-5">
              <div>
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Transcription model</label>
                <select
                  value={form.audio_provider ?? 'whisper'}
                  onChange={e => setForm(f => ({ ...f, audio_provider: e.target.value === 'deepgram' ? 'deepgram' : 'whisper' }))}
                  className="w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="whisper">OpenAI Whisper</option>
                  <option value="deepgram">Deepgram Nova</option>
                </select>
                <p className="text-[10px] text-zinc-400 mt-2 ml-1">Runs on the same AI setup as the chat (AI key & billing). No separate audio key.</p>
              </div>
            </div>
          )}
        </div>

        {!form.text_enabled && !form.audio_enabled && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Text and voice messages are both off, so the chat box will not show on your menu.
          </p>
        )}

        {/* Save */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-3 px-12 py-4 rounded-full text-sm font-black uppercase tracking-widest transition-all",
              saved ? "bg-green-500 text-white" : "bg-zinc-950 text-primary hover:bg-primary hover:text-primary-foreground"
            )}
          >
            {saving ? 'Saving…' : saved ? (<><CheckCircle2 className="w-5 h-5" />Saved</>) : (<><Save className="w-5 h-5" />Save settings</>)}
          </button>
        </div>
      </div>
    </div>
  )
}
