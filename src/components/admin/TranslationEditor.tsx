'use client'

import { useState } from 'react'
import { Languages, Loader2, Sparkles } from 'lucide-react'
import { menuLanguage } from '@/components/menu/menu-i18n'

export interface TranslationField {
  /** Stable key, e.g. "name", "description", "option:<id>". */
  key: string
  label: string
  /** The text in the menu's base language. */
  base: string
  multiline?: boolean
}

/** language → field key → text */
export type TranslationValues = Record<string, Record<string, string>>

/**
 * Edits the translations of a set of texts into each extra language of the
 * menu: one tab per language, the original next to each field, and a button
 * that asks the AI for whatever is still empty (the owner reviews before
 * saving — nothing is saved here).
 */
export default function TranslationEditor({
  baseLanguage,
  languages,
  fields,
  values,
  onChange,
  disabled = false,
}: {
  baseLanguage: string
  languages: string[]
  fields: TranslationField[]
  values: TranslationValues
  onChange: (values: TranslationValues) => void
  disabled?: boolean
}) {
  const [active, setActive] = useState(languages[0] ?? '')
  const [translating, setTranslating] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const current = languages.includes(active) ? active : languages[0]
  const translatable = fields.filter(f => f.base.trim())

  const missingCount = languages.reduce(
    (sum, lang) => sum + translatable.filter(f => !values[lang]?.[f.key]?.trim()).length,
    0,
  )

  function setValue(lang: string, key: string, text: string) {
    onChange({ ...values, [lang]: { ...(values[lang] ?? {}), [key]: text } })
  }

  async function translateMissing() {
    setMessage(null)
    const targets = languages.filter(lang => translatable.some(f => !values[lang]?.[f.key]?.trim()))
    if (!targets.length) {
      setMessage({ kind: 'info', text: 'Everything is already translated.' })
      return
    }
    const items: Record<string, string> = {}
    for (const f of translatable) {
      if (targets.some(lang => !values[lang]?.[f.key]?.trim())) items[f.key] = f.base
    }
    setTranslating(true)
    try {
      const response = await fetch('/api/admin/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: baseLanguage, to: targets, items }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Translation failed')
      const suggested = (payload.translations ?? {}) as TranslationValues
      const next: TranslationValues = { ...values }
      let filled = 0
      for (const lang of targets) {
        const row = { ...(next[lang] ?? {}) }
        for (const [key, text] of Object.entries(suggested[lang] ?? {})) {
          // Never overwrite what the owner already typed.
          if (!row[key]?.trim() && text.trim()) {
            row[key] = text
            filled++
          }
        }
        next[lang] = row
      }
      onChange(next)
      setMessage({ kind: 'info', text: filled ? `${filled} texts translated. Review them and save.` : 'No new translations came back.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Translation failed' })
    } finally {
      setTranslating(false)
    }
  }

  if (!languages.length) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Languages">
          {languages.map(lang => {
            const info = menuLanguage(lang)
            const missing = translatable.filter(f => !values[lang]?.[f.key]?.trim()).length
            const selected = lang === current
            return (
              <button
                key={lang}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(lang)}
                className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${selected ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'}`}
              >
                {info.nativeName}
                {missing > 0 && (
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${selected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'}`}>{missing}</span>
                )}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={translateMissing}
          disabled={disabled || translating || missingCount === 0}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {translating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {translating ? 'Translating…' : `Translate missing with AI${missingCount ? ` (${missingCount})` : ''}`}
        </button>
      </div>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-[13px] font-medium ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-800'}`}>
          {message.text}
        </p>
      )}

      {current && (
        <div className="space-y-4" role="tabpanel" lang={menuLanguage(current).locale}>
          {translatable.map(field => {
            const id = `tr-${current}-${field.key}`
            const value = values[current]?.[field.key] ?? ''
            return (
              <div key={field.key}>
                <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-zinc-700">
                  <Languages className="size-3.5 text-zinc-400" aria-hidden="true" />
                  {field.label}
                </label>
                <p className="mb-1.5 text-[12px] text-zinc-400" lang={menuLanguage(baseLanguage).locale}>
                  {menuLanguage(baseLanguage).nativeName}: {field.base}
                </p>
                {field.multiline ? (
                  <textarea
                    id={id}
                    value={value}
                    onChange={e => setValue(current, field.key, e.target.value)}
                    disabled={disabled}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50"
                  />
                ) : (
                  <input
                    id={id}
                    value={value}
                    onChange={e => setValue(current, field.key, e.target.value)}
                    disabled={disabled}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
