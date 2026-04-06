'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/utils'
import type { Product, Category } from '@/types/database'

interface ProductWithCategory extends Product {
  category: { id: string; name: string } | null
}

interface Props {
  products: ProductWithCategory[]
  categories: Pick<Category, 'id' | 'name'>[]
  tenantId: string
}

const TAGS = ['Vegetariano', 'Vegano', 'Sem Glúten', 'Picante', 'Destaque do chef']

export default function ProductsClient({ products: initial, categories, tenantId }: Props) {
  const [products, setProducts] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('all')

  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    original_price: '',
    category_id: '',
    image_url: '',
    is_featured: false,
    tags: [] as string[],
  })

  const supabase = createClient()
  const router = useRouter()

  const filtered = filterCategory === 'all'
    ? products
    : products.filter(p => p.category_id === filterCategory)

  function resetForm() {
    setForm({ name: '', description: '', price: '', original_price: '', category_id: '', image_url: '', is_featured: false, tags: [] })
    setEditingId(null)
    setShowForm(false)
  }

  function startEdit(p: ProductWithCategory) {
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      original_price: p.original_price ? String(p.original_price) : '',
      category_id: p.category_id ?? '',
      image_url: p.image_url ?? '',
      is_featured: p.is_featured,
      tags: p.tags ?? [],
    })
    setEditingId(p.id)
    setShowForm(true)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)

    const ext = file.name.split('.').pop()
    const filename = `${tenantId}/${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(filename, file, { upsert: true })

    if (!error && data) {
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path)
      setForm(f => ({ ...f, image_url: publicUrl }))
    }
    setUploadingImage(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const payload = {
      tenant_id: tenantId,
      name: form.name,
      description: form.description || null,
      price: parseFloat(form.price),
      original_price: form.original_price ? parseFloat(form.original_price) : null,
      category_id: form.category_id || null,
      image_url: form.image_url || null,
      is_featured: form.is_featured,
      tags: form.tags,
      position: editingId ? undefined : products.length,
    }

    if (editingId) {
      const { data } = await supabase
        .from('products')
        .update(payload)
        .eq('id', editingId)
        .select('*, category:categories(id, name)')
        .single()
      if (data) setProducts(products.map(p => p.id === editingId ? data : p))
    } else {
      const { data } = await supabase
        .from('products')
        .insert(payload)
        .select('*, category:categories(id, name)')
        .single()
      if (data) setProducts([...products, data])
    }

    resetForm()
    setLoading(false)
    router.refresh()
  }

  async function toggleAvailable(id: string, current: boolean) {
    await supabase.from('products').update({ is_available: !current }).eq('id', id)
    setProducts(products.map(p => p.id === id ? { ...p, is_available: !current } : p))
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este produto?')) return
    await supabase.from('products').delete().eq('id', id)
    setProducts(products.filter(p => p.id !== id))
  }

  function toggleTag(tag: string) {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag]
    }))
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Produtos</h1>
          <p className="text-sm text-zinc-500 mt-1">{products.length} produto(s) cadastrado(s)</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + Novo produto
        </button>
      </div>

      {/* Filtro por categoria */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilterCategory('all')}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filterCategory === 'all' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
        >
          Todos
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setFilterCategory(cat.id)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filterCategory === cat.id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-6">
          <h2 className="text-base font-semibold text-zinc-900 mb-5">
            {editingId ? 'Editar produto' : 'Novo produto'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-zinc-700 mb-1">Nome *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: X-Burguer Clássico"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-zinc-700 mb-1">Descrição</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Ingredientes, detalhes do preparo..."
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Preço *</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="29.90"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Preço original (de)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.original_price}
                  onChange={e => setForm(f => ({ ...f, original_price: e.target.value }))}
                  placeholder="39.90"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Categoria</label>
                <select
                  value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 bg-white"
                >
                  <option value="">Sem categoria</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Imagem</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="w-full text-sm text-zinc-600 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
                />
                {uploadingImage && <p className="text-xs text-zinc-400 mt-1">Enviando imagem...</p>}
                {form.image_url && <p className="text-xs text-green-600 mt-1">Imagem carregada</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">Tags</label>
              <div className="flex flex-wrap gap-2">
                {TAGS.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      form.tags.includes(tag)
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))}
                className="w-4 h-4 rounded border-zinc-300"
              />
              <span className="text-sm text-zinc-700">Produto em destaque</span>
            </label>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Salvando...' : 'Salvar produto'}
              </button>
              <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de produtos */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-4xl mb-3">🍽️</p>
          <p className="font-medium">Nenhum produto ainda</p>
          <p className="text-sm mt-1">Adicione produtos para montar seu cardápio</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((product) => (
            <div key={product.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-4">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-zinc-100 flex items-center justify-center text-2xl flex-shrink-0">
                  🍽️
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-zinc-900">{product.name}</p>
                  {product.is_featured && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Destaque</span>
                  )}
                  {product.tags?.map(tag => (
                    <span key={tag} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{tag}</span>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{product.category?.name ?? 'Sem categoria'}</p>
                <div className="flex items-center gap-2 mt-1">
                  {product.original_price && (
                    <span className="text-xs text-zinc-400 line-through">{formatPrice(product.original_price)}</span>
                  )}
                  <span className="text-sm font-bold text-zinc-900">{formatPrice(product.price)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleAvailable(product.id, product.is_available)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    product.is_available
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                  }`}
                >
                  {product.is_available ? 'Disponível' : 'Indisponível'}
                </button>
                <button
                  onClick={() => startEdit(product)}
                  className="text-xs px-3 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(product.id)}
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
