'use client'

import { useState } from 'react'
import { Check, CheckCircle2, Copy, LayoutTemplate, Loader2, Play, Rows3, Save, Smartphone } from 'lucide-react'
import type { AnalyticsExperienceSettings } from '../../analytics/AnalyticsSettingsPanel'

type View = 'list' | 'feed'

const VIEW_CHOICES: Array<{ view: View; title: string; description: string; icon: typeof Rows3 }> = [
  {
    view: 'list',
    title: 'Menu first',
    description: 'Guests land on the classic menu: categories, search and the full list of dishes. The feed stays one tap away.',
    icon: Rows3,
  },
  {
    view: 'feed',
    title: 'Feed first',
    description: 'Guests land on the full-screen visual feed and swipe through the dishes, like Instagram. The menu stays one tap away.',
    icon: Play,
  },
]

export default function MenuDisplayClient({
  initialSettings,
  menuUrl,
  feedUrl,
}: {
  initialSettings: AnalyticsExperienceSettings
  menuUrl: string
  feedUrl: string
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  function update(next: Partial<AnalyticsExperienceSettings>) {
    setSaved(false)
    setSettings(current => {
      const merged = { ...current, ...next }
      // The feed can only be the first screen while it exists.
      if (!merged.visual_feed_enabled) merged.menu_default_view = 'list'
      return merged
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const response = await fetch('/api/admin/analytics/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not save settings')
      setSaved(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(current => (current === url ? null : current)), 1500)
    } catch {
      // clipboard blocked: the URL is still visible to copy by hand
    }
  }

  return (
    <div className="w-full space-y-8 p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-6 border-b border-zinc-100 pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Guest experience</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">Menu display</h1>
          <p className="mt-1 text-sm font-bold text-zinc-500">Choose what guests see first when they open your menu on a phone.</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-black uppercase tracking-widest text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Visual feed on/off */}
      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-zinc-950">Visual feed</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-500">
            A full-screen, swipeable view of your dishes with photos and videos. Turn it off to show only the classic menu.
          </p>
        </div>
        <Switch checked={settings.visual_feed_enabled} onChange={checked => update({ visual_feed_enabled: checked })} label="Visual feed" />
      </section>

      {/* First screen */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-black tracking-tight text-zinc-950">First screen on phones</h2>
          <p className="mt-1 text-xs font-medium text-zinc-500">
            Computers always open the classic menu. Guests can switch between the two at any time, and a reload keeps the one they chose.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {VIEW_CHOICES.map(({ view, title, description, icon: Icon }) => {
            const selected = settings.menu_default_view === view
            const disabled = view === 'feed' && !settings.visual_feed_enabled
            return (
              <button
                key={view}
                type="button"
                onClick={() => update({ menu_default_view: view })}
                disabled={disabled}
                aria-pressed={selected}
                className={`relative flex flex-col gap-3 rounded-2xl border-2 p-5 text-left transition ${selected ? 'border-primary bg-primary/5' : 'border-zinc-200 bg-white hover:border-zinc-300'} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="flex items-center gap-3">
                  <span className={`flex size-10 items-center justify-center rounded-xl ${selected ? 'bg-primary text-primary-foreground' : 'bg-zinc-100 text-zinc-600'}`}>
                    <Icon className="size-5" />
                  </span>
                  <span className="text-base font-black text-zinc-950">{title}</span>
                  {selected && <Check className="ml-auto size-5 text-primary" />}
                </span>
                <span className="text-xs font-medium leading-relaxed text-zinc-500">{description}</span>
                {disabled && <span className="text-[11px] font-bold text-zinc-400">Turn on the visual feed to use this.</span>}
              </button>
            )
          })}
        </div>
      </section>

      {/* Autoplay */}
      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-zinc-950">Autoplay videos in the feed</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-500">Videos play muted, only while they are on screen.</p>
        </div>
        <Switch
          checked={settings.feed_autoplay_videos}
          onChange={checked => update({ feed_autoplay_videos: checked })}
          disabled={!settings.visual_feed_enabled}
          label="Autoplay videos"
        />
      </section>

      {/* Links */}
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="flex items-center gap-2">
          <Smartphone className="size-4 text-zinc-500" />
          <h2 className="text-sm font-black text-zinc-950">Links for QR codes, NFC tags and social media</h2>
        </div>
        <LinkRow
          label="Menu link"
          help="Opens the first screen chosen above."
          url={menuUrl}
          copied={copied === menuUrl}
          onCopy={() => copy(menuUrl)}
        />
        {settings.visual_feed_enabled && (
          <LinkRow
            label="Feed link"
            help="Always opens the visual feed on phones, whatever the first screen is. Good for NFC tags and Instagram."
            url={feedUrl}
            copied={copied === feedUrl}
            onCopy={() => copy(feedUrl)}
          />
        )}
      </section>

      {error ? <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">{error}</p> : null}
    </div>
  )
}

function Switch({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 self-start rounded-full transition sm:self-auto ${checked ? 'bg-primary' : 'bg-zinc-300'} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

function LinkRow({ label, help, url, copied, onCopy }: { label: string; help: string; url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-wider text-zinc-950">{label}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">{help}</p>
        <p className="mt-1 truncate font-mono text-xs text-zinc-700">{url}</p>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-700 transition hover:bg-zinc-50"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
