'use client'

import { useState, useRef } from 'react'
import { formatPrice } from '@/lib/utils'
import type { Category, Product, TenantWithSettings } from '@/types/database'

interface Props {
  tenant: TenantWithSettings
  categories: Category[]
  products: Product[]
}

export default function MenuPage({ tenant, categories, products }: Props) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  const settings = tenant.tenant_settings
  const primaryColor = settings?.primary_color ?? '#000000'
  const accentColor = settings?.accent_color ?? '#FF5722'
  const whatsapp = settings?.whatsapp

  const featured = products.filter(p => p.is_featured)

  const filtered = products.filter(p => {
    const matchSearch = search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCategory = !activeCategory || p.category_id === activeCategory
    return matchSearch && matchCategory
  })

  const groupedByCategory = categories.map(cat => ({
    category: cat,
    items: filtered.filter(p => p.category_id === cat.id),
  })).filter(g => g.items.length > 0)

  const uncategorized = filtered.filter(p => !p.category_id)

  function openWhatsApp(product: Product) {
    if (!whatsapp) return
    const msg = encodeURIComponent(`Olá! Quero pedir: ${product.name} — ${formatPrice(product.price)}`)
    window.open(`https://wa.me/${whatsapp}?text=${msg}`, '_blank')
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header com branding */}
      <header style={{ backgroundColor: primaryColor }} className="text-white">
        <div className="max-w-2xl mx-auto px-4 py-6 flex items-center gap-4">
          {settings?.logo_url ? (
            <img
              src={settings.logo_url}
              alt={tenant.name}
              className="w-14 h-14 rounded-xl object-contain bg-white/10 p-1"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center text-3xl">🏪</div>
          )}
          <div>
            <h1 className="text-xl font-bold">{tenant.name}</h1>
            {settings?.address && (
              <p className="text-sm opacity-75 mt-0.5">{settings.address}</p>
            )}
          </div>
        </div>

        {/* Busca */}
        <div className="max-w-2xl mx-auto px-4 pb-4">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar no cardápio..."
            className="w-full px-4 py-2.5 rounded-xl text-zinc-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-white/50 placeholder:text-zinc-400"
          />
        </div>
      </header>

      {/* Filtro de categorias */}
      {categories.length > 0 && (
        <div className="sticky top-0 z-10 bg-white border-b border-zinc-200 shadow-sm">
          <div className="max-w-2xl mx-auto px-4">
            <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide">
              <button
                onClick={() => setActiveCategory(null)}
                style={!activeCategory ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                className={`flex-shrink-0 text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${
                  !activeCategory ? '' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                Todos
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                  style={activeCategory === cat.id ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                  className={`flex-shrink-0 text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${
                    activeCategory === cat.id ? '' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {/* Destaques */}
        {featured.length > 0 && !search && !activeCategory && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 mb-3">⭐ Destaques</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {featured.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProduct(p)}
                  className="flex-shrink-0 w-40 bg-white rounded-xl border border-zinc-200 overflow-hidden text-left hover:shadow-md transition-shadow"
                >
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-24 object-cover" />
                  ) : (
                    <div className="w-full h-24 bg-zinc-100 flex items-center justify-center text-3xl">🍽️</div>
                  )}
                  <div className="p-2">
                    <p className="text-xs font-semibold text-zinc-900 truncate">{p.name}</p>
                    <p style={{ color: accentColor }} className="text-sm font-bold mt-0.5">
                      {formatPrice(p.price)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Sem resultados */}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-zinc-400">
            <p className="text-4xl mb-3">🔍</p>
            <p className="font-medium">Nenhum item encontrado</p>
            <p className="text-sm mt-1">Tente outro termo de busca</p>
          </div>
        )}

        {/* Grupos por categoria */}
        {groupedByCategory.map(({ category, items }) => (
          <section key={category.id}>
            <h2 className="text-base font-bold text-zinc-900 mb-3">{category.name}</h2>
            <div className="space-y-2">
              {items.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  accentColor={accentColor}
                  onClick={() => setSelectedProduct(p)}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Sem categoria */}
        {uncategorized.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 mb-3">Outros</h2>
            <div className="space-y-2">
              {uncategorized.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  accentColor={accentColor}
                  onClick={() => setSelectedProduct(p)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Rodapé */}
        <footer className="pt-6 pb-10 text-center">
          <p className="text-xs text-zinc-400">Cardápio digital por</p>
          <p className="text-xs font-semibold text-zinc-500">Skale QR Menu</p>
        </footer>
      </div>

      {/* Modal do produto */}
      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          accentColor={accentColor}
          whatsapp={whatsapp}
          onClose={() => setSelectedProduct(null)}
          onWhatsApp={() => openWhatsApp(selectedProduct)}
        />
      )}
    </div>
  )
}

function ProductCard({
  product,
  accentColor,
  onClick,
}: {
  product: Product
  accentColor: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl border border-zinc-200 p-3 flex gap-3 text-left hover:shadow-sm transition-shadow"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <p className="text-sm font-semibold text-zinc-900">{product.name}</p>
          {product.is_featured && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Destaque</span>
          )}
        </div>
        {product.tags?.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {product.tags.map(tag => (
              <span key={tag} className="text-xs bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded">{tag}</span>
            ))}
          </div>
        )}
        {product.description && (
          <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{product.description}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          {product.original_price && (
            <span className="text-xs text-zinc-400 line-through">{formatPrice(product.original_price)}</span>
          )}
          <span style={{ color: accentColor }} className="text-sm font-bold">{formatPrice(product.price)}</span>
        </div>
      </div>
      {product.image_url && (
        <img
          src={product.image_url}
          alt={product.name}
          className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
        />
      )}
    </button>
  )
}

function ProductModal({
  product,
  accentColor,
  whatsapp,
  onClose,
  onWhatsApp,
}: {
  product: Product
  accentColor: string
  whatsapp?: string | null
  onClose: () => void
  onWhatsApp: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {product.image_url && (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-56 object-cover"
          />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="text-lg font-bold text-zinc-900">{product.name}</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none flex-shrink-0">✕</button>
          </div>

          {product.tags?.length > 0 && (
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {product.tags.map(tag => (
                <span key={tag} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}

          {product.description && (
            <p className="text-sm text-zinc-600 mb-4 leading-relaxed">{product.description}</p>
          )}

          <div className="flex items-center justify-between">
            <div>
              {product.original_price && (
                <p className="text-sm text-zinc-400 line-through">{formatPrice(product.original_price)}</p>
              )}
              <p style={{ color: accentColor }} className="text-2xl font-bold">{formatPrice(product.price)}</p>
            </div>
            {whatsapp && (
              <button
                onClick={onWhatsApp}
                className="bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-600 transition-colors"
              >
                Pedir pelo WhatsApp
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
