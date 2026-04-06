'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Category } from '@/types/database'

interface Props {
  categories: Category[]
  tenantId: string
}

export default function CategoriesClient({ categories: initial, tenantId }: Props) {
  const [categories, setCategories] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    if (editingId) {
      const { data } = await supabase
        .from('categories')
        .update({ name, description })
        .eq('id', editingId)
        .select()
        .single()

      if (data) {
        setCategories(categories.map(c => c.id === editingId ? data : c))
      }
      setEditingId(null)
    } else {
      const position = categories.length
      const { data } = await supabase
        .from('categories')
        .insert({ tenant_id: tenantId, name, description, position })
        .select()
        .single()

      if (data) setCategories([...categories, data])
    }

    setName('')
    setDescription('')
    setShowForm(false)
    setLoading(false)
    router.refresh()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('categories').update({ is_active: !current }).eq('id', id)
    setCategories(categories.map(c => c.id === id ? { ...c, is_active: !current } : c))
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta categoria? Os produtos não serão deletados.')) return
    await supabase.from('categories').delete().eq('id', id)
    setCategories(categories.filter(c => c.id !== id))
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
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Categorias</h1>
          <p className="text-sm text-zinc-500 mt-1">{categories.length} categorias cadastradas</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + Nova categoria
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-6">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">
            {editingId ? 'Editar categoria' : 'Nova categoria'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome *</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Entradas, Pratos principais, Bebidas"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Descrição</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Opcional"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Salvando...' : 'Salvar'}
              </button>
              <button type="button" onClick={cancelForm} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-4xl mb-3">📂</p>
          <p className="font-medium">Nenhuma categoria ainda</p>
          <p className="text-sm mt-1">Crie categorias para organizar seu cardápio</p>
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
                  {cat.is_active ? 'Ativa' : 'Inativa'}
                </button>
                <button
                  onClick={() => startEdit(cat)}
                  className="text-xs px-3 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(cat.id)}
                  className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
