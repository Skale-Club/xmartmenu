'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatPrice } from '@/lib/utils'
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Product, ProductOption, OptionGroupType, Ingredient, ProductIngredient } from '@/types/database'
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
  ingredientCustomizationEnabled?: boolean
  allIngredients?: Ingredient[]
  initialProductIngredients?: ProductIngredient[]
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

export default function ProductDetailClient({
  product,
  initialGroups,
  tenantId: _tenantId,
  currency,
  canManage,
  ingredientCustomizationEnabled = false,
  allIngredients = [],
  initialProductIngredients = [],
}: Props) {
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

  // Tab state
  const [activeTab, setActiveTab] = useState<'details' | 'options' | 'ingredients'>('details')

  // Ingredient tab state
  const [productIngredients, setProductIngredients] = useState<ProductIngredient[]>(initialProductIngredients)
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [ingLoading, setIngLoading] = useState<string | null>(null)

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

  async function handleAddIngredient(ingredientId: string) {
    setIngLoading(ingredientId)
    const { data, error } = await supabase
      .from('product_ingredients')
      .insert({
        product_id: product.id,
        ingredient_id: ingredientId,
        tenant_id: _tenantId,
        is_default: false,
        extra_price_override: null,
        add_price_override: null,
        position: productIngredients.length,
      })
      .select()
      .single()
    if (!error && data) setProductIngredients(prev => [...prev, data as ProductIngredient])
    setIngLoading(null)
  }

  async function handleRemoveIngredient(ingredientId: string) {
    setIngLoading(ingredientId)
    const { error } = await supabase
      .from('product_ingredients')
      .delete()
      .eq('product_id', product.id)
      .eq('ingredient_id', ingredientId)
    if (!error) setProductIngredients(prev => prev.filter(pi => pi.ingredient_id !== ingredientId))
    setIngLoading(null)
  }

  async function handleUpdateProductIngredient(
    ingredientId: string,
    patch: Partial<Pick<ProductIngredient, 'is_default' | 'extra_price_override' | 'add_price_override'>>
  ) {
    const { error } = await supabase
      .from('product_ingredients')
      .update(patch)
      .eq('product_id', product.id)
      .eq('ingredient_id', ingredientId)
    if (!error) {
      setProductIngredients(prev =>
        prev.map(pi => pi.ingredient_id === ingredientId ? { ...pi, ...patch } : pi)
      )
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

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-zinc-200">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-lg ${
            activeTab === 'details'
              ? 'bg-white border border-b-white border-zinc-200 -mb-px text-zinc-900'
              : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setActiveTab('options')}
          className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-lg ${
            activeTab === 'options'
              ? 'bg-white border border-b-white border-zinc-200 -mb-px text-zinc-900'
              : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          Options
        </button>
        {ingredientCustomizationEnabled && (
          <button
            onClick={() => setActiveTab('ingredients')}
            className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-lg ${
              activeTab === 'ingredients'
                ? 'bg-white border border-b-white border-zinc-200 -mb-px text-zinc-900'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Ingredients
          </button>
        )}
      </div>

      {/* Product fields card shown only on Details tab */}
      {activeTab === 'details' && (
      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-6 mb-8">
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
      )}

      {/* Option Groups card shown only on Options tab */}
      {activeTab === 'options' && (
      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-6">
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
          <div className="border border-zinc-200 rounded-lg p-4 mb-3 bg-zinc-50">
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
            <div key={group.id} className="border border-zinc-200 rounded-lg overflow-hidden">
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
      )}

      {/* Ingredients tab shown only when flag is on and tab is active */}
      {activeTab === 'ingredients' && ingredientCustomizationEnabled && (
        <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-zinc-900">Ingredients</h2>
          </div>

          {/* Search / picker */}
          <div className="mb-4">
            <input
              type="text"
              value={ingredientSearch}
              onChange={e => setIngredientSearch(e.target.value)}
              placeholder="Search ingredient..."
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>

          {/* Catalog list | unselected ingredients (available for adding) */}
          {(() => {
            const selectedIds = new Set(productIngredients.map(pi => pi.ingredient_id))
            const filtered = allIngredients.filter(ing =>
              !selectedIds.has(ing.id) &&
              ing.name.toLowerCase().includes(ingredientSearch.toLowerCase())
            )
            return filtered.length > 0 ? (
              <div className="mb-6">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Catalog</p>
                <div className="space-y-1">
                  {filtered.map(ing => (
                    <div key={ing.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-zinc-100 hover:border-zinc-300 transition-colors">
                      <span className="text-sm text-zinc-700">{ing.name}</span>
                      {canManage && (
                        <button
                          onClick={() => handleAddIngredient(ing.id)}
                          disabled={ingLoading === ing.id}
                          className="text-xs px-3 py-1 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors flex items-center gap-1"
                        >
                          <Plus size={12} /> Add
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null
          })()}

          {/* Selected ingredients | product associations */}
          {productIngredients.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Product ingredients</p>
              <div className="space-y-3">
                {productIngredients.map(pi => {
                  const ing = allIngredients.find(i => i.id === pi.ingredient_id)
                  if (!ing) return null
                  return (
                    <div key={pi.ingredient_id} className="border border-zinc-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-zinc-900">{ing.name}</span>
                        {canManage && (
                          <button
                            onClick={() => handleRemoveIngredient(pi.ingredient_id)}
                            disabled={ingLoading === pi.ingredient_id}
                            className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            Remove ingredient
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {/* is_default toggle */}
                        <div className="col-span-2 flex items-center gap-3">
                          <label className="text-sm text-zinc-600">Product default</label>
                          <button
                            type="button"
                            disabled={!canManage || ingLoading === pi.ingredient_id}
                            onClick={() => handleUpdateProductIngredient(pi.ingredient_id, { is_default: !pi.is_default })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                              pi.is_default ? 'bg-zinc-900' : 'bg-zinc-200'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              pi.is_default ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                        {/* extra_price_override */}
                        <div>
                          <label className="block text-xs font-medium text-zinc-600 mb-1">Extra price for this product</label>
                          <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                            <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
                              {CURRENCY_SYMBOL[currency] ?? currency}
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!canManage}
                              defaultValue={pi.extra_price_override !== null ? String(pi.extra_price_override) : ''}
                              placeholder={`Default: ${(CURRENCY_SYMBOL[currency] ?? currency)}${ing.default_extra_price.toFixed(2)}`}
                              onBlur={e => {
                                const val = e.target.value
                                handleUpdateProductIngredient(pi.ingredient_id, {
                                  extra_price_override: val !== '' ? parseFloat(val) : null,
                                })
                              }}
                              className="flex-1 px-3 py-2 text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                        {/* add_price_override */}
                        <div>
                          <label className="block text-xs font-medium text-zinc-600 mb-1">Add-on price for this product</label>
                          <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                            <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">
                              {CURRENCY_SYMBOL[currency] ?? currency}
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!canManage}
                              defaultValue={pi.add_price_override !== null ? String(pi.add_price_override) : ''}
                              placeholder={`Default: ${(CURRENCY_SYMBOL[currency] ?? currency)}${ing.default_add_price.toFixed(2)}`}
                              onBlur={e => {
                                const val = e.target.value
                                handleUpdateProductIngredient(pi.ingredient_id, {
                                  add_price_override: val !== '' ? parseFloat(val) : null,
                                })
                              }}
                              className="flex-1 px-3 py-2 text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {productIngredients.length === 0 && (
            <div className="text-center py-12 text-zinc-400">
              <p className="font-medium text-zinc-500">No ingredients associated</p>
              <p className="text-sm mt-1">Search and add ingredients from the catalog above</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
