'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { keyCheckMessage, type KeyCheckResult } from '@/lib/ai/labels'

/**
 * OpenRouter key input shared by the AI settings screens. The stored key comes
 * back masked (sk-or-…••••…); sending the masked value keeps it, an empty
 * value removes it, anything else replaces it.
 */
export default function OpenRouterKeyField({
  label = 'OpenRouter API key',
  value,
  stored,
  onChange,
  testUrl,
  onRemove,
  help,
}: {
  label?: string
  value: string
  /** The key currently saved (masked), to tell "editing" from "saved". */
  stored: string
  onChange: (next: string) => void
  /** POST { action: 'test', api_key } endpoint. */
  testUrl: string
  onRemove?: () => void
  help?: React.ReactNode
}) {
  const [reveal, setReveal] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<KeyCheckResult | null>(null)

  async function test() {
    setTesting(true)
    setResult(null)
    try {
      const res = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', api_key: value }),
      })
      setResult((await res.json()) as KeyCheckResult)
    } catch {
      setResult({ ok: false, error: 'Could not run the test' })
    }
    setTesting(false)
  }

  const input = 'min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 pr-11 font-mono text-sm text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50'

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-zinc-600">{label}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={e => { onChange(e.target.value); setResult(null) }}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            aria-label={label}
            className={input}
          />
          <button
            type="button"
            onClick={() => setReveal(v => !v)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
            className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700"
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing || (!value && !stored)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 disabled:opacity-50"
          >
            {testing && <Loader2 className="size-4 animate-spin" />}
            Test key
          </button>
          {onRemove && stored && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove key"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 text-xs font-bold text-zinc-600 transition-[background-color,color,scale] duration-150 hover:bg-red-50 hover:text-red-600 active:scale-96"
            >
              <Trash2 className="size-4" />
              Remove
            </button>
          )}
        </div>
      </div>
      {help && <p className="mt-1.5 text-xs text-zinc-500">{help}</p>}
      {result && (
        <p
          role="status"
          className={`mt-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${result.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}
        >
          {result.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertCircle className="size-4 shrink-0" />}
          {keyCheckMessage(result)}
        </p>
      )}
    </div>
  )
}
