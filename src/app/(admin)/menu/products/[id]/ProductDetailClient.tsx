'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatPrice } from '@/lib/utils'
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Product, ProductOption, OptionGroupType } from '@/types/database'
import { type GroupWithOptions } from './page'

const TYPE_BADGE: Record<OptionGroupType, string> = {
  single:        'bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full',
  multiple:      'bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full',
  half_and_half: 'bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full',
}
const TYPE_LABEL: Record<OptionGroupType, string> = {
  single: 'single', multiple: 'multiple', half_and_half: 'half & half',
}
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', BRL: 'R$', EUR: '€', GBP: '£',
}

interface Props {
  product: Product & { category: { id: string; name: string } | null }
  initialGroups: GroupWithOptions[]
  tenantId: string
  currency: string
  canManage: boolean
}

function OptionGroupForm({
  initial,
  onSave,
  onDiscard,
}: {
  initial?: { name: string; type: OptionGroupType; required: boolean; min_selections: number; max_selections: number | null }
  onSave: (data: { name: string; type: OptionGroupType; required: boolean; min_selections: number; max_selections: number | null }) => Promise<void>
  onDiscard: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<OptionGroupType>(initial?.type ?? 'single')
  const [required, setRequired] = useState(initial?.required ?? false)
  const [minSelections, setMinSelections] = useState(initial?.min_selections ?? 1)
  const [maxSelections, setMaxSelections] = useState<string>(
    initial?.max_selections != null ? String(initial.max_selections) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    await onSave({
      name,
      type,
      required,
      min_selections: minSelections,
      max_selections: maxSelections ? parseInt(maxSelections, 10) : null,
    }).catch((err: Error) => setError(err.message))
    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Size, Toppings, Flavor"
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Type *</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as OptionGroupType)}
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 bg-white"
          >
            <option value="single">Single (radio)</option>
            <option value="multiple">Multiple (checkboxes)</option>
            <option value="half_and_half">Half &amp; Half</option>
          </select>
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={required}
              onChange={e => setRequired(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300"
            />
            <span className="text-sm text-zinc-700">Required</span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Min selections</label>
          <input
            type="number"
            min="0"
            value={minSelections}
            onChange={e => setMinSelections(parseInt(e.target.value, 10) || 0)}
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Max selections</label>
          <input
            type="number"
            min="1"
            value={maxSelections}
            onChange={e => setMaxSelections(e.target.value)}
            placeholder="No limit"
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Failed to save. {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save group'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          Discard group
        </button>
      </div>
    </form>
  )
}

function OptionForm({
  parentGroupType,
  currency,
  initial,
  onSave,
  onDiscard,
}: {
  parentGroupType: OptionGroupType
  currency: string
  initial?: { name: string; base_price: number | null; price_modifier: number; is_available: boolean }
  onSave: (data: { name: string; base_price: number | null; price_modifier: number; is_available: boolean }) => Promise<void>
  onDiscard: () => void
}) {
  const isAbsolutePrice = parentGroupType === 'single' || parentGroupType === 'half_and_half'

  const [name, setName] = useState(initial?.name ?? '')
  const [priceValue, setPriceValue] = useState<string>(
    initial != null
      ? isAbsolutePrice
        ? initial.base_price != null ? String(initial.base_price) : ''
        : String(initial.price_modifier)
      : ''
  )
  const [isAvailable, setIsAvailable] = useState(initial?.is_available ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priceLabel = isAbsolutePrice ? 'Base price (full size price)' : 'Price modifier (+/-)'
  const priceHint = isAbsolutePrice
    ? 'Absolute price for this option size'
    : "Amount added to or subtracted from the product's base price"

  const currencySymbol: Record<string, string> = {
    USD: '$', BRL: 'R$', EUR: '€', GBP: '£',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const parsed = parseFloat(priceValue) || 0
    const payload = isAbsolutePrice
      ? { name, base_price: parsed, price_modifier: 0, is_available: isAvailable }
      : { name, base_price: null, price_modifier: parsed, is_available: isAvailable }
    await onSave(payload).catch((err: Error) => setError(err.message))
    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Small, Extra cheese"
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">{priceLabel}</label>
          <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
            <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
              {currencySymbol[currency] ?? currency}
            </span>
            <input
              type="number"
              step="0.01"
              {...(isAbsolutePrice ? { min: '0' } : {})}
              value={priceValue}
              onChange={e => setPriceValue(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-3 py-2 text-sm focus:outline-none"
            />
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">{priceHint}</p>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isAvailable}
          onChange={e => setIsAvailable(e.target.checked)}
          className="w-4 h-4 rounded border-zinc-300"
        />
        <span className="text-sm text-zinc-700">Available</span>
      </label>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Failed to save. {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save option'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          Discard option
        </button>
      </div>
    </form>
  )
}

export default function ProductDetailClient({ product, initialGroups, tenantId: _tenantId, currency, canManage }: Props) {
  // Product fields form state
  const [productForm, setProductForm] = useState({
    name: product.name,
    description: product.description ?? '',
    price: String(product.price),
    original_price: product.original_price ? String(product.original_price) : '',
    category_id: product.category_id ?? '',
    is_featured: product.is_featured,
    tags: product.tags ?? [],
  })
  const [productSaving, setProductSaving] = useState(false)
  const [productError, setProductError] = useState<string | null>(null)

  // Groups + options state (two-level nested)
  const [groups, setGroups] = useState<GroupWithOptions[]>(initialGroups)

  // Expand state for inline forms
  const [expandedGroup, setExpandedGroup] = useState<'new' | string | null>(null)
  const [expandedOption, setExpandedOption] = useState<Record<string, 'new' | string | null>>({})

  // Reorder in-flight guard
  const [reorderInFlight, setReorderInFlight] = useState(false)

  // Confirm dialogs
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null)
  const [confirmOptionId, setConfirmOptionId] = useState<{ groupId: string; optionId: string } | null>(null)

  const supabase = createClient()
  const router = useRouter()

  function updateGroupOptions(groupId: string, updater: (opts: ProductOption[]) => ProductOption[]) {
    setGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, options: updater(g.options) } : g
    ))
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault()
    setProductSaving(true)
    setProductError(null)
    const { error } = await supabase
      .from('products')
      .update({
        name: productForm.name,
        description: productForm.description || null,
        price: parseFloat(productForm.price),
        original_price: productForm.original_price ? parseFloat(productForm.original_price) : null,
        category_id: productForm.category_id || null,
        is_featured: productForm.is_featured,
        tags: productForm.tags,
      })
      .eq('id', product.id)
    if (error) setProductError(error.message)
    setProductSaving(false)
  }

  async function toggleOptionAvailability(groupId: string, optionId: string, current: boolean) {
    await supabase.from('product_options').update({ is_available: !current }).eq('id', optionId)
    updateGroupOptions(groupId, opts =>
      opts.map(o => o.id === optionId ? { ...o, is_available: !current } : o)
    )
  }

  async function confirmDeleteGroup() {
    if (!confirmGroupId) return
    await supabase.from('product_option_groups').delete().eq('id', confirmGroupId)
    setGroups(prev => prev.filter(g => g.id !== confirmGroupId))
    setConfirmGroupId(null)
  }

  async function confirmDeleteOption() {
    if (!confirmOptionId) return
    await supabase.from('product_options').delete().eq('id', confirmOptionId.optionId)
    updateGroupOptions(confirmOptionId.groupId, opts =>
      opts.filter(o => o.id !== confirmOptionId!.optionId)
    )
    setConfirmOptionId(null)
  }

  async function handleSaveGroup(
    data: {
      name: string
      type: OptionGroupType
      required: boolean
      min_selections: number
      max_selections: number | null
    },
    editingId: string | null,
    onSuccess: () => void,
    onError: (msg: string) => void
  ) {
    if (editingId) {
      const { error } = await supabase
        .from('product_option_groups')
        .update({ name: data.name, type: data.type, required: data.required, min_selections: data.min_selections, max_selections: data.max_selections })
        .eq('id', editingId)
      if (error) { onError(error.message); return }
      setGroups(prev => prev.map(g =>
        g.id === editingId ? { ...g, ...data } : g
      ))
    } else {
      const { data: inserted, error } = await supabase
        .from('product_option_groups')
        .insert({
          product_id: product.id,
          tenant_id: _tenantId,
          name: data.name,
          type: data.type,
          required: data.required,
          min_selections: data.min_selections,
          max_selections: data.max_selections,
          price_rule: 'max',
          position: groups.length,
        })
        .select()
        .single()
      if (error) { onError(error.message); return }
      if (inserted) setGroups(prev => [...prev, { ...inserted, options: [] }])
    }
    onSuccess()
  }

  async function moveGroup(groupId: string, direction: 'up' | 'down') {
    const idx = groups.findIndex(g => g.id === groupId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= groups.length) return

    const current = groups[idx]
    const swap = groups[swapIdx]
    const prevGroups = groups

    // Optimistic update
    const reordered = groups
      .map(g => {
        if (g.id === current.id) return { ...g, position: swap.position }
        if (g.id === swap.id) return { ...g, position: current.position }
        return g
      })
      .sort((a, b) => a.position - b.position)
    setGroups(reordered)
    setReorderInFlight(true)

    try {
      await Promise.all([
        supabase.from('product_option_groups').update({ position: swap.position }).eq('id', current.id),
        supabase.from('product_option_groups').update({ position: current.position }).eq('id', swap.id),
      ])
    } catch {
      // Silent restore on error
      setGroups(prevGroups)
    } finally {
      setReorderInFlight(false)
    }
  }

  async function handleSaveOption(
    groupId: string,
    data: {
      name: string
      base_price: number | null
      price_modifier: number
      is_available: boolean
    },
    editingId: string | null,
    onSuccess: () => void,
    onError: (msg: string) => void
  ) {
    if (editingId) {
      const { error } = await supabase
        .from('product_options')
        .update({ name: data.name, base_price: data.base_price, price_modifier: data.price_modifier, is_available: data.is_available })
        .eq('id', editingId)
      if (error) { onError(error.message); return }
      updateGroupOptions(groupId, opts =>
        opts.map(o => o.id === editingId ? { ...o, ...data } : o)
      )
    } else {
      const group = groups.find(g => g.id === groupId)
      const { data: inserted, error } = await supabase
        .from('product_options')
        .insert({
          group_id: groupId,
          tenant_id: _tenantId,
          name: data.name,
          base_price: data.base_price,
          price_modifier: data.price_modifier,
          is_available: data.is_available,
          position: group?.options.length ?? 0,
        })
        .select()
        .single()
      if (error) { onError(error.message); return }
      if (inserted) updateGroupOptions(groupId, opts => [...opts, inserted])
    }
    onSuccess()
  }

  async function moveOption(groupId: string, optionId: string, direction: 'up' | 'down') {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    const opts = group.options
    const idx = opts.findIndex(o => o.id === optionId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= opts.length) return

    const current = opts[idx]
    const swap = opts[swapIdx]
    const prevGroups = groups

    // Optimistic update
    const reorderedOpts = opts
      .map(o => {
        if (o.id === current.id) return { ...o, position: swap.position }
        if (o.id === swap.id) return { ...o, position: current.position }
        return o
      })
      .sort((a, b) => a.position - b.position)
    updateGroupOptions(groupId, () => reorderedOpts)
    setReorderInFlight(true)

    try {
      await Promise.all([
        supabase.from('product_options').update({ position: swap.position }).eq('id', current.id),
        supabase.from('product_options').update({ position: current.position }).eq('id', swap.id),
      ])
    } catch {
      // Silent restore on error
      setGroups(prevGroups)
    } finally {
      setReorderInFlight(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* ConfirmDialogs */}
      <ConfirmDialog
        open={!!confirmGroupId}
        title="Delete option group"
        message="Delete this option group and all its options? This action cannot be undone."
        confirmLabel="Delete group"
        onConfirm={confirmDeleteGroup}
        onCancel={() => setConfirmGroupId(null)}
      />
      <ConfirmDialog
        open={!!confirmOptionId}
        title="Delete option"
        message="Delete this option? This action cannot be undone."
        confirmLabel="Delete option"
        onConfirm={confirmDeleteOption}
        onCancel={() => setConfirmOptionId(null)}
      />

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/admin/menu/products')}
          className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          ← Products
        </button>
        <span className="text-zinc-300">/</span>
        <h1 className="text-2xl font-semibold text-zinc-900">Edit product</h1>
      </div>

      {/* Product fields section */}
      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6 mb-8">
        <form onSubmit={handleSaveProduct} className="space-y-4">
          {/* name field */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
            <input
              required
              value={productForm.name}
              onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          {/* description field */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={productForm.description}
              onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none"
            />
          </div>
          {/* price + original_price fields side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Price *</label>
              <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
                  {CURRENCY_SYMBOL[currency] ?? currency}
                </span>
                <input
                  required type="number" step="0.01" min="0"
                  value={productForm.price}
                  onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))}
                  className="flex-1 px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Original price (was)</label>
              <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
                  {CURRENCY_SYMBOL[currency] ?? currency}
                </span>
                <input
                  type="number" step="0.01" min="0"
                  value={productForm.original_price}
                  onChange={e => setProductForm(f => ({ ...f, original_price: e.target.value }))}
                  className="flex-1 px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
          </div>
          {/* is_featured checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={productForm.is_featured}
              onChange={e => setProductForm(f => ({ ...f, is_featured: e.target.checked }))}
              className="w-4 h-4 rounded border-zinc-300"
            />
            <span className="text-sm text-zinc-700">Featured product</span>
          </label>
          {/* error */}
          {productError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{productError}</p>
          )}
          {/* save button */}
          {canManage && (
            <button
              type="submit"
              disabled={productSaving}
              className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {productSaving ? 'Saving...' : 'Save product'}
            </button>
          )}
        </form>
      </div>

      {/* Option Groups section */}
      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">Option Groups</h2>
          {canManage && (
            <button
              disabled={expandedGroup !== null}
              onClick={() => setExpandedGroup('new')}
              className="bg-zinc-900 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 transition-colors flex items-center gap-1"
            >
              <Plus size={14} /> Add group
            </button>
          )}
        </div>

        {/* Empty state when no groups */}
        {groups.length === 0 && expandedGroup !== 'new' && (
          <div className="text-center py-12 text-zinc-400">
            <p className="font-medium text-zinc-500">No option groups yet</p>
            <p className="text-sm mt-1">Add a group to offer sizes, toppings, or half-and-half options for this product.</p>
          </div>
        )}

        {/* "Add group" inline form */}
        {expandedGroup === 'new' && (
          <div className="border border-zinc-200 rounded-xl p-4 mb-3 bg-zinc-50">
            <OptionGroupForm
              onSave={async (data) => {
                await handleSaveGroup(data, null, () => setExpandedGroup(null), (msg) => { throw new Error(msg) })
              }}
              onDiscard={() => setExpandedGroup(null)}
            />
          </div>
        )}

        {/* Groups list */}
        <div className="space-y-3">
          {groups.map((group, idx) => (
            <div key={group.id} className="border border-zinc-200 rounded-xl overflow-hidden">
              {/* Group header row */}
              {expandedGroup === group.id ? (
                <div className="p-4 bg-zinc-50">
                  <OptionGroupForm
                    initial={{ name: group.name, type: group.type, required: group.required, min_selections: group.min_selections, max_selections: group.max_selections }}
                    onSave={async (data) => {
                      await handleSaveGroup(data, group.id, () => setExpandedGroup(null), (msg) => { throw new Error(msg) })
                    }}
                    onDiscard={() => setExpandedGroup(null)}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 min-h-[48px]">
                  {/* Reorder arrows */}
                  {canManage && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        aria-label="Move group up"
                        disabled={idx === 0 || reorderInFlight}
                        onClick={() => moveGroup(group.id, 'up')}
                        className="text-zinc-400 hover:text-zinc-700 p-1 rounded disabled:opacity-30"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        aria-label="Move group down"
                        disabled={idx === groups.length - 1 || reorderInFlight}
                        onClick={() => moveGroup(group.id, 'down')}
                        className="text-zinc-400 hover:text-zinc-700 p-1 rounded disabled:opacity-30"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  )}
                  {/* Group name + badges */}
                  <div className="flex-1 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-900">{group.name}</span>
                    <span className={TYPE_BADGE[group.type]}>{TYPE_LABEL[group.type]}</span>
                    {group.required && (
                      <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">Required</span>
                    )}
                    <span className="text-xs text-zinc-400">
                      {group.options.length === 1 ? '1 option' : `${group.options.length} options`}
                    </span>
                  </div>
                  {/* Edit / Delete */}
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setExpandedGroup(group.id); setExpandedOption({}) }}
                        className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded"
                        aria-label="Edit group"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmGroupId(group.id)}
                        className="text-zinc-400 hover:text-red-600 p-1.5 rounded"
                        aria-label="Delete group"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Options list for this group */}
              <div className="border-t border-zinc-100 divide-y divide-zinc-100">
                {group.options.length === 0 && expandedOption[group.id] !== 'new' && (
                  <div className="px-4 py-3 text-sm text-zinc-400 italic">
                    No options yet. Add options to this group.
                  </div>
                )}

                {/* "Add option" inline form */}
                {canManage && expandedOption[group.id] === 'new' && (
                  <div className="p-4 bg-zinc-50">
                    <OptionForm
                      parentGroupType={group.type}
                      currency={currency}
                      onSave={async (data) => {
                        await handleSaveOption(group.id, data, null,
                          () => setExpandedOption(prev => ({ ...prev, [group.id]: null })),
                          (msg) => { throw new Error(msg) }
                        )
                      }}
                      onDiscard={() => setExpandedOption(prev => ({ ...prev, [group.id]: null }))}
                    />
                  </div>
                )}

                {group.options.map((option, optIdx) => (
                  <div key={option.id}>
                    {expandedOption[group.id] === option.id ? (
                      <div className="p-4 bg-zinc-50">
                        <OptionForm
                          parentGroupType={group.type}
                          currency={currency}
                          initial={{ name: option.name, base_price: option.base_price, price_modifier: option.price_modifier, is_available: option.is_available }}
                          onSave={async (data) => {
                            await handleSaveOption(group.id, data, option.id,
                              () => setExpandedOption(prev => ({ ...prev, [group.id]: null })),
                              (msg) => { throw new Error(msg) }
                            )
                          }}
                          onDiscard={() => setExpandedOption(prev => ({ ...prev, [group.id]: null }))}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-2.5 min-h-[40px] pl-10">
                        {/* Option reorder arrows */}
                        {canManage && (
                          <div className="flex flex-col gap-0.5">
                            <button
                              aria-label="Move option up"
                              disabled={optIdx === 0 || reorderInFlight}
                              onClick={() => moveOption(group.id, option.id, 'up')}
                              className="text-zinc-400 hover:text-zinc-700 p-0.5 rounded disabled:opacity-30"
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              aria-label="Move option down"
                              disabled={optIdx === group.options.length - 1 || reorderInFlight}
                              onClick={() => moveOption(group.id, option.id, 'down')}
                              className="text-zinc-400 hover:text-zinc-700 p-0.5 rounded disabled:opacity-30"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </div>
                        )}
                        {/* Option name + price */}
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-sm text-zinc-900">{option.name}</span>
                          <span className="text-sm text-zinc-500">
                            {option.base_price != null
                              ? formatPrice(option.base_price, currency)
                              : option.price_modifier !== 0
                                ? (option.price_modifier > 0 ? '+' : '') + formatPrice(option.price_modifier, currency)
                                : null}
                          </span>
                        </div>
                        {/* Availability toggle */}
                        {canManage && (
                          <button
                            onClick={() => toggleOptionAvailability(group.id, option.id, option.is_available)}
                            className={option.is_available
                              ? 'bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-medium hover:bg-green-200 transition-colors'
                              : 'bg-zinc-100 text-zinc-500 text-xs px-2.5 py-1 rounded-full font-medium hover:bg-zinc-200 transition-colors'
                            }
                          >
                            {option.is_available ? 'Available' : 'Unavailable'}
                          </button>
                        )}
                        {/* Edit / Delete option */}
                        {canManage && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setExpandedOption(prev => ({ ...prev, [group.id]: option.id }))}
                              className="text-zinc-400 hover:text-zinc-700 p-1 rounded"
                              aria-label="Edit option"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => setConfirmOptionId({ groupId: group.id, optionId: option.id })}
                              className="text-zinc-400 hover:text-red-600 p-1 rounded"
                              aria-label="Delete option"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* + Add option button for this group */}
              {canManage && expandedOption[group.id] == null && (
                <div className="px-4 py-2 border-t border-zinc-100">
                  <button
                    disabled={expandedOption[group.id] !== null}
                    onClick={() => setExpandedOption(prev => ({ ...prev, [group.id]: 'new' }))}
                    className="text-sm text-zinc-500 hover:text-zinc-900 flex items-center gap-1 disabled:opacity-40"
                  >
                    <Plus size={13} /> Add option
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
