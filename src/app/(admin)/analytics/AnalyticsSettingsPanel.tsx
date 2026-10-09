'use client'

import { useState } from 'react'
import { Check, Loader2, Play, Rows3, Sparkles } from 'lucide-react'

export interface AnalyticsExperienceSettings {
  analytics_enabled: boolean
  visual_feed_enabled: boolean
  menu_default_view: 'list' | 'feed'
  feed_autoplay_videos: boolean
}

export default function AnalyticsSettingsPanel({
  initialSettings,
  canEdit,
}: {
  initialSettings: AnalyticsExperienceSettings
  canEdit: boolean
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(next: Partial<AnalyticsExperienceSettings>) {
    setSaved(false)
    setSettings(current => {
      const merged = { ...current, ...next }
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

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-primary">
            <Sparkles className="size-3.5" /> Experience controls
          </div>
          <h2 className="text-lg font-black tracking-tight text-zinc-950">Visual menu rollout</h2>
          <p className="mt-1 text-xs font-medium text-zinc-500">Turn the feed on per restaurant while keeping List view available.</p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
            {saving ? 'Saving' : saved ? 'Saved' : 'Save settings'}
          </button>
        ) : null}
      </div>

      <div className="grid gap-px bg-zinc-100 md:grid-cols-2 xl:grid-cols-4">
        <SettingToggle
          label="Analytics"
          description="Collect anonymous first-party menu activity."
          checked={settings.analytics_enabled}
          onChange={checked => update({ analytics_enabled: checked })}
          disabled={!canEdit}
        />
        <SettingToggle
          label="Visual feed"
          description="Allow guests to switch between Feed and List."
          checked={settings.visual_feed_enabled}
          onChange={checked => update({ visual_feed_enabled: checked })}
          disabled={!canEdit}
        />
        <div className="bg-white p-5">
          <p className="text-xs font-black uppercase tracking-wider text-zinc-950">Default view</p>
          <p className="mb-4 mt-1 min-h-8 text-[11px] leading-relaxed text-zinc-500">The first view guests see when the feed is enabled.</p>
          <div className="grid grid-cols-2 gap-2">
            {(['list', 'feed'] as const).map(view => (
              <button
                key={view}
                type="button"
                disabled={!canEdit || !settings.visual_feed_enabled}
                onClick={() => update({ menu_default_view: view })}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-xl border text-xs font-black capitalize transition ${settings.menu_default_view === view ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {view === 'feed' ? <Play className="size-3.5" /> : <Rows3 className="size-3.5" />}
                {view}
              </button>
            ))}
          </div>
        </div>
        <SettingToggle
          label="Video autoplay"
          description="Play direct videos muted only while visible."
          checked={settings.feed_autoplay_videos}
          onChange={checked => update({ feed_autoplay_videos: checked })}
          disabled={!canEdit || !settings.visual_feed_enabled}
        />
      </div>
      {error ? <p role="alert" className="border-t border-red-100 bg-red-50 px-5 py-3 text-xs font-bold text-red-700">{error}</p> : null}
    </section>
  )
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 bg-white p-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-zinc-950">{label}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-zinc-200'} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}
