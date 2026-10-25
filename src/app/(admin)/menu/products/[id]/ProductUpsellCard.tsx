'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export interface UpsellCandidate {
  id: string
  name: string
  category_name: string | null
}

export const MAX_UPSELL_PICKS = 8

/**
 * Dishes suggested right after a guest adds this one ("Complete your order"),
 * shown before the automatic side / drink / dessert steps.
 */
export default function ProductUpsellCard({
  productId,
  initialIds,
  candidates,
  canManage,
}: {
  productId: string
  initialIds: string[]
  /** Other dishes on the same menu. */
  candidates: UpsellCandidate[]
  canManage: boolean
}) {
  const byId = new Map(candidates.map(c => [c.id, c]))
  const [ids, setIds] = useState(() => initialIds.filter(id => byId.has(id)))
  const [saved, setSaved] = useState(ids)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const supabase = createClient()
  const dirty = JSON.stringify(ids) !== JSON.stringify(saved)
  const available = candidates.filter(c => !ids.includes(c.id))

  function move(index: number, delta: number) {
    const next = [...ids]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    setIds(next)
  }

  async function save() {
    setSaving(true)
    setStatus(null)
    const { error } = await supabase.from('products').update({ upsell_product_ids: ids }).eq('id', productId)
    setSaving(false)
    if (error) {
      setStatus({ kind: 'error', text: error.message })
      return
    }
    setSaved(ids)
    setStatus({ kind: 'ok', text: 'Saved.' })
  }

  return (
    <div className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
          <Sparkles className="size-4 text-amber-500" aria-hidden="true" /> Complete your order
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Dishes to suggest right after a guest adds this one, in this order. Sides, drinks and desserts are also suggested automatically from the
          category roles set in Categories.
        </p>
      </div>

      {ids.length > 0 ? (
        <ol className="mb-4 space-y-2">
          {ids.map((id, index) => {
            const item = byId.get(id)
            return (
              <li key={id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2">
                <span className="w-5 text-center text-xs font-semibold tabular-nums text-zinc-400">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">{item?.name ?? 'Unavailable dish'}</span>
                  {item?.category_name && <span className="block truncate text-xs text-zinc-400">{item.category_name}</span>}
                </span>
                {canManage && (
                  <>
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" className="rounded p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30"><ChevronUp size={16} /></button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === ids.length - 1} aria-label="Move down" className="rounded p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-30"><ChevronDown size={16} /></button>
                    <button type="button" onClick={() => setIds(ids.filter(x => x !== id))} aria-label={`Remove ${item?.name ?? 'dish'}`} className="rounded p-1 text-zinc-400 hover:text-red-600"><X size={16} /></button>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mb-4 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">No hand-picked suggestions yet.</p>
      )}

      {canManage && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="upsell-add">Add a dish to suggest</label>
          <select
            id="upsell-add"
            value=""
            disabled={ids.length >= MAX_UPSELL_PICKS || available.length === 0}
            onChange={e => {
              if (e.target.value) setIds([...ids, e.target.value])
            }}
            className="h-10 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 disabled:bg-zinc-50"
          >
            <option value="">{ids.length >= MAX_UPSELL_PICKS ? `Up to ${MAX_UPSELL_PICKS} dishes` : '+ Add a dish to suggest…'}</option>
            {available.map(c => (
              <option key={c.id} value={c.id}>{c.category_name ? `${c.name} — ${c.category_name}` : c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save suggestions'}
          </button>
          {status && (
            <p role={status.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${status.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{status.text}</p>
          )}
        </div>
      )}
    </div>
  )
}
