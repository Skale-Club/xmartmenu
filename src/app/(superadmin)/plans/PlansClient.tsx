'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Plan {
  id: string
  name: string
  slug: string
  description: string | null
  monthly_price: number
  annual_price: number
  transaction_fee_pct: number
  features: string[]
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

interface PlanFormData {
  name: string
  description: string
  monthly_price: string
  annual_price: string
  transaction_fee_pct: string
  features: string
  is_active: boolean
  sort_order: string
}

const DEFAULT_FORM: PlanFormData = {
  name: '',
  description: '',
  monthly_price: '',
  annual_price: '',
  transaction_fee_pct: '',
  features: '',
  is_active: true,
  sort_order: '',
}

export default function PlansClient({ plans: initialPlans }: { plans: Plan[] }) {
  const [plans, setPlans] = useState(initialPlans)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<PlanFormData>(DEFAULT_FORM)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<PlanFormData>(DEFAULT_FORM)

  const [confirmDelete, setConfirmDelete] = useState<Plan | null>(null)
  const [toggleActive, setToggleActive] = useState<{ id: string; current: boolean } | null>(null)

  const router = useRouter()

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'

  function startEdit(plan: Plan) {
    setEditingId(plan.id)
    setEditForm({
      name: plan.name,
      description: plan.description ?? '',
      monthly_price: plan.monthly_price.toString(),
      annual_price: plan.annual_price.toString(),
      transaction_fee_pct: plan.transaction_fee_pct.toString(),
      features: plan.features.join(', '),
      is_active: plan.is_active,
      sort_order: plan.sort_order.toString(),
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(DEFAULT_FORM)
  }

  async function handleSaveEdit(id: string) {
    setLoading(true)
    setError(null)

    const res = await fetch(`/api/superadmin/plans/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description || null,
        monthly_price: parseFloat(editForm.monthly_price) || 0,
        annual_price: parseFloat(editForm.annual_price) || 0,
        transaction_fee_pct: parseFloat(editForm.transaction_fee_pct) || 0,
        features: editForm.features.split(',').map(f => f.trim()).filter(Boolean),
        is_active: editForm.is_active,
        sort_order: parseInt(editForm.sort_order) || 0,
      }),
    })

    if (res.ok) {
      const updated = await res.json()
      setPlans(plans.map(p => p.id === id ? { ...p, ...updated } : p))
      setEditingId(null)
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to update plan')
    }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/superadmin/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        description: form.description || null,
        monthly_price: parseFloat(form.monthly_price) || 0,
        annual_price: parseFloat(form.annual_price) || 0,
        transaction_fee_pct: parseFloat(form.transaction_fee_pct) || 0,
        features: form.features.split(',').map(f => f.trim()).filter(Boolean),
        is_active: form.is_active,
        sort_order: parseInt(form.sort_order) || 0,
      }),
    })

    if (res.ok) {
      const newPlan = await res.json()
      setPlans([...plans, newPlan].sort((a, b) => a.sort_order - b.sort_order))
      setShowForm(false)
      setForm(DEFAULT_FORM)
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to create plan')
    }
    setLoading(false)
  }

  async function handleDelete(plan: Plan) {
    setLoading(true)
    setError(null)

    const res = await fetch(`/api/superadmin/plans/${plan.id}`, {
      method: 'DELETE',
    })

    if (res.ok) {
      setPlans(plans.filter(p => p.id !== plan.id))
      setConfirmDelete(null)
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to delete plan')
    }
    setLoading(false)
  }

  async function handleToggleActive(plan: Plan) {
    setLoading(true)
    setError(null)

    const res = await fetch(`/api/superadmin/plans/${plan.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !plan.is_active }),
    })

    if (res.ok) {
      const updated = await res.json()
      setPlans(plans.map(p => p.id === plan.id ? { ...p, is_active: updated.is_active } : p))
      setToggleActive(null)
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to update plan')
    }
    setLoading(false)
  }

  function formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
  }

  function formatFee(pct: number): string {
    return `${pct}%`
  }

  return (
    <div className="p-8">
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete plan"
        message={`Delete "${confirmDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Plans</h1>
          <p className="text-sm text-zinc-500 mt-1">{plans.length} plan(s)</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(null) }}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + New plan
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-6 max-w-2xl">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">New plan</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Menu"
                  className={input}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Plan description"
                  className={input}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Monthly Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.monthly_price}
                  onChange={e => setForm(f => ({ ...f, monthly_price: e.target.value }))}
                  placeholder="49.00"
                  className={input}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Annual Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.annual_price}
                  onChange={e => setForm(f => ({ ...f, annual_price: e.target.value }))}
                  placeholder="490.00"
                  className={input}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Transaction Fee (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.transaction_fee_pct}
                  onChange={e => setForm(f => ({ ...f, transaction_fee_pct: e.target.value }))}
                  placeholder="0.00"
                  className={input}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  min="0"
                  value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0"
                  className={input}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Features (comma-separated)</label>
              <input
                value={form.features}
                onChange={e => setForm(f => ({ ...f, features: e.target.value }))}
                placeholder="Unlimited menus, Custom branding, Priority support"
                className={input}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="new-plan-active"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
              />
              <label htmlFor="new-plan-active" className="text-sm text-zinc-700">Active</label>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating...' : 'Create plan'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans grid */}
      <div className="grid gap-4">
        {plans.map(plan => (
          <div key={plan.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-zinc-900">{plan.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    plan.is_active ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'
                  }`}>
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {plan.description && (
                  <p className="text-xs text-zinc-400 mt-0.5">{plan.description}</p>
                )}
              </div>

              <div className="text-right">
                <p className="text-sm font-semibold text-zinc-900">{formatPrice(plan.monthly_price)}/mo</p>
                <p className="text-xs text-zinc-500">{formatPrice(plan.annual_price)}/yr</p>
              </div>

              <div className="text-right">
                <p className="text-xs text-zinc-500">Transaction Fee</p>
                <p className="text-sm font-medium text-zinc-700">{formatFee(plan.transaction_fee_pct)}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(plan)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setToggleActive({ id: plan.id, current: plan.is_active })}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    plan.is_active
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {plan.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => setConfirmDelete(plan)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Features */}
            {plan.features.length > 0 && (
              <div className="border-t border-zinc-100 px-5 py-3 bg-zinc-50">
                <p className="text-xs text-zinc-400 mb-1">Features</p>
                <div className="flex flex-wrap gap-1.5">
                  {plan.features.map((feature, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 bg-white border border-zinc-200 rounded text-zinc-600">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Inline edit form */}
            {editingId === plan.id && (
              <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Edit plan</p>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Name</label>
                    <input
                      value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Monthly Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.monthly_price}
                      onChange={e => setEditForm(f => ({ ...f, monthly_price: e.target.value }))}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Annual Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.annual_price}
                      onChange={e => setEditForm(f => ({ ...f, annual_price: e.target.value }))}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Transaction Fee (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={editForm.transaction_fee_pct}
                      onChange={e => setEditForm(f => ({ ...f, transaction_fee_pct: e.target.value }))}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1">Sort Order</label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.sort_order}
                      onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div className="flex items-start gap-2 pt-7">
                    <input
                      type="checkbox"
                      id={`edit-plan-active-${plan.id}`}
                      checked={editForm.is_active}
                      onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                    />
                    <label htmlFor={`edit-plan-active-${plan.id}`} className="text-sm text-zinc-700">Active</label>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Features (comma-separated)</label>
                  <input
                    value={editForm.features}
                    onChange={e => setEditForm(f => ({ ...f, features: e.target.value }))}
                    placeholder="Feature 1, Feature 2"
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleSaveEdit(plan.id)}
                    disabled={loading}
                    className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Saving...' : 'Save changes'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {plans.length === 0 && !showForm && (
        <div className="text-center py-12 text-zinc-400 text-sm">
          No plans yet. Create your first plan to get started.
        </div>
      )}
    </div>
  )
}