'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/utils'
import type { Product, Category } from '@/types/database'
import Image from 'next/image'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Plus, Package, Trash2, Edit3, X, ChevronRight, AlertCircle, ShieldCheck, Star, Utensils, Tag, Image as ImageIcon, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProductWithCategory extends Product {
  category: { id: string; name: string } | null
}

const DEFAULT_TAGS = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Spicy', 'Chef\'s special']

const TAG_COLORS: Record<string, string> = {
  'Vegetarian': 'bg-green-100 text-green-700',
  'Vegan': 'bg-emerald-100 text-emerald-700',
  'Gluten-Free': 'bg-amber-100 text-amber-700',
  'Spicy': 'bg-red-100 text-red-700',
  'Chef\'s special': 'bg-purple-100 text-purple-700',
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
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-xl border border-zinc-200 shadow-2xl">
        <div className="flex items-center justify-between px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-950 tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors"><X className="w-5 h-5 text-zinc-400" /></button>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  )
}

export default function ProductsClient({ products: initial, categories, tenantId, menuId, activeMenuName, availableTags, currency = 'USD', canManage }: Props) {
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
    setFormError(null)

    const uploadedUrls: string[] = []
    const uploadErrors: string[] = []

    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch('/api/admin/products/upload', { method: 'POST', body: fd })
      const json = await res.json() as { url?: string; error?: string }

      if (!res.ok || !json.url) {
        uploadErrors.push(`${file.name}: ${json.error ?? 'Upload failed'}`)
      } else {
        uploadedUrls.push(json.url)
      }
    }

    if (uploadErrors.length > 0) {
      setFormError(uploadErrors.join(' | '))
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

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"

  return (
    <div className="p-8 w-full space-y-8">
      <ConfirmDialog
        open={canManage && !!confirmId}
        title="Delete product"
        message="Delete this product? This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Inventory</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Products</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">
            {products.length} items registered {activeMenuName ? `for ${activeMenuName}` : ''}
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreateForm}
            disabled={!menuId}
            className="bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest shadow-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {!menuId && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-6 py-4 text-sm font-bold text-amber-700 flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            No menu selected. Choose a menu in the sidebar to manage products.
          </div>
        )}
        {!canManage && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-6 py-4 text-sm font-bold text-blue-700 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5" />
            Staff access: view only mode.
          </div>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 pb-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setFilterCategory('all')}
          className={cn(
            "flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-6 py-2.5 rounded-full border transition-all active:scale-95",
            filterCategory === 'all' 
              ? "bg-zinc-950 text-white border-zinc-950" 
              : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
          )}
        >
          All Items
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setFilterCategory(cat.id)}
            className={cn(
              "flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-6 py-2.5 rounded-full border transition-all active:scale-95",
              filterCategory === cat.id 
                ? "bg-primary text-primary-foreground border-primary" 
                : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
            )}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <Modal open={canManage && showForm && !!menuId} title={editingId ? 'Edit Product' : 'Create New Product'} onClose={resetForm}>
        <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="md:col-span-2 space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Product Name *</label>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Classic Cheeseburger"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Description</label>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Describe ingredients, allergens, or preparation details..."
                    className={cn(inputClassName, "resize-none")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Price *</label>
                <div className="relative">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-zinc-400">{CURRENCY_SYMBOL[currency] ?? currency}</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="0.00"
                    className={cn(inputClassName, "pl-12 font-black")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Original Price (Was)</label>
                <div className="relative">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-zinc-300">{CURRENCY_SYMBOL[currency] ?? currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.original_price}
                    onChange={e => setForm(f => ({ ...f, original_price: e.target.value }))}
                    placeholder="0.00"
                    className={cn(inputClassName, "pl-12 text-zinc-400 line-through")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Category</label>
                <select
                  value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                  className={inputClassName}
                >
                  <option value="">Uncategorized</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Product Media</label>
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    multiple={supportsImageUrls}
                    onChange={handleImageUpload}
                    className="hidden"
                    id="image-upload"
                  />
                  <label 
                    htmlFor="image-upload"
                    className="flex items-center justify-center gap-2 w-full px-5 py-3.5 bg-white border-2 border-dashed border-zinc-200 rounded-lg cursor-pointer hover:border-primary hover:bg-zinc-50 transition-all text-sm font-bold text-zinc-500"
                  >
                    <ImageIcon className="w-5 h-5" />
                    {uploadingImage ? 'Uploading...' : 'Choose Photos'}
                  </label>
                </div>
              </div>
            </div>

            {form.image_urls.length > 0 && (
              <div className="space-y-3">
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Media Preview</label>
                <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
                  {form.image_urls.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="relative flex-shrink-0 group">
                      <Image src={url} alt={`Image ${idx + 1}`} width={120} height={120} className="rounded-lg object-cover border border-zinc-100 shadow-md" />
                      <button
                        type="button"
                        onClick={() => removeImageAt(idx)}
                        className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-zinc-950 text-white flex items-center justify-center hover:bg-red-500 transition-colors shadow-lg"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      {idx === 0 && <span className="absolute bottom-2 left-2 bg-primary text-primary-foreground text-[8px] font-black uppercase px-2 py-0.5 rounded-full">Main</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Product Attributes</label>
              <div className="flex flex-wrap gap-2">
                {TAGS.map(tag => {
                  const isActive = form.tags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full border transition-all active:scale-95",
                        isActive 
                          ? "bg-zinc-950 text-white border-zinc-950" 
                          : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
                      )}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>

              <label className="flex items-center gap-3 cursor-pointer p-4 bg-zinc-50 rounded-lg border border-zinc-100 hover:bg-zinc-100 transition-all">
                <div className={cn(
                  "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                  form.is_featured ? "bg-primary border-primary" : "bg-white border-zinc-200"
                )}>
                  {form.is_featured && <Star className="w-4 h-4 text-zinc-950 fill-current" />}
                </div>
                <input
                  type="checkbox"
                  checked={form.is_featured}
                  onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))}
                  className="hidden"
                />
                <div>
                  <span className="block text-sm font-black text-zinc-950 uppercase tracking-tight">Feature this product</span>
                  <span className="block text-[10px] text-zinc-500 font-medium">Highlight on top of categories and home page.</span>
                </div>
              </label>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-6 py-4 text-sm font-bold text-red-600 flex items-center gap-3">
                <AlertCircle className="w-5 h-5" />
                {formError}
              </div>
            )}

            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-primary text-primary-foreground py-5 rounded-full text-lg font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? 'Processing...' : editingId ? 'Update Product' : 'Create Product'}
              </button>
              <button type="button" onClick={resetForm} className="px-10 py-5 rounded-full text-lg font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">
                Cancel
              </button>
            </div>
        </form>
      </Modal>

      {/* Product List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
          <div className="w-20 h-20 bg-white rounded-lg flex items-center justify-center shadow-sm mb-6">
            <Utensils className="w-10 h-10 text-zinc-200" />
          </div>
          <h3 className="text-xl font-black text-zinc-950 mb-2">No products found</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto font-medium">Add products to this category or change filters to see items.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-8">
          {filtered.map((product) => (
            <div key={product.id} className="group bg-white border border-zinc-100 rounded-lg p-6 transition-all duration-500 hover:border-primary hover:shadow-2xl hover:shadow-primary/10 flex flex-col">
              {/* Product Header (Image & Tags) */}
              <div className="relative aspect-[4/3] mb-6 overflow-hidden rounded-lg bg-zinc-50 border border-zinc-100">
                {getProductImages(product)[0] ? (
                  <Image
                    src={getProductImages(product)[0]!}
                    alt={product.name}
                    fill
                    className="object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Utensils className="w-12 h-12 text-zinc-200" />
                  </div>
                )}
                
                {/* Overlays */}
                <div className="absolute top-4 left-4 flex flex-col gap-2">
                  {product.is_featured && (
                    <div className="bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
                      <Star className="w-3 h-3 fill-current" />
                      Featured
                    </div>
                  )}
                  {!product.is_available && (
                    <div className="bg-zinc-950 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg">
                      Out of stock
                    </div>
                  )}
                </div>

                {product.tags && product.tags.length > 0 && (
                  <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-1.5">
                    {product.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="bg-white/90 backdrop-blur-md text-zinc-950 text-[9px] font-black uppercase tracking-tighter px-2.5 py-1 rounded-full border border-white">
                        {tag}
                      </span>
                    ))}
                    {product.tags.length > 3 && (
                      <span className="bg-white/90 backdrop-blur-md text-zinc-950 text-[9px] font-black px-2 py-1 rounded-full">
                        +{product.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="flex-1 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-black text-zinc-950 tracking-tight leading-tight group-hover:text-primary transition-colors">{product.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{product.category?.name ?? 'Uncategorized'}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-zinc-950 tracking-tighter">{formatPrice(product.price, currency)}</div>
                    {product.original_price && (
                      <div className="text-xs font-bold text-zinc-300 line-through">{formatPrice(product.original_price, currency)}</div>
                    )}
                  </div>
                </div>
                
                {product.description && (
                  <p className="text-sm font-medium text-zinc-500 line-clamp-2 leading-relaxed">
                    {product.description}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="mt-8 flex items-center justify-between pt-6 border-t border-zinc-50 opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-300">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAvailable(product.id, product.is_available)}
                    className={cn(
                      "p-3 rounded-lg border transition-all",
                      product.is_available 
                        ? "border-zinc-100 text-zinc-400 hover:text-green-500 hover:border-green-100" 
                        : "bg-green-50 border-green-100 text-green-600"
                    )}
                    title={product.is_available ? 'Set as Unavailable' : 'Set as Available'}
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => router.push(`/admin/menu/products/${product.id}`)}
                    className="p-3 rounded-lg border border-zinc-100 text-zinc-400 hover:text-zinc-950 hover:bg-zinc-50 transition-all"
                    title="Edit Product"
                  >
                    <Edit3 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setConfirmId(product.id)}
                    className="p-3 rounded-lg border border-red-50 text-red-100 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="Delete Product"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                <button 
                  onClick={() => router.push(`/admin/menu/products/${product.id}`)}
                  className="w-12 h-12 rounded-full bg-zinc-950 flex items-center justify-center text-primary hover:scale-110 transition-transform shadow-xl shadow-zinc-950/20"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
