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

const UI_COPY: Record<string, { search: string; all: string; featured: string; noItems: string; tryAnother: string; other: string; createAccount: string; hoursBtn: string; hoursTitle: string }> = {
  en: { search: 'Search the menu...', all: 'All', featured: 'Featured', noItems: 'No items found', tryAnother: 'Try a different search term', other: 'Other', createAccount: 'Create account', hoursBtn: 'See our hours', hoursTitle: 'Opening hours' },
  pt: { search: 'Buscar no cardápio...', all: 'Todos', featured: 'Destaques', noItems: 'Nenhum item encontrado', tryAnother: 'Tente outro termo de busca', other: 'Outros', createAccount: 'Criar conta', hoursBtn: 'Veja nossos horários', hoursTitle: 'Horários de funcionamento' },
  es: { search: 'Buscar en el menú...', all: 'Todos', featured: 'Destacados', noItems: 'No se encontraron items', tryAnother: 'Prueba otro término de búsqueda', other: 'Otros', createAccount: 'Crear cuenta', hoursBtn: 'Ver nuestros horarios', hoursTitle: 'Horarios de atención' },
  fr: { search: 'Rechercher dans le menu...', all: 'Tous', featured: 'En vedette', noItems: 'Aucun article trouvé', tryAnother: 'Essayez un autre terme', other: 'Autres', createAccount: 'Créer un compte', hoursBtn: 'Voir nos horaires', hoursTitle: 'Horaires d\'ouverture' },
  de: { search: 'Im Menü suchen...', all: 'Alle', featured: 'Empfohlen', noItems: 'Keine Artikel gefunden', tryAnother: 'Versuche einen anderen Suchbegriff', other: 'Andere', createAccount: 'Konto erstellen', hoursBtn: 'Öffnungszeiten', hoursTitle: 'Öffnungszeiten' },
  it: { search: 'Cerca nel menu...', all: 'Tutti', featured: 'In evidenza', noItems: 'Nessun elemento trovato', tryAnother: 'Prova un altro termine', other: 'Altro', createAccount: 'Crea account', hoursBtn: 'Vedi i nostri orari', hoursTitle: 'Orari di apertura' },
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

interface CartItem {
  product: Product
  quantity: number
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
  const [cart, setCart] = useState<CartItem[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [showCartModal, setShowCartModal] = useState(false)
  const [showHoursModal, setShowHoursModal] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({})
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const categoryFilterRef = useRef<HTMLDivElement | null>(null)

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

  const directOrdersEnabled = settings?.direct_orders_enabled ?? false

  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id)
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(item => item.product.id !== productId))
  }

  function updateCartQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(productId)
      return
    }
    setCart(prev =>
      prev.map(item =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    )
  }

  async function submitOrder() {
    if (!customerName.trim() || !customerPhone.trim()) {
      setOrderError('Please fill in your name and phone number')
      return
    }
    if (cart.length === 0) {
      setOrderError('Your cart is empty')
      return
    }

    setSubmittingOrder(true)
    setOrderError(null)

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenant.id,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          items: cart.map(item => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.product.price,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit order')
      }

      setOrderSuccess(true)
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      setShowCartModal(false)
      setTimeout(() => setOrderSuccess(false), 3000)
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Failed to submit order')
    } finally {
      setSubmittingOrder(false)
    }
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

    const getRootMargin = () => {
      if (typeof window === 'undefined') return '-20% 0px -60% 0px'
      return window.innerWidth < 640 ? '-80px 0px -60% 0px' : '-20% 0px -60% 0px'
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
        rootMargin: getRootMargin(),
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
    if (!visibleCategory) return
    const button = categoryButtonRefs.current[visibleCategory]
    const container = categoryFilterRef.current
    if (!button || !container) return

    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()

    if (buttonRect.left < containerRect.left || buttonRect.right > containerRect.right) {
      button.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [visibleCategory])

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


  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header
        className="relative text-white overflow-hidden"
        style={!settings?.banner_url ? { backgroundColor: primaryColor } : undefined}
      >
        {/* Banner as background when set */}
        {settings?.banner_url && (
          <>
            <img src={settings.banner_url} alt="Banner" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ backgroundColor: primaryColor, opacity: 0.65 }} />
          </>
        )}
        {/* Content over banner or blue background */}
        <div className="relative z-10">
          <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-5 sm:py-6 flex flex-col items-center gap-3">
            {settings?.logo_url ? (
              <img src={settings.logo_url} alt={tenant.name} className="w-20 h-20 rounded-xl object-cover bg-white/10 p-1" />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-white/20 flex items-center justify-center text-4xl">🏪</div>
            )}
            <div className="text-center">
              <h1 className="text-xl font-bold leading-tight">{tenant.name}</h1>
              {menuTitle && <p className="text-sm opacity-90 mt-0.5">{menuTitle}</p>}
              {menuDescription && <p className="text-xs opacity-75 mt-0.5">{menuDescription}</p>}
              {settings?.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1 text-sm opacity-75 hover:opacity-100 transition-opacity mt-0.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  {settings.address}
                </a>
              )}
              {settings?.phone && (
                <a
                  href={`tel:${settings.phone}`}
                  className="inline-flex items-center justify-center gap-1 text-sm opacity-75 hover:opacity-100 transition-opacity mt-0.5 ml-3"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                  </svg>
                  {settings.phone}
                </a>
              )}
              {hasHours && (
                <div className="mt-3">
                <button
                  onClick={() => setShowHoursModal(true)}
                  className="inline-flex items-center justify-center gap-1 text-sm opacity-75 hover:opacity-100 transition-opacity px-3 py-1 rounded-full border border-white/40 bg-white/10 hover:bg-white/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
                  </svg>
                  {ui.hoursBtn}
                </button>
                </div>
              )}
            </div>
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
        </div>
      </header>

      {/* Filtro de categorias */}
      {categories.length > 0 && (
        <div className="sticky top-0 z-20 bg-white border-b border-zinc-200 shadow-sm supports-backdrop-blur:bg-white/95 supports-backdrop-blur:backdrop-blur-sm">
          <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12">
            <div ref={categoryFilterRef} className="flex gap-2 justify-center items-center overflow-x-auto py-3 scrollbar-hide">
              <button
                onClick={() => { if (showSearch) { setShowSearch(false); setSearch('') } else { setShowSearch(true) } }}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
              >
                {showSearch
                  ? <span className="text-xs font-medium leading-none">✕</span>
                  : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                }
              </button>
              {showSearch ? (
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="w-64 sm:w-80 px-3 py-1 rounded-full border border-zinc-300 text-sm text-zinc-900 focus:outline-none focus:ring-1 transition-all"
                />
              ) : (
                <>
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
                      ref={el => { categoryButtonRefs.current[cat.id] = el }}
                      onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                      style={activeCategory === cat.id || visibleCategory === cat.id ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                      className={`flex-shrink-0 text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${activeCategory === cat.id || visibleCategory === cat.id ? '' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSearch && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setShowSearch(false); setSearch('') }}
        />
      )}

      <div
        className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-6 sm:py-8 lg:py-10 space-y-8 sm:space-y-10"
        style={hasFixedFooter ? { paddingBottom: `${footerHeight + 24}px` } : undefined}
      >
        {/* Destaques */}
        {featured.length > 0 && !search && !activeCategory && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 mb-3">⭐ {ui.featured}</h2>
            <div className="-mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-12 overflow-hidden pb-2">
              <div
                onMouseEnter={() => setPauseFeaturedAutoScroll(true)}
                onMouseLeave={() => setPauseFeaturedAutoScroll(false)}
                className={`flex gap-3 sm:gap-4 w-max ${pauseFeaturedAutoScroll ? 'animate-marquee-paused' : 'animate-marquee'}`}
              >
                {[...featuredBase, ...featuredBase].map((p, idx) => (
                  <button key={`${p.id}-${idx}`} onClick={() => setSelectedProduct(p)}
                    className="flex-shrink-0 w-40 sm:w-48 lg:w-56 bg-white rounded-xl border border-zinc-200 overflow-hidden text-left hover:shadow-md active:scale-[0.97] transition-all duration-200 ease-out">
                    <div className="w-full aspect-video bg-zinc-100 overflow-hidden">
                      {getProductImages(p)[0]
                        ? <img src={getProductImages(p)[0]} alt={p.name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-3xl">🍽️</div>}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold text-zinc-900 truncate">{p.name}</p>
                      <p style={{ color: accentColor }} className="text-sm font-bold mt-0.5">{formatPrice(p.price, currency)}</p>
                    </div>
                  </button>
                ))}
              </div>
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
                {settings?.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-600 hover:text-zinc-900 transition-colors"
                  >
                    📍 {settings.address}
                  </a>
                )}
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
          onAddToCart={directOrdersEnabled ? () => { addToCart(selectedProduct); setSelectedProduct(null) } : undefined}
        />
      )}

      {directOrdersEnabled && cart.length > 0 && !showCartModal && (
        <button
          onClick={() => setShowCartModal(true)}
          className="fixed bottom-20 right-4 z-40 bg-zinc-900 text-white px-4 py-3 rounded-full shadow-lg flex items-center gap-2 hover:bg-zinc-800 transition-colors"
        >
          <span>🛒</span>
          <span className="font-semibold">{formatPrice(cartTotal, currency)}</span>
          {cartCount > 0 && (
            <span className="bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{cartCount}</span>
          )}
        </button>
      )}

      {showHoursModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4" onClick={() => setShowHoursModal(false)}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 sm:p-6 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-900">{ui.hoursTitle}</h3>
              <button onClick={() => setShowHoursModal(false)} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
            </div>
            <div className="p-5 sm:p-6 space-y-2">
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
          </div>
        </div>
      )}

      {showCartModal && (
        <CartModal
          cart={cart}
          currency={currency}
          customerName={customerName}
          customerPhone={customerPhone}
          submittingOrder={submittingOrder}
          orderSuccess={orderSuccess}
          orderError={orderError}
          onClose={() => setShowCartModal(false)}
          onCustomerNameChange={setCustomerName}
          onCustomerPhoneChange={setCustomerPhone}
          onRemove={removeFromCart}
          onUpdateQuantity={updateCartQuantity}
          onSubmit={submitOrder}
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
      className="w-full bg-white rounded-xl border border-zinc-200 overflow-hidden text-left hover:shadow-md hover:scale-[1.03] active:scale-[0.97] transition-all duration-200 ease-out">
      <div className="w-full aspect-video bg-zinc-100 overflow-hidden">
        {images[0]
          ? <img src={images[0]} alt={product.name} className="w-full h-full object-cover block" />
          : <div className="w-full h-full flex items-center justify-center text-3xl">🍽️</div>}
      </div>
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

function ProductModal({ product, accentColor, currency, whatsapp, lang, onClose, onWhatsApp, onAddToCart }: {
  product: Product; accentColor: string; currency: string; whatsapp?: string | null; lang: string; onClose: () => void; onWhatsApp: () => void; onAddToCart?: () => void
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
            className="relative w-full aspect-video bg-zinc-100 overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <img
              src={images[imageIndex]}
              alt={`${product.name} ${imageIndex + 1}`}
              className={`w-full h-full object-cover ${isDraggingImage ? '' : 'transition-transform duration-200 ease-out'}`}
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
            <div className="flex flex-col sm:flex-row gap-2">
              {whatsapp && (
                <button onClick={onWhatsApp} className="w-full sm:w-auto bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-600 transition-colors">
                  Order via WhatsApp
                </button>
              )}
              {onAddToCart && (
                <button onClick={onAddToCart} className="w-full sm:w-auto bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-zinc-800 transition-colors">
                  Add to cart
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CartModal({ cart, currency, customerName, customerPhone, submittingOrder, orderSuccess, orderError, onClose, onCustomerNameChange, onCustomerPhoneChange, onRemove, onUpdateQuantity, onSubmit }: {
  cart: CartItem[]
  currency: string
  customerName: string
  customerPhone: string
  submittingOrder: boolean
  orderSuccess: boolean
  orderError: string | null
  onClose: () => void
  onCustomerNameChange: (name: string) => void
  onCustomerPhoneChange: (phone: string) => void
  onRemove: (productId: string) => void
  onUpdateQuantity: (productId: string, quantity: number) => void
  onSubmit: () => void
}) {
  const total = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md lg:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 sm:p-6 border-b border-zinc-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900">Your order</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {cart.length === 0 ? (
            <p className="text-center text-zinc-400 py-8">Your cart is empty</p>
          ) : (
            <>
              {cart.map(item => (
                <div key={item.product.id} className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-zinc-900 truncate">{item.product.name}</p>
                    <p className="text-sm text-zinc-500">{formatPrice(item.product.price, currency)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
                      className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-medium">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
                      className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600"
                    >
                      +
                    </button>
                  </div>
                  <p className="w-20 text-right font-semibold">{formatPrice(item.product.price * item.quantity, currency)}</p>
                  <button
                    onClick={() => onRemove(item.product.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </>
          )}

          {cart.length > 0 && (
            <div className="pt-4 border-t border-zinc-200 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customerName}
                  onChange={e => onCustomerNameChange(e.target.value)}
                  placeholder="Your name"
                  className="flex-1 px-4 py-2.5 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={e => onCustomerPhoneChange(e.target.value)}
                  placeholder="Your phone number"
                  className="flex-1 px-4 py-2.5 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>

              {orderError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{orderError}</p>
              )}
            </div>
          )}
        </div>
        {cart.length > 0 && (
          <div className="p-5 sm:p-6 border-t border-zinc-200 bg-zinc-50">
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-zinc-900">Total</span>
              <span className="text-xl font-bold text-zinc-900">{formatPrice(total, currency)}</span>
            </div>
            <button
              onClick={onSubmit}
              disabled={submittingOrder || orderSuccess}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${orderSuccess ? 'bg-green-500 text-white' : 'bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50'}`}
            >
              {submittingOrder ? 'Submitting...' : orderSuccess ? 'Order submitted!' : 'Confirm order'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
