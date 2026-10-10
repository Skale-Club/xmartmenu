'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  CreditCard, 
  Plus, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  XCircle, 
  DollarSign, 
  Percent, 
  Trophy, 
  Calendar,
  Save,
  ChevronRight,
  ShieldCheck,
  AlertCircle
} from 'lucide-react'
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

  const router = useRouter()

  const input = 'w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-zinc-400'
  const label = 'block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 ml-1'

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

  function formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
  }

  return (
    <div className="p-8 w-full">
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Subscription Plan"
        message={`Are you sure you want to delete "${confirmDelete?.name}"? This will affect all future subscriptions using this plan.`}
        confirmLabel="Delete Plan"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3 mb-1">
            <CreditCard className="w-5 h-5 text-indigo-600" />
            <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Subscription Plans</h1>
          </div>
          <p className="text-sm text-zinc-500 font-medium">Manage tiers, pricing and platform features</p>
        </motion.div>
        
        <button
          onClick={() => { setShowForm(true); setError(null) }}
          className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-2xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Create New Plan
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 mb-8 text-sm text-red-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-10"
          >
            <div className="bg-white border border-zinc-200 rounded-3xl p-8 shadow-xl shadow-zinc-100">
              <h2 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Configure New Tier
              </h2>
              <form onSubmit={handleCreate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={label}>Plan Name *</label>
                    <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Professional" className={input} />
                  </div>
                  <div>
                    <label className={label}>Marketing Description</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Best for growing restaurants" className={input} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="relative">
                    <label className={label}>Monthly Price</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input type="number" step="0.01" min="0" value={form.monthly_price} onChange={e => setForm(f => ({ ...f, monthly_price: e.target.value }))} placeholder="49.00" className={input + ' pl-10'} />
                    </div>
                  </div>
                  <div className="relative">
                    <label className={label}>Annual Price</label>
                    <div className="relative">
                      <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input type="number" step="0.01" min="0" value={form.annual_price} onChange={e => setForm(f => ({ ...f, annual_price: e.target.value }))} placeholder="490.00" className={input + ' pl-10'} />
                    </div>
                  </div>
                  <div className="relative">
                    <label className={label}>Transaction Fee (%)</label>
                    <div className="relative">
                      <Percent className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input type="number" step="0.01" min="0" max="100" value={form.transaction_fee_pct} onChange={e => setForm(f => ({ ...f, transaction_fee_pct: e.target.value }))} placeholder="0.00" className={input + ' pl-10'} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className={label}>Features (Comma separated)</label>
                  <textarea rows={2} value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} placeholder="Unlimited Menus, Custom Domain, WhatsApp Orders, Priority Support" className={input + ' resize-none'} />
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-zinc-50">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" id="new-plan-active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-5 h-5 rounded-lg border-zinc-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer" />
                      <label htmlFor="new-plan-active" className="text-sm font-bold text-zinc-700 cursor-pointer">Live & Visible</label>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mr-2">Sort Order:</label>
                      <input type="number" min="0" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} placeholder="0" className="w-16 px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-xs focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-zinc-500 hover:bg-zinc-50 transition-all">Cancel</button>
                    <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-8 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100">
                      {loading ? 'Creating...' : 'Launch Plan'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {plans.map((plan, idx) => (
          <motion.div 
            key={plan.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.05 }}
            className={`group relative flex flex-col bg-white border border-zinc-200 rounded-[2rem] overflow-hidden shadow-sm hover:shadow-xl hover:shadow-zinc-100 transition-all duration-500 ${editingId === plan.id ? 'ring-2 ring-indigo-500 ring-offset-4' : ''}`}
          >
            <div className="p-8 flex-1">
              <div className="flex items-start justify-between mb-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-2xl font-black text-zinc-900 tracking-tight">{plan.name}</h3>
                    <div className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest ${
                      plan.is_active ? 'bg-green-50 text-green-600' : 'bg-zinc-100 text-zinc-400'
                    }`}>
                      {plan.is_active ? <ShieldCheck className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                  {plan.description && (
                    <p className="text-sm text-zinc-500 font-medium">{plan.description}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-zinc-900">{formatPrice(plan.monthly_price)}<span className="text-sm text-zinc-400 font-bold tracking-tight">/mo</span></div>
                  <p className="text-xs text-zinc-400 font-bold mt-1 uppercase tracking-tighter">or {formatPrice(plan.annual_price)} per year</p>
                </div>
              </div>

              <div className="bg-zinc-50/50 rounded-2xl p-5 mb-6 border border-zinc-100">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Included Features</p>
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-zinc-100">
                    <Percent className="w-3 h-3 text-indigo-500" />
                    <span className="text-xs font-black text-zinc-900">{plan.transaction_fee_pct}% Fee</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs font-bold text-zinc-600">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      {feature}
                    </div>
                  ))}
                  {plan.features.length === 0 && <p className="text-xs text-zinc-400 italic">No features listed</p>}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => startEdit(plan)} className="p-2.5 bg-zinc-100 text-zinc-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDelete(plan)} className="p-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-sm">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[10px] font-bold text-zinc-300 uppercase tracking-[0.2em]">Order: {plan.sort_order}</div>
              </div>
            </div>

            {/* Inline Edit Overlay */}
            <AnimatePresence>
              {editingId === plan.id && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute inset-0 z-10 bg-white p-8 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                      <Edit3 className="w-5 h-5 text-indigo-600" />
                      Editing Plan
                    </h3>
                    <button onClick={cancelEdit} className="p-2 hover:bg-zinc-100 rounded-full transition-colors"><Plus className="w-5 h-5 text-zinc-400 rotate-45" /></button>
                  </div>
                  
                  <div className="flex-1 space-y-4 overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className={label}>Name</label><input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={input} /></div>
                      <div><label className={label}>Monthly Price</label><input type="number" step="0.01" value={editForm.monthly_price} onChange={e => setEditForm(f => ({ ...f, monthly_price: e.target.value }))} className={input} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className={label}>Annual Price</label><input type="number" step="0.01" value={editForm.annual_price} onChange={e => setEditForm(f => ({ ...f, annual_price: e.target.value }))} className={input} /></div>
                      <div><label className={label}>Fee (%)</label><input type="number" step="0.01" value={editForm.transaction_fee_pct} onChange={e => setEditForm(f => ({ ...f, transaction_fee_pct: e.target.value }))} className={input} /></div>
                    </div>
                    <div><label className={label}>Features (CSV)</label><textarea rows={3} value={editForm.features} onChange={e => setEditForm(f => ({ ...f, features: e.target.value }))} className={input + ' resize-none'} /></div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id={`edit-plan-active-${plan.id}`} checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 rounded border-zinc-300 text-indigo-600" />
                        <label htmlFor={`edit-plan-active-${plan.id}`} className="text-xs font-bold text-zinc-700">Live</label>
                      </div>
                      <div className="flex-1">
                        <label className={label}>Sort</label>
                        <input type="number" value={editForm.sort_order} onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))} className={input} />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-6 mt-4 border-t border-zinc-100">
                    <button onClick={() => handleSaveEdit(plan.id)} disabled={loading} className="flex-1 bg-zinc-900 text-white py-3 rounded-2xl text-sm font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-zinc-200">
                      {loading ? '...' : <Save className="w-4 h-4" />}
                      Save Changes
                    </button>
                    <button onClick={cancelEdit} className="px-6 bg-zinc-100 text-zinc-500 py-3 rounded-2xl text-sm font-bold hover:bg-zinc-200 transition-all">Cancel</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>

      {plans.length === 0 && !showForm && (
        <div className="text-center py-32 bg-zinc-50/30 rounded-[3rem] border-2 border-dashed border-zinc-200">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-zinc-100 border border-zinc-100">
            <Trophy className="w-10 h-10 text-zinc-200" />
          </div>
          <h2 className="text-xl font-black text-zinc-900 tracking-tight">No subscription tiers found</h2>
          <p className="text-sm text-zinc-400 mt-2 font-medium">Create your first plan to start monetizing your platform.</p>
          <button onClick={() => setShowForm(true)} className="mt-8 bg-indigo-600 text-white px-8 py-3 rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100">
            Create First Plan
          </button>
        </div>
      )}
    </div>
  )
}