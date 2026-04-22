'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/utils'
import type { Product, Category } from '@/types/database'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface ProductWithCategory extends Product {
  category: { id: string; name: string } | null
}

const DEFAULT_TAGS = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Spicy', 'Chef\'s special']

const TAG_COLORS: Record<string, string> = {
  'Vegetarian': 'bg-green-100 text-green-700',
  'Vegetariano': 'bg-green-100 text-green-700',
  'Vegan': 'bg-emerald-100 text-emerald-700',
  'Vegano': 'bg-emerald-100 text-emerald-700',
  'Gluten-Free': 'bg-amber-100 text-amber-700',
  'Sem Glúten': 'bg-amber-100 text-amber-700',
  'Spicy': 'bg-red-100 text-red-700',
  'Picante': 'bg-red-100 text-red-700',
  'Chef\'s special': 'bg-purple-100 text-purple-700',
  'Especial do Chef': 'bg-purple-100 text-purple-700',
}

function getTagStyle(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-zinc-100 text-zinc-600'
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', BRL: 'R$', EUR: '€', GBP: '£',
  CAD: 'CA$', AUD: 'A$', MXN: 'MX$', ARS: '$', CLP: '$', COP: '$',
}

interface Props {
  products: ProductWithCategory[]
  categories: Pick<Category, 'id' | 'name'>[]
  tenantId: string
  menuId: string | null
  activeMenuName: string | null
  availableTags?: string[]
  currency?: string
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

export default function ProductsClient({ products: initial, categories, tenantId, menuId, activeMenuName, availableTags, currency = 'BRL' }: Props) {
  const TAGS = availableTags?.length ? availableTags : DEFAULT_TAGS
  const [products, setProducts] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [supportsImageUrls, setSupportsImageUrls] = useState(true)

  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    original_price: '',
    category_id: '',
    image_url: '',
    image_urls: [] as string[],
    is_featured: false,
    tags: [] as string[],
  })

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    setProducts(initial)
    setFilterCategory('all')
    setConfirmId(null)
    resetForm()
  }, [initial, menuId])

  const filtered = filterCategory === 'all'
    ? products
    : products.filter(p => p.category_id === filterCategory)

  function getProductImages(product: ProductWithCategory) {
    if (product.image_urls && product.image_urls.length > 0) return product.image_urls
    return product.image_url ? [product.image_url] : []
  }

  function isImageUrlsSchemaError(message?: string) {
    if (!message) return false
    const normalized = message.toLowerCase()
    return normalized.includes('image_urls') && normalized.includes('schema cache')
  }

  function resetForm() {
    setForm({
      name: '',
      description: '',
      price: '',
      original_price: '',
      category_id: '',
      image_url: '',
      image_urls: [],
      is_featured: false,
      tags: [],
    })
    setEditingId(null)
    setShowForm(false)
    setFormError(null)
    setUploadingImage(false)
  }

  function startEdit(p: ProductWithCategory) {
    const images = getProductImages(p)
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      original_price: p.original_price ? String(p.original_price) : '',
      category_id: p.category_id ?? '',
      image_url: images[0] ?? '',
      image_urls: images,
      is_featured: p.is_featured,
      tags: p.tags ?? [],
    })
    setEditingId(p.id)
    setFormError(null)
    setShowForm(true)
  }

  function openCreateForm() {
    resetForm()
    setShowForm(true)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploadingImage(true)

    const uploadedUrls: string[] = []

    for (const file of files) {
      const ext = file.name.split('.').pop()
      const filename = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filename, file, { upsert: true })

      if (!error && data) {
        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(data.path)
        uploadedUrls.push(publicUrl)
      }
    }

    if (uploadedUrls.length > 0) {
      setForm(f => {
        const imageUrls = [...f.image_urls, ...uploadedUrls]
        return { ...f, image_urls: imageUrls, image_url: imageUrls[0] ?? '' }
      })
    }

    e.target.value = ''
    setUploadingImage(false)
  }

  function removeImageAt(index: number) {
    setForm(f => {
      const next = f.image_urls.filter((_, i) => i !== index)
      return { ...f, image_urls: next, image_url: next[0] ?? '' }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setFormError(null)

    const payload = {
      tenant_id: tenantId,
      menu_id: menuId,
      name: form.name,
      description: form.description || null,
      price: parseFloat(form.price),
      original_price: form.original_price ? parseFloat(form.original_price) : null,
      category_id: form.category_id || null,
      image_url: form.image_urls[0] || form.image_url || null,
      image_urls: form.image_urls,
      is_featured: form.is_featured,
      tags: form.tags,
      position: editingId ? undefined : products.length,
    }
    const payloadWithoutImageUrls = (() => {
      const { image_urls: _drop, ...rest } = payload
      return rest
    })()

    if (editingId) {
      let { data, error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', editingId)
        .select('*, category:categories(id, name)')
        .single()
      if (error && isImageUrlsSchemaError(error.message)) {
        setSupportsImageUrls(false)
        ;({ data, error } = await supabase
          .from('products')
          .update(payloadWithoutImageUrls)
          .eq('id', editingId)
          .select('*, category:categories(id, name)')
          .single())
      }
      if (error) { setFormError(error.message); setLoading(false); return }
      if (data) setProducts(products.map(p => p.id === editingId ? data : p))
    } else {
      let { data, error } = await supabase
        .from('products')
        .insert(payload)
        .select('*, category:categories(id, name)')
        .single()
      if (error && isImageUrlsSchemaError(error.message)) {
        setSupportsImageUrls(false)
        ;({ data, error } = await supabase
          .from('products')
          .insert(payloadWithoutImageUrls)
          .select('*, category:categories(id, name)')
          .single())
      }
      if (error) { setFormError(error.message); setLoading(false); return }
      if (data) setProducts([...products, data])
    }

    resetForm()
    setLoading(false)
  }

  async function toggleAvailable(id: string, current: boolean) {
    await supabase.from('products').update({ is_available: !current }).eq('id', id)
    setProducts(products.map(p => p.id === id ? { ...p, is_available: !current } : p))
  }

  async function confirmDelete() {
    if (!confirmId) return
    await supabase.from('products').delete().eq('id', confirmId)
    setProducts(products.filter(p => p.id !== confirmId))
    setConfirmId(null)
  }

  function toggleTag(tag: string) {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag]
    }))
  }

  return (
    <div className="p-8">
      <ConfirmDialog
        open={!!confirmId}
        title="Delete product"
        message="Delete this product? This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Produtos</h1>
          <p className="text-sm text-zinc-500 mt-1">{products.length} product(s){activeMenuName ? ` · Menu: ${activeMenuName}` : ''}</p>
        </div>
        <button
          onClick={openCreateForm}
          disabled={!menuId}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          + New product
        </button>
      </div>

      {!menuId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-700">
          No menu selected. Choose a menu in the sidebar to manage its products.
        </div>
      )}

      {/* Filtro por categoria */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilterCategory('all')}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filterCategory === 'all' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
        >
          All
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

      <Modal open={showForm && !!menuId} title={editingId ? 'Edit product' : 'New product'} onClose={resetForm}>
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-zinc-700 mb-1">Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Classic Cheeseburger"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Ingredients, preparation details..."
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Price *</label>
                <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                  <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">{CURRENCY_SYMBOL[currency] ?? currency}</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="29.90"
                    className="flex-1 px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Original price (was)</label>
                <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-zinc-900">
                  <span className="px-3 py-2 bg-zinc-50 text-sm text-zinc-500 border-r border-zinc-300 select-none">{CURRENCY_SYMBOL[currency] ?? currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.original_price}
                    onChange={e => setForm(f => ({ ...f, original_price: e.target.value }))}
                    placeholder="39.90"
                    className="flex-1 px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Category</label>
                <select
                  value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 bg-white"
                >
                  <option value="">No category</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Images</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple={supportsImageUrls}
                  onChange={handleImageUpload}
                  className="w-full text-sm text-zinc-600 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
                />
                {uploadingImage && <p className="text-xs text-zinc-400 mt-1">Uploading image(s)...</p>}
                {!supportsImageUrls && <p className="text-xs text-amber-600 mt-1">Multiple images disabled for this database (missing `image_urls` column).</p>}
                {form.image_urls.length > 0 && (
                  <p className="text-xs text-green-600 mt-1">{form.image_urls.length} image(s) uploaded</p>
                )}
              </div>
            </div>
            {form.image_urls.length > 0 && (
              <div>
                <p className="text-sm font-medium text-zinc-700 mb-2">Preview</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {form.image_urls.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="relative flex-shrink-0">
                      <img src={url} alt={`Image ${idx + 1}`} className="w-16 h-16 rounded-lg object-cover border border-zinc-200" />
                      <button
                        type="button"
                        onClick={() => removeImageAt(idx)}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-black text-white text-xs leading-5"
                        aria-label={`Remove image ${idx + 1}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                        ? getTagStyle(tag).replace('bg-', 'bg-').replace('text-', 'text-') + ' border-transparent'
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
              <span className="text-sm text-zinc-700">Featured product</span>
            </label>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving...' : 'Save product'}
              </button>
              <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
                Cancel
              </button>
            </div>
        </form>
      </Modal>

      {/* Lista de produtos */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-4xl mb-3">🍽️</p>
          <p className="font-medium">No products yet</p>
          <p className="text-sm mt-1">Add products to build your menu</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((product) => (
            <div key={product.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-4">
              {getProductImages(product)[0] ? (
                <img
                  src={getProductImages(product)[0]}
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
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Featured</span>
                  )}
                  {product.tags?.map(tag => (
                    <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${getTagStyle(tag)}`}>{tag}</span>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{product.category?.name ?? 'No category'}</p>
                {getProductImages(product).length > 1 && (
                  <p className="text-xs text-zinc-400 mt-0.5">{getProductImages(product).length} photos</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {product.original_price && (
                    <span className="text-xs text-zinc-400 line-through">{formatPrice(product.original_price, currency)}</span>
                  )}
                  <span className="text-sm font-bold text-zinc-900">{formatPrice(product.price, currency)}</span>
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
                  {product.is_available ? 'Available' : 'Unavailable'}
                </button>
                <button
                  onClick={() => startEdit(product)}
                  className="text-xs px-3 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmId(product.id)}
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
