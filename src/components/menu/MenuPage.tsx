'use client'

import { useEffect, useRef, useState } from 'react'
import { formatPrice } from '@/lib/utils'
import type { Category, Product, TenantWithSettings } from '@/types/database'

interface Props {
  tenant: TenantWithSettings
  categories: Category[]
  products: Product[]
  menu?: {
    name: string
    description?: string | null
    language: string
    supported_languages?: string[]
    translations?: Record<string, { name?: string; description?: string }>
  } | null
  initialLanguage?: string
  footerBrand?: string
}

const DAYS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

function getProductImages(product: Product) {
  const fromArray = (product.image_urls ?? []).map(url => url?.trim()).filter(Boolean) as string[]
  const fromSingle = product.image_url?.trim() ? [product.image_url.trim()] : []
  return Array.from(new Set([...fromArray, ...fromSingle]))
}

const UI_COPY: Record<string, { search: string; all: string; featured: string; noItems: string; tryAnother: string; other: string; createAccount: string }> = {
  en: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account' },
  pt: { search: 'Buscar no cardápio...', all: 'Todos', featured: 'Destaques', noItems: 'Nenhum item encontrado', tryAnother: 'Tente outro termo de busca', other: 'Outros', createAccount: 'Criar conta' },
  es: { search: 'Buscar en el menú...', all: 'Todos', featured: 'Destacados', noItems: 'No se encontraron items', tryAnother: 'Prueba otro término de búsqueda', other: 'Otros', createAccount: 'Crear cuenta' },
  fr: { search: 'Rechercher dans le menu...', all: 'Tous', featured: 'En vedette', noItems: 'Aucun article trouvé', tryAnother: 'Essayez un autre terme', other: 'Autres', createAccount: 'Créer un compte' },
  de: { search: 'Im Menü suchen...', all: 'Alle', featured: 'Empfohlen', noItems: 'Keine Artikel gefunden', tryAnother: 'Versuche einen anderen Suchbegriff', other: 'Andere', createAccount: 'Konto erstellen' },
  it: { search: 'Cerca nel menu...', all: 'Tutti', featured: 'In evidenza', noItems: 'Nessun elemento trovato', tryAnother: 'Prova un altro termine', other: 'Altro', createAccount: 'Crea account' },
}

function getTranslatedMenuField(
  menu: Props['menu'],
  lang: string,
  field: 'name' | 'description',
  fallback: string
) {
  if (!menu?.translations) return fallback
  const value = menu.translations?.[lang]?.[field]
  return typeof value === 'string' && value.trim() ? value : fallback
}

