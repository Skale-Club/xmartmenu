'use client'

import { type ReactNode, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Ingredient } from '@/types/database'

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', BRL: 'R$', EUR: '€', GBP: '£',
  CAD: 'CA$', AUD: 'A$', MXN: 'MX$', ARS: '$', CLP: '$', COP: '$',
}

interface Props {
  ingredients: Ingredient[]
  tenantId: string
  currency: string
  canManage: boolean
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-xl border border-zinc-200 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-800">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export default function IngredientsClient({ ingredients: initial, tenantId, currency, canManage }: Props) {
  const [ingredients, setIngredients] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [reorderInFlight, setReorderInFlight] = useState(false)
  const [form, setForm] = useState({
    name: '',
    default_extra_price: '',
    default_add_price: '',
    is_available: true,
  })
  const supabase = createClient()

  function resetForm() {
    setForm({ name: '', default_extra_price: '', default_add_price: '', is_available: true })
    setEditingId(null)
    setShowForm(false)
    setFormError(null)
  }

  function startEdit(ing: Ingredient) {
    setForm({
      name: ing.name,
      default_extra_price: String(ing.default_extra_price),
      default_add_price: String(ing.default_add_price),
      is_available: ing.is_available,
    })
    setEditingId(ing.id)
    setFormError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setFormError(null)
    const payload = {
      name: form.name,
      default_extra_price: parseFloat(form.default_extra_price) || 0,
      default_add_price: parseFloat(form.default_add_price) || 0,
      is_available: form.is_available,
    }
    if (editingId) {
      const { data, error } = await supabase
        .from('ingredients')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (error) { setFormError(error.message); setLoading(false); return }
      if (data) setIngredients(prev => prev.map(i => i.id === editingId ? data : i))
    } else {
      const { data, error } = await supabase
        .from('ingredients')
        .insert({ tenant_id: tenantId, ...payload, position: ingredients.length })
        .select()
        .single()
      if (error) { setFormError(error.message); setLoading(false); return }
      if (data) setIngredients(prev => [...prev, data])
    }
    resetForm()
    setLoading(false)
  }

  async function confirmDelete() {
    if (!confirmId) return
    await supabase.from('ingredients').delete().eq('id', confirmId)
    setIngredients(prev => prev.filter(i => i.id !== confirmId))
    setConfirmId(null)
  }

  async function moveIngredient(ingredientId: string, direction: 'up' | 'down') {
    const idx = ingredients.findIndex(i => i.id === ingredientId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= ingredients.length) return
    const current = ingredients[idx]
    const swap = ingredients[swapIdx]
    const prev = ingredients
    const reordered = ingredients
      .map(i => {
        if (i.id === current.id) return { ...i, position: swap.position }
        if (i.id === swap.id) return { ...i, position: current.position }
        return i
      })
      .sort((a, b) => a.position - b.position)
    setIngredients(reordered)
    setReorderInFlight(true)
    try {
      await Promise.all([
        supabase.from('ingredients').update({ position: swap.position }).eq('id', current.id),
        supabase.from('ingredients').update({ position: current.position }).eq('id', swap.id),
      ])
    } catch {
      setIngredients(prev)
    } finally {
      setReorderInFlight(false)
    }
  }

  return (
    <div className="p-8">
      <ConfirmDialog
        open={canManage && !!confirmId}
        title="Delete ingredient"
        message="Delete this ingredient? This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />

      <Modal open={canManage && showForm} title={editingId ? 'Edit ingredient' : 'New ingredient'} onClose={resetForm}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="ex: Cheese, Onion, Lettuce"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Extra price (default)</label>
              <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
                  {CURRENCY_SYMBOL[currency] ?? currency}
                </span>
                <input
                  type="number" step="0.01" min="0"
                  value={form.default_extra_price}
                  onChange={e => setForm(f => ({ ...f, default_extra_price: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Add-on price (default)</label>
              <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
                  {CURRENCY_SYMBOL[currency] ?? currency}
                </span>
                <input
                  type="number" step="0.01" min="0"
                  value={form.default_add_price}
                  onChange={e => setForm(f => ({ ...f, default_add_price: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-zinc-700">Available</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, is_available: !f.is_available }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                form.is_available ? 'bg-zinc-900' : 'bg-zinc-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                form.is_available ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save ingredient'}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Ingredients</h1>
          <p className="text-sm text-zinc-500 mt-1">{ingredients.length} ingredient(s)</p>
        </div>
        {canManage && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            + New ingredient
          </button>
        )}
      </div>

      {ingredients.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-4xl mb-3">🥗</p>
          <p className="font-medium">No ingredients registered</p>
          <p className="text-sm mt-1">Add ingredients to build your products</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ingredients.map((ing, idx) => (
            <div key={ing.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-4">
              {canManage && (
                <div className="flex flex-col gap-0.5">
                  <button
                    aria-label="Move up"
                    disabled={idx === 0 || reorderInFlight}
                    onClick={() => moveIngredient(ing.id, 'up')}
                    className="text-zinc-400 hover:text-zinc-700 p-1 rounded disabled:opacity-30"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    aria-label="Move down"
                    disabled={idx === ingredients.length - 1 || reorderInFlight}
                    onClick={() => moveIngredient(ing.id, 'down')}
                    className="text-zinc-400 hover:text-zinc-700 p-1 rounded disabled:opacity-30"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900">{ing.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Extra: {CURRENCY_SYMBOL[currency] ?? currency}{ing.default_extra_price.toFixed(2)} · Add-on: {CURRENCY_SYMBOL[currency] ?? currency}{ing.default_add_price.toFixed(2)}
                </p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                ing.is_available ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'
              }`}>
                {ing.is_available ? 'Available' : 'Unavailable'}
              </span>
              {canManage && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(ing)}
                    className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded"
                    aria-label="Edit ingredient"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setConfirmId(ing.id)}
                    className="text-zinc-400 hover:text-red-600 p-1.5 rounded"
                    aria-label="Delete ingredient"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
