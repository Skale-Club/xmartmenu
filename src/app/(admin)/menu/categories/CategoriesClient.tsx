'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type { Category } from '@/types/database'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Props {
  categories: Category[]
  tenantId: string
  menuId: string | null
  activeMenuName: string | null
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
      <div className="w-full max-w-lg bg-white rounded-xl border border-zinc-200 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-800">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export default function CategoriesClient({ categories: initial, tenantId, menuId, activeMenuName }: Props) {
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

  return (
    <div className="p-8">
      <ConfirmDialog
        open={!!confirmId}
        title="Delete category"
        message="Delete this category? Products will not be deleted."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Categorias</h1>
          <p className="text-sm text-zinc-500 mt-1">{categories.length} category(ies){activeMenuName ? ` · Menu: ${activeMenuName}` : ''}</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null)
            setName('')
            setDescription('')
            setShowForm(true)
          }}
          disabled={!menuId}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + New category
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {!menuId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-700">
          No menu selected. Choose a menu in the sidebar to manage its categories.
        </div>
      )}

      <Modal open={showForm && !!menuId} title={editingId ? 'Edit category' : 'New category'} onClose={cancelForm}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Starters, Main courses, Drinks"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={cancelForm} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {categories.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-4xl mb-3">📂</p>
          <p className="font-medium">No categories yet</p>
          <p className="text-sm mt-1">Create categories to organize your menu</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-white border border-zinc-200 rounded-xl px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-900">{cat.name}</p>
                {cat.description && <p className="text-xs text-zinc-500 mt-0.5">{cat.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleActive(cat.id, cat.is_active)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    cat.is_active
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                  }`}
                >
                  {cat.is_active ? 'Active' : 'Inactive'}
                </button>
                <button
                  onClick={() => startEdit(cat)}
                  className="text-xs px-3 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmId(cat.id)}
                  className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
