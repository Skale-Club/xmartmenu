'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type { Category } from '@/types/database'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Plus, LayoutGrid, Trash2, Edit3, X, ChevronRight, AlertCircle, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  categories: Category[]
  tenantId: string
  menuId: string | null
  activeMenuName: string | null
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-white rounded-lg border border-zinc-200 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-950 tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors"><X className="w-5 h-5 text-zinc-400" /></button>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  )
}

export default function CategoriesClient({ categories: initial, tenantId, menuId, activeMenuName, canManage }: Props) {
  const [categories, setCategories] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    setCategories(initial)
    setShowForm(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setError(null)
    setConfirmId(null)
  }, [initial, menuId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (editingId) {
      const res = await fetch(`/api/admin/categories/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); setLoading(false); return }
      setCategories(categories.map(c => c.id === editingId ? data : c))
      setEditingId(null)
    } else {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, position: categories.length, menu_id: menuId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); setLoading(false); return }
      setCategories([...categories, data])
    }

    setName('')
    setDescription('')
    setShowForm(false)
    setLoading(false)
  }

  async function toggleActive(id: string, current: boolean) {
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
    if (res.ok) setCategories(categories.map(c => c.id === id ? { ...c, is_active: !current } : c))
  }

  async function confirmDelete() {
    if (!confirmId) return
    const res = await fetch(`/api/admin/categories/${confirmId}`, { method: 'DELETE' })
    if (res.ok) {
      setCategories(categories.filter(c => c.id !== confirmId))
    } else {
      const data = await res.json()
      setError(data.error)
    }
    setConfirmId(null)
  }

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setName(cat.name)
    setDescription(cat.description ?? '')
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setError(null)
  }

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"

  return (
    <div className="p-8 w-full space-y-8">
      <ConfirmDialog
        open={canManage && !!confirmId}
        title="Delete category"
        message="Delete this category? Products will not be deleted."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <LayoutGrid className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Structure</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Categories</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">
            {categories.length} organized groups {activeMenuName ? `for ${activeMenuName}` : ''}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => {
              setEditingId(null)
              setName('')
              setDescription('')
              setShowForm(true)
            }}
            disabled={!menuId}
            className="bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest shadow-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            New Category
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-6 py-4 text-sm font-bold text-red-600 flex justify-between items-center">
          {error}
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-full transition-colors"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {!menuId && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-6 py-4 text-sm font-bold text-amber-700 flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            No menu selected. Choose a menu in the sidebar to manage categories.
          </div>
        )}
        {!canManage && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-6 py-4 text-sm font-bold text-blue-700 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5" />
            Staff access: view only mode.
          </div>
        )}
      </div>

      <Modal open={canManage && showForm && !!menuId} title={editingId ? 'Refine Category' : 'Create Category'} onClose={cancelForm}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Category Name *</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Starters, Main courses, Drinks"
              className={inputClassName}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Short Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Display text for customers (optional)"
              className={inputClassName}
            />
          </div>
          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Save Category'}
            </button>
            <button type="button" onClick={cancelForm} className="px-8 py-4 rounded-full text-base font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
          <div className="w-20 h-20 bg-white rounded-lg flex items-center justify-center shadow-sm mb-6">
            <LayoutGrid className="w-10 h-10 text-zinc-200" />
          </div>
          <h3 className="text-xl font-black text-zinc-950 mb-2">No categories defined</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto font-medium">Start organizing your menu by creating your first category today.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
          {categories.map((cat) => (
            <div key={cat.id} className="group bg-white border border-zinc-100 rounded-lg p-8 transition-all duration-300 hover:border-primary hover:shadow-xl hover:shadow-primary/5 flex flex-col justify-between min-h-[160px]">
              <div>
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h3 className="text-xl font-black text-zinc-950 tracking-tight leading-tight">{cat.name}</h3>
                  <button
                    onClick={() => toggleActive(cat.id, cat.is_active)}
                    className={cn(
                      "text-[9px] px-2.5 py-1 rounded-full font-black uppercase tracking-widest transition-all",
                      cat.is_active 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-zinc-100 text-zinc-400"
                    )}
                  >
                    {cat.is_active ? 'Active' : 'Hidden'}
                  </button>
                </div>
                {cat.description && <p className="text-sm font-medium text-zinc-500 line-clamp-2">{cat.description}</p>}
              </div>

              {canManage && (
                <div className="flex items-center justify-end gap-2 mt-6 pt-6 border-t border-zinc-50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(cat)}
                    className="p-3 rounded-lg border border-zinc-100 text-zinc-400 hover:text-zinc-950 hover:bg-zinc-50 transition-all"
                    title="Edit Category"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmId(cat.id)}
                    className="p-3 rounded-lg border border-red-50 text-red-200 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Delete Category"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button className="ml-2 w-10 h-10 rounded-full bg-zinc-950 flex items-center justify-center text-primary hover:scale-110 transition-transform">
                    <ChevronRight className="w-5 h-5" />
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