export default function MenuPage({ tenant, categories, products, menu = null, initialLanguage, footerBrand = 'XmartMenu' }: Props) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showFooterAtEnd, setShowFooterAtEnd] = useState(false)
  const [footerHeight, setFooterHeight] = useState(0)
  const [pauseFeaturedAutoScroll, setPauseFeaturedAutoScroll] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage ?? menu?.language ?? 'en')
  const [visibleCategory, setVisibleCategory] = useState<string | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const featuredRailRef = useRef<HTMLDivElement | null>(null)
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({})

  const settings = tenant.tenant_settings
  const primaryColor = settings?.primary_color ?? '#000000'
  const accentColor = settings?.accent_color ?? '#FF5722'
  const ordersEnabled = settings?.orders_enabled ?? true
  const whatsapp = (ordersEnabled && settings?.whatsapp_orders_enabled) ? settings?.whatsapp : null
  const currency = settings?.currency ?? 'USD'

  const featured = products.filter(p => p.is_featured)
  const featuredBase = featured.length === 1 ? [featured[0], featured[0], featured[0]] : featured
  const supportedLanguages = menu?.supported_languages?.length ? menu.supported_languages : [menu?.language ?? 'en']
  const ui = UI_COPY[selectedLanguage] ?? UI_COPY.en
  const menuTitle = getTranslatedMenuField(menu, selectedLanguage, 'name', menu?.name ?? tenant.name)
  const menuDescription = getTranslatedMenuField(menu, selectedLanguage, 'description', menu?.description ?? '')

  const filtered = products.filter(p => {
    const matchSearch = search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCategory = !activeCategory || p.category_id === activeCategory
    return matchSearch && matchCategory
  })

  const categoryIds = new Set(categories.map(c => c.id))

  const groupedByCategory = categories.map(cat => ({
    category: cat,
    items: filtered.filter(p => p.category_id === cat.id),
  })).filter(g => g.items.length > 0)

  const uncategorized = filtered.filter(p => !p.category_id || !categoryIds.has(p.category_id))

  function openWhatsApp(product: Product) {
    if (!whatsapp) return
    const msg = encodeURIComponent(`Hi! I'd like to order: ${product.name} — ${formatPrice(product.price, currency)}`)
    window.open(`https://wa.me/${whatsapp}?text=${msg}`, '_blank')
  }

  const hours = settings?.business_hours
  const hasHours = hours && Object.values(hours).some(Boolean)
  const email = (settings && 'email' in settings)
    ? (settings as { email?: string | null }).email ?? null
    : null
  const hasContact = settings?.phone || settings?.instagram || settings?.whatsapp || settings?.address || email
  const hasFixedFooter = hasContact || footerBrand

  useEffect(() => {
    const onScroll = () => {
      const currentY = window.scrollY
      const viewportBottom = currentY + window.innerHeight
      const pageBottom = document.documentElement.scrollHeight
      const isAtEnd = viewportBottom >= pageBottom - 24
      setShowFooterAtEnd(isAtEnd)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  useEffect(() => {
    if (activeCategory || search) {
      setVisibleCategory(null)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter(e => e.isIntersecting)
        if (visibleEntries.length === 0) return

        const topEntry = visibleEntries.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        )
        const categoryId = topEntry.target.getAttribute('data-category-id')
        if (categoryId) setVisibleCategory(categoryId)
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0,
      }
    )

    const refs = categoryRefs.current
    Object.values(refs).forEach(el => {
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [groupedByCategory, activeCategory, search])

  useEffect(() => {
    if (!hasFixedFooter) {
      setFooterHeight(0)
      return
    }

    const measure = () => {
      setFooterHeight(footerRef.current?.offsetHeight ?? 0)
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [hasFixedFooter, hasContact, footerBrand])

  useEffect(() => {
    const enabled = featuredBase.length > 1 && !search && !activeCategory
    if (!enabled) return

    const rail = featuredRailRef.current
    if (!rail) return

    const timer = window.setInterval(() => {
      if (pauseFeaturedAutoScroll) return
      const card = rail.querySelector<HTMLElement>('[data-featured-card]')
      if (!card) return

      const gap = parseFloat(getComputedStyle(rail).gap || '0') || 0
      const step = card.offsetWidth + gap
      const maxScrollLeft = rail.scrollWidth - rail.clientWidth
      const nextScrollLeft = rail.scrollLeft + step
      rail.scrollTo({
        left: nextScrollLeft >= maxScrollLeft - 2 ? 0 : nextScrollLeft,
        behavior: 'smooth',
      })
    }, 2800)

    return () => window.clearInterval(timer)
  }, [featuredBase.length, search, activeCategory, pauseFeaturedAutoScroll])

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header style={{ backgroundColor: primaryColor }} className="text-white">
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-5 sm:py-6 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4">
          {settings?.logo_url ? (
            <img src={settings.logo_url} alt={tenant.name} className="w-14 h-14 rounded-xl object-contain bg-white/10 p-1" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center text-3xl">🏪</div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">{tenant.name}</h1>
            {menuTitle && <p className="text-sm opacity-90 mt-0.5">{menuTitle}</p>}
            {menuDescription && <p className="text-xs opacity-75 mt-0.5">{menuDescription}</p>}
            {settings?.address && <p className="text-sm opacity-75 mt-0.5">{settings.address}</p>}
          </div>
          <a
            href={`/auth/register?from=/${tenant.slug}`}
            className="w-full sm:w-auto text-center flex-shrink-0 text-xs font-semibold bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-full"
          >
            {ui.createAccount}
          </a>
        </div>
        {supportedLanguages.length > 1 && (
          <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              {supportedLanguages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setSelectedLanguage(lang)
                    const url = new URL(window.location.href)
                    url.searchParams.set('lang', lang)
                    window.history.replaceState({}, '', url.toString())
                  }}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${selectedLanguage === lang ? 'bg-white text-zinc-900 border-white' : 'bg-white/10 text-white border-white/30 hover:bg-white/20'}`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 pb-4">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={ui.search}
            className="w-full px-4 py-2.5 rounded-xl text-zinc-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-white/50 placeholder:text-zinc-400"
          />
        </div>
      </header>

      {/* Banner */}
      {settings?.banner_url && (
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 pt-4 sm:pt-5">
          <img src={settings.banner_url} alt="Banner" className="w-full rounded-xl object-cover max-h-48 sm:max-h-64 lg:max-h-72" />
        </div>
      )}

      {/* Filtro de categorias */}
      {categories.length > 0 && (
        <div className="sticky top-0 z-10 bg-white border-b border-zinc-200 shadow-sm">
          <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12">
            <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide">
              <button
                onClick={() => setActiveCategory(null)}
                style={!activeCategory && !visibleCategory ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                className={`flex-shrink-0 text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${!activeCategory && !visibleCategory ? '' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                {ui.all}
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                  style={activeCategory === cat.id || visibleCategory === cat.id ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                  className={`flex-shrink-0 text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${activeCategory === cat.id || visibleCategory === cat.id ? '' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-6 sm:py-8 lg:py-10 space-y-8 sm:space-y-10"
        style={hasFixedFooter ? { paddingBottom: `${footerHeight + 24}px` } : undefined}
      >
        {/* Destaques */}
        {featured.length > 0 && !search && !activeCategory && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 mb-3">⭐ {ui.featured}</h2>
            <div
              ref={featuredRailRef}
              onMouseEnter={() => setPauseFeaturedAutoScroll(true)}
              onMouseLeave={() => setPauseFeaturedAutoScroll(false)}
              className="-mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-12 flex gap-3 sm:gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory [scrollbar-gutter:stable]"
            >
              {featuredBase.map((p, idx) => (
                <button key={`${p.id}-${idx}`} onClick={() => setSelectedProduct(p)} data-featured-card
                  className="flex-shrink-0 snap-start basis-[calc((100%-0.75rem)/2)] sm:basis-[calc((100%-2rem)/3)] lg:basis-[calc((100%-3rem)/4)] bg-white rounded-xl border border-zinc-200 overflow-hidden text-left hover:shadow-md transition-shadow">
                  {getProductImages(p)[0]
                    ? <img src={getProductImages(p)[0]} alt={p.name} className="w-full h-24 sm:h-28 lg:h-32 object-cover" />
                    : <div className="w-full h-24 sm:h-28 lg:h-32 bg-zinc-100 flex items-center justify-center text-3xl">🍽️</div>}
                  <div className="p-2">
                    <p className="text-xs font-semibold text-zinc-900 truncate">{p.name}</p>
                    <p style={{ color: accentColor }} className="text-sm font-bold mt-0.5">{formatPrice(p.price, currency)}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-16 text-zinc-400">
            <p className="text-4xl mb-3">🔍</p>
            <p className="font-medium">{ui.noItems}</p>
            <p className="text-sm mt-1">{ui.tryAnother}</p>
          </div>
        )}

        {groupedByCategory.map(({ category, items }) => (
          <section
            key={category.id}
            ref={el => { categoryRefs.current[category.id] = el }}
            data-category-id={category.id}
          >
            <h2 className="text-base font-bold text-zinc-900 mb-3">{category.name}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {items.map(p => (
                <ProductCard key={p.id} product={p} accentColor={accentColor} currency={currency} lang={selectedLanguage} onClick={() => setSelectedProduct(p)} />
              ))}
            </div>
          </section>
        ))}

        {uncategorized.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 mb-3">{ui.other}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {uncategorized.map(p => (
                <ProductCard key={p.id} product={p} accentColor={accentColor} currency={currency} lang={selectedLanguage} onClick={() => setSelectedProduct(p)} />
              ))}
            </div>
          </section>
        )}

        {/* Horários de funcionamento */}
        {hasHours && (
          <section className="bg-white rounded-xl border border-zinc-200 p-5">
            <h2 className="text-sm font-bold text-zinc-900 mb-3">Opening hours</h2>
            <div className="space-y-1.5">
              {Object.entries(DAYS).map(([key, label]) => {
                const value = hours?.[key as keyof typeof hours]
                if (!value) return null
                return (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-zinc-500">{label}</span>
                    <span className="text-zinc-900 font-medium">{value}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </div>

      {hasFixedFooter && (
        <footer ref={footerRef} className={`fixed bottom-0 inset-x-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 transition-all duration-300 ${showFooterAtEnd ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
          <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-3">
            {hasContact && (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-zinc-700 text-center">
                {settings?.phone && (
                  <a href={`tel:${settings.phone}`} className="hover:text-zinc-900">
                    📞 {settings.phone}
                  </a>
                )}
                {settings?.whatsapp && (
                  <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">
                    💬 WhatsApp
                  </a>
                )}
                {settings?.instagram && (
                  <a href={`https://instagram.com/${settings.instagram}`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">
                    📸 @{settings.instagram}
                  </a>
                )}
                {email && (
                  <a href={`mailto:${email}`} className="hover:text-zinc-900">
                    ✉️ {email}
                  </a>
                )}
                {settings?.address && <span className="text-zinc-600">📍 {settings.address}</span>}
              </div>
            )}
            {footerBrand && (
              <div className="mt-1 text-xs text-zinc-500 text-center">
                Digital menu by <a href="/" className="font-semibold hover:text-zinc-700 transition-colors">{footerBrand}</a>
              </div>
            )}
          </div>
        </footer>
      )}

      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          accentColor={accentColor}
          currency={currency}
          whatsapp={whatsapp}
          lang={selectedLanguage}
          onClose={() => setSelectedProduct(null)}
          onWhatsApp={() => openWhatsApp(selectedProduct)}
        />
      )}
    </div>
  )
}

const TAG_TRANSLATIONS: Record<string, Record<string, string>> = {
  'Vegetarian': { en: 'Vegetarian', pt: 'Vegetariano', es: 'Vegetariano', fr: 'Végétarien', de: 'Vegetarisch', it: 'Vegetariano' },
  'Vegan': { en: 'Vegan', pt: 'Vegano', es: 'Vegano', fr: 'Végan', de: 'Vegan', it: 'Vegano' },
  'Gluten-Free': { en: 'Gluten-Free', pt: 'Sem Glúten', es: 'Sin Gluten', fr: 'Sans Gluten', de: 'Glutenfrei', it: 'Senza Glutine' },
  'Spicy': { en: 'Spicy', pt: 'Picante', es: 'Picante', fr: 'Épicé', de: 'Scharf', it: 'Piccante' },
  'Chef\'s special': { en: 'Chef\'s special', pt: 'Especial do Chef', es: 'Especial del Chef', fr: 'Spécialité du Chef', de: 'Spezialität des Kochs', it: 'Speciale dello Chef' },
}

const TAG_COLORS: Record<string, string> = {
  'Vegetarian': 'bg-green-100 text-green-700',
  'Vegetariano': 'bg-green-100 text-green-700',
  'Végétarien': 'bg-green-100 text-green-700',
  'Vegetarisch': 'bg-green-100 text-green-700',
  'Vegan': 'bg-emerald-100 text-emerald-700',
  'Vegano': 'bg-emerald-100 text-emerald-700',
  'Végan': 'bg-emerald-100 text-emerald-700',
  'Gluten-Free': 'bg-amber-100 text-amber-700',
  'Sem Glúten': 'bg-amber-100 text-amber-700',
  'Sin Gluten': 'bg-amber-100 text-amber-700',
  'Sans Gluten': 'bg-amber-100 text-amber-700',
  'Glutenfrei': 'bg-amber-100 text-amber-700',
  'Senza Glutine': 'bg-amber-100 text-amber-700',
  'Spicy': 'bg-red-100 text-red-700',
  'Picante': 'bg-red-100 text-red-700',
  'Épicé': 'bg-red-100 text-red-700',
  'Scharf': 'bg-red-100 text-red-700',
  'Piccante': 'bg-red-100 text-red-700',
  'Chef\'s special': 'bg-purple-100 text-purple-700',
  'Especial do Chef': 'bg-purple-100 text-purple-700',
  'Especial del Chef': 'bg-purple-100 text-purple-700',
  'Spécialité du Chef': 'bg-purple-100 text-purple-700',
  'Spezialität des Kochs': 'bg-purple-100 text-purple-700',
  'Speciale dello Chef': 'bg-purple-100 text-purple-700',
}

function translateTag(tag: string, lang: string): string {
  return TAG_TRANSLATIONS[tag]?.[lang] ?? tag
}

function getTagStyle(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-zinc-100 text-zinc-600'
}

function ProductCard({ product, accentColor, currency, lang, onClick }: { product: Product; accentColor: string; currency: string; lang: string; onClick: () => void }) {
  const images = getProductImages(product)
  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-xl border border-zinc-200 overflow-hidden text-left hover:shadow-sm transition-shadow">
      {images[0]
        ? <img src={images[0]} alt={product.name} className="w-full h-32 object-cover" />
        : <div className="w-full h-32 bg-zinc-100 flex items-center justify-center text-3xl">🍽️</div>}
      <div className="p-2">
        <div className="flex items-start gap-1 flex-wrap">
          <p className="text-sm font-semibold text-zinc-900 truncate">{product.name}</p>
          {product.is_featured && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Featured</span>}
        </div>
        {product.tags?.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {product.tags.map(tag => {
              const translated = translateTag(tag, lang)
              return <span key={tag} className={`text-xs px-1.5 py-0.5 rounded ${getTagStyle(translated)}`}>{translated}</span>
            })}
          </div>
        )}
        {product.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{product.description}</p>}
        <div className="flex items-center gap-2 mt-1.5">
          {product.original_price && <span className="text-xs text-zinc-400 line-through">{formatPrice(product.original_price, currency)}</span>}
          <span style={{ color: accentColor }} className="text-sm font-bold">{formatPrice(product.price, currency)}</span>
        </div>
      </div>
    </button>
  )
}

function ProductModal({ product, accentColor, currency, whatsapp, lang, onClose, onWhatsApp }: {
  product: Product; accentColor: string; currency: string; whatsapp?: string | null; lang: string; onClose: () => void; onWhatsApp: () => void
}) {
  const images = getProductImages(product)
  const [imageIndex, setImageIndex] = useState(0)
  const hasManyImages = images.length > 1
  const touchStartXRef = useRef<number | null>(null)
  const touchDeltaXRef = useRef(0)
  const [touchOffsetX, setTouchOffsetX] = useState(0)
  const [isDraggingImage, setIsDraggingImage] = useState(false)

  useEffect(() => {
    setImageIndex(0)
  }, [product.id])

  const prevImage = () => setImageIndex(i => (i - 1 + images.length) % images.length)
  const nextImage = () => setImageIndex(i => (i + 1) % images.length)
  const SWIPE_THRESHOLD = 40

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (!hasManyImages) return
    touchStartXRef.current = e.touches[0]?.clientX ?? null
    touchDeltaXRef.current = 0
    setIsDraggingImage(true)
    setTouchOffsetX(0)
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!hasManyImages || touchStartXRef.current === null) return
    const currentX = e.touches[0]?.clientX ?? touchStartXRef.current
    const delta = currentX - touchStartXRef.current
    touchDeltaXRef.current = delta
    setTouchOffsetX(delta)
  }

  function handleTouchEnd() {
    if (!hasManyImages) return
    const delta = touchDeltaXRef.current
    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      if (delta < 0) nextImage()
      else prevImage()
    }
    touchStartXRef.current = null
    touchDeltaXRef.current = 0
    setIsDraggingImage(false)
    setTouchOffsetX(0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md lg:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {images[imageIndex] && (
          <div
            className="relative"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <img
              src={images[imageIndex]}
              alt={`${product.name} ${imageIndex + 1}`}
              className={`w-full h-56 sm:h-64 object-cover ${isDraggingImage ? '' : 'transition-transform duration-200 ease-out'}`}
              style={{ transform: `translateX(${touchOffsetX}px)` }}
            />
            {hasManyImages && (
              <>
                <button
                  onClick={prevImage}
                  className="absolute z-10 left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/75 text-white w-9 h-9 rounded-full shadow-md flex items-center justify-center"
                  aria-label="Previous image"
                  type="button"
                >
                  ‹
                </button>
                <button
                  onClick={nextImage}
                  className="absolute z-10 right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/75 text-white w-9 h-9 rounded-full shadow-md flex items-center justify-center"
                  aria-label="Next image"
                  type="button"
                >
                  ›
                </button>
                <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setImageIndex(i)}
                      className={`w-1.5 h-1.5 rounded-full ${i === imageIndex ? 'bg-white' : 'bg-white/50'}`}
                      aria-label={`Go to image ${i + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="text-lg font-bold text-zinc-900">{product.name}</h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none flex-shrink-0">✕</button>
          </div>
          {product.tags?.length > 0 && (
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {product.tags.map(tag => {
                const translated = translateTag(tag, lang)
                return <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${getTagStyle(translated)}`}>{translated}</span>
              })}
            </div>
          )}
          {product.description && <p className="text-sm text-zinc-600 mb-4 leading-relaxed">{product.description}</p>}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              {product.original_price && <p className="text-sm text-zinc-400 line-through">{formatPrice(product.original_price, currency)}</p>}
              <p style={{ color: accentColor }} className="text-2xl font-bold">{formatPrice(product.price, currency)}</p>
            </div>
            {whatsapp && (
              <button onClick={onWhatsApp} className="w-full sm:w-auto bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-600 transition-colors">
                Order via WhatsApp
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
