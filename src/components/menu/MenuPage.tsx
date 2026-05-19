'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { formatPrice, getInitials } from '@/lib/utils'
import type { Category, Product, TenantWithSettings, ProductIngredientWithIngredient, IngredientModifications, DeliveryZone, ProductMedia } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { UI_COPY, type CartItem, buildCartKey, getProductImages } from './menu-utils'
import {
  MapPin,
  Phone,
  Clock,
  Search,
  X,
  ChevronRight,
  ChevronLeft,
  Star,
  Camera,
  MessageCircle,
  Mail,
  ShoppingBag
} from 'lucide-react'

const ProductModal = dynamic(() => import('./ProductModal'), { ssr: false })
const CartModal = dynamic(() => import('./CartModal'), { ssr: false })
const AiChatWidget = dynamic(() => import('./AiChatWidget'), { ssr: false })

interface Props {
  tenant: TenantWithSettings
  categories: Category[]
  products: Product[]
  menu?: {
    id?: string
    name: string
    description?: string | null
    language: string
    supported_languages?: string[]
    translations?: Record<string, { name?: string; description?: string }>
  } | null
  location?: { id: string; name: string } | null
  initialLanguage?: string
  footerBrand?: string
  optionGroupsByProductId?: Record<string, GroupWithOptions[]>
  ingredientCustomizationEnabled?: boolean
  productIngredientsByProductId?: Record<string, ProductIngredientWithIngredient[]>
  deliveryZones?: DeliveryZone[]
  productMediaByProductId?: Record<string, ProductMedia[]>
  chatAddonEnabled?: boolean
  chatAddonAudioEnabled?: boolean
}

const DAYS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
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

export default function MenuPage({ tenant, categories, products, menu = null, location = null, initialLanguage, footerBrand = 'XmartMenu', optionGroupsByProductId = {}, ingredientCustomizationEnabled = false, productIngredientsByProductId = {}, deliveryZones = [], productMediaByProductId = {}, chatAddonEnabled = false, chatAddonAudioEnabled = false }: Props) {
  const defaultOrderType = (tenant.tenant_settings?.dine_in_enabled ?? true) ? 'dine_in'
    : (tenant.tenant_settings?.pickup_enabled ?? false) ? 'pickup'
    : 'delivery'
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
  const [orderId, setOrderId] = useState<string | null>(null)
  const [confirmedCart, setConfirmedCart] = useState<CartItem[]>([])
  const [orderType, setOrderType] = useState(defaultOrderType)
  const [deliveryStreet, setDeliveryStreet] = useState('')
  const [deliveryComplement, setDeliveryComplement] = useState('')
  const [deliveryZipcode, setDeliveryZipcode] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [tipCents, setTipCents] = useState(0)
  const footerRef = useRef<HTMLElement | null>(null)
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({})
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const categoryFilterRef = useRef<HTMLDivElement | null>(null)

  const settings = tenant.tenant_settings
  const primaryColor = settings?.primary_color ?? '#EEFF00'
  const accentColor = settings?.accent_color ?? '#09090b'
  const ordersEnabled = settings?.orders_enabled ?? true
  const whatsapp = (ordersEnabled && settings?.whatsapp_orders_enabled) ? settings?.whatsapp : null
  const currency = settings?.currency ?? 'USD'
  const dineInEnabled = settings?.dine_in_enabled ?? true
  const pickupEnabled = settings?.pickup_enabled ?? false
  const deliveryEnabled = settings?.delivery_enabled ?? false
  const deliveryFeeCents = settings?.delivery_fee_cents ?? 0
  const orderTypeConfig = { dineIn: dineInEnabled, pickup: pickupEnabled, delivery: deliveryEnabled, deliveryFeeCents }
  const tipsEnabled = settings?.tips_enabled ?? false
  const tipPercentages: [number, number, number] = [
    settings?.tip_percentage_1 ?? 15,
    settings?.tip_percentage_2 ?? 18,
    settings?.tip_percentage_3 ?? 20,
  ]
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
    const msg = encodeURIComponent(`Hi! I'd like to order: ${product.name} | ${formatPrice(product.price, currency)}`)
    window.open(`https://wa.me/${whatsapp}?text=${msg}`, '_blank')
  }

  const directOrdersEnabled = settings?.direct_orders_enabled ?? false

  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  function addToCart(product: Product, selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null) {
    const key = buildCartKey(product.id, selectedOptions)
    setCart(prev => {
      const existing = prev.find(item => item.cartKey === key)
      if (existing) {
        return prev.map(item =>
          item.cartKey === key ? { ...item, quantity: item.quantity + 1, note: note ?? item.note, ingredientModifications: ingredientModifications ?? item.ingredientModifications } : item
        )
      }
      return [...prev, { product, quantity: 1, selectedOptions, unitPrice, cartKey: key, note, ingredientModifications }]
    })
  }

  function removeFromCart(itemCartKey: string) {
    setCart(prev => prev.filter(item => item.cartKey !== itemCartKey))
  }

  function updateCartQuantity(itemCartKey: string, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(itemCartKey)
      return
    }
    setCart(prev =>
      prev.map(item =>
        item.cartKey === itemCartKey ? { ...item, quantity } : item
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
    if (orderType === 'delivery' && !deliveryStreet.trim()) {
      setOrderError('Please enter your delivery street address')
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
          order_type: orderType,
          delivery_street: orderType === 'delivery' ? deliveryStreet.trim() || undefined : undefined,
          delivery_complement: orderType === 'delivery' && deliveryComplement.trim() ? deliveryComplement.trim() : undefined,
          delivery_zipcode: orderType === 'delivery' && deliveryZipcode.trim() ? deliveryZipcode.trim() : undefined,
          delivery_city: orderType === 'delivery' && deliveryCity.trim() ? deliveryCity.trim() : undefined,
          delivery_notes: orderType === 'delivery' && deliveryNotes.trim() ? deliveryNotes.trim() : undefined,
          delivery_address: orderType === 'delivery'
            ? [deliveryStreet, deliveryZipcode, deliveryCity].filter(Boolean).join(', ')
            : undefined,
          location_id: location?.id ?? null,
          tip_cents: tipCents,
          menu_id: menu?.id ?? null,
          items: cart.map(item => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            selected_options: item.selectedOptions,
            notes: item.note || undefined,
            ingredient_modifications: item.ingredientModifications || null,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit order')
      }

      setConfirmedCart([...cart])
      setOrderId(data.id)
      setOrderSuccess(true)
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      setDeliveryStreet('')
      setDeliveryComplement('')
      setDeliveryZipcode('')
      setDeliveryCity('')
      setDeliveryNotes('')
      setOrderType(defaultOrderType)
      setTipCents(0)
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
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Premium Header */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative text-white min-h-[280px] flex items-center justify-center overflow-hidden"
        style={!settings?.banner_url ? { backgroundColor: primaryColor } : undefined}
      >
        {/* Banner with modern treatment */}
        {settings?.banner_url && (
          <>
            <Image
              src={settings.banner_url}
              alt="Banner"
              fill
              priority
              sizes="100vw"
              className="object-cover scale-110"
            />
            {/* Multi-layer overlay for depth */}
            <div className="absolute inset-0 bg-black/40" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-zinc-950" />
            <div className="absolute inset-0" style={{ backgroundColor: primaryColor, opacity: 0.2 }} />
          </>
        )}

        {/* Header Content */}
        <div className="relative z-10 w-full max-w-5xl px-4 py-10 flex flex-col items-center">
          
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center gap-6"
          >
            {/* Title Group — logo above name on all screen sizes */}
            <div className="flex flex-col items-center gap-4">
              {/* Logo with Glassmorphism */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15 }}
              >
                {settings?.logo_url ? (
                  <div className="relative w-16 h-16 sm:w-20 sm:h-20 p-1 bg-white/10 backdrop-blur-xl rounded-lg ring-1 ring-white/30 shadow-2xl overflow-hidden">
                    <Image
                      src={settings.logo_url}
                      alt={tenant.name}
                      fill
                      priority
                      className="rounded-lg object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-white/10 backdrop-blur-xl ring-1 ring-white/40 flex items-center justify-center text-xl font-black tracking-tighter text-white shadow-2xl">
                    {getInitials(tenant.name)}
                  </div>
                )}
              </motion.div>

              <div className="text-center">
                <h1 className="text-3xl sm:text-4xl font-black tracking-tighter drop-shadow-xl text-white">
                  {tenant.name}
                </h1>
                {menuTitle && (
                  <div className="flex items-center justify-center gap-3 mt-1">
                    <p className="text-[10px] sm:text-xs font-black text-white/90 uppercase tracking-[0.3em]">
                      {menuTitle}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {settings?.tagline && (
              <p className="text-sm sm:text-base font-medium text-white/60 max-w-lg mx-auto text-center leading-relaxed">
                {settings.tagline}
              </p>
            )}



          </motion.div>
        </div>

        {/* Language Switcher */}
        {supportedLanguages.length > 1 && (
          <div className="absolute top-6 right-6 z-20">
            <div className="flex items-center gap-1.5 p-1.5 bg-black/40 backdrop-blur-2xl rounded-lg border border-white/10 shadow-2xl">
              {supportedLanguages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setSelectedLanguage(lang)
                    const url = new URL(window.location.href)
                    url.searchParams.set('lang', lang)
                    window.history.replaceState({}, '', url.toString())
                  }}
                  className={`text-[10px] font-black px-3 py-2 rounded-full transition-all duration-300 ${
                    selectedLanguage === lang 
                      ? 'bg-white text-zinc-900 shadow-xl scale-105' 
                      : 'text-white/50 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.header>

      {/* Modern Category Filter */}
      {categories.length > 0 && (
        <div className="sticky top-0 z-30 bg-zinc-50/80 backdrop-blur-xl border-b border-zinc-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div ref={categoryFilterRef} className="flex gap-2 justify-center items-center overflow-x-auto py-4 scrollbar-hide no-scrollbar">
              {hasHours && (
                <button
                  onClick={() => setShowHoursModal(true)}
                  className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-zinc-700 border border-zinc-200 hover:border-zinc-300 shadow-sm text-xs font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                >
                  <Clock className="w-3.5 h-3.5" />
                  {ui.hoursBtn}
                </button>
              )}

              <AnimatePresence mode="wait">
                {showSearch ? (
                  <motion.div
                    key="search-input"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <input
                      autoFocus
                      type="search"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Find something delicious..."
                      className="w-64 sm:w-96 px-6 py-2.5 rounded-full bg-white border border-zinc-200 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all shadow-sm"
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="categories-list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex gap-2"
                  >
                    <button
                      onClick={() => setActiveCategory(null)}
                      style={!activeCategory && !visibleCategory ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                      className={`flex-shrink-0 text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-full transition-all shadow-sm active:scale-95 ${
                        !activeCategory && !visibleCategory ? 'shadow-md scale-105' : 'bg-white text-zinc-700 border border-zinc-200 hover:border-zinc-300 hover:scale-105'
                      }`}
                    >
                      {ui.all}
                    </button>
                    {categories.filter(cat => cat.name?.trim()).map(cat => (
                      <button
                        key={cat.id}
                        ref={el => { categoryButtonRefs.current[cat.id] = el }}
                        onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                        style={activeCategory === cat.id || visibleCategory === cat.id ? { backgroundColor: primaryColor, color: '#fff' } : {}}
                        className={`flex-shrink-0 text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-full transition-all shadow-sm active:scale-95 ${
                          activeCategory === cat.id || visibleCategory === cat.id ? 'shadow-md scale-105' : 'bg-white text-zinc-700 border border-zinc-200 hover:border-zinc-300 hover:scale-105'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                onClick={() => { if (showSearch) { setShowSearch(false); setSearch('') } else { setShowSearch(true) } }}
                className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 ${
                  showSearch ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 border border-zinc-200 hover:border-zinc-300 shadow-sm'
                }`}
              >
                {showSearch ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Featured Section — full viewport width, outside max-w container */}
      {featured.length > 0 && !search && !activeCategory && (
        <section className="relative w-full pt-10 sm:pt-16 pb-0">
          <div className="w-full overflow-hidden pb-4">
            <div className="absolute top-3 sm:top-5 left-4 sm:left-6 lg:left-8 z-10 flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm border border-zinc-100">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              <span className="text-xs font-black text-zinc-900 uppercase tracking-widest">{ui.featured}</span>
            </div>
            <div className="flex gap-6 w-max px-4 sm:px-6 lg:px-8 animate-marquee">
              {[...featuredBase, ...featuredBase].map((p, idx) => (
                <motion.button
                  key={`${p.id}-${idx}`}
                  onClick={() => setSelectedProduct(p)}
                  whileHover={{ y: -8 }}
                  className="flex-shrink-0 w-64 sm:w-80 bg-white rounded-lg border border-zinc-100 overflow-hidden text-left shadow-lg shadow-zinc-200/50 hover:shadow-xl transition-all duration-500"
                >
                  <div className="relative w-full aspect-[4/3] bg-zinc-50 overflow-hidden">
                    {getProductImages(p)[0]
                      ? <Image src={getProductImages(p)[0]} alt={p.name} fill className="object-cover transition-transform duration-700 hover:scale-110" sizes="320px" />
                      : <div className="w-full h-full flex items-center justify-center text-4xl">🍽️</div>}
                    <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full shadow-sm">
                      <span style={{ color: accentColor }} className="text-sm font-black tracking-tight">{formatPrice(p.price, currency)}</span>
                    </div>
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-black text-zinc-900 leading-tight mb-2 truncate">{p.name}</h3>
                    <p className="text-xs text-zinc-500 font-medium line-clamp-2 leading-relaxed">
                      {p.description || "No description available."}
                    </p>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        View Details <ChevronRight className="w-3 h-3 ml-1" />
                      </div>
                      {directOrdersEnabled && (() => {
                        const cartKey = buildCartKey(p.id, {})
                        const qty = cart.find(i => i.cartKey === cartKey)?.quantity ?? 0
                        return qty === 0 ? (
                          <button
                            onClick={e => { e.stopPropagation(); addToCart(p, {}, p.price) }}
                            style={{ backgroundColor: primaryColor }}
                            className="w-9 h-9 rounded-full text-white flex items-center justify-center hover:opacity-80 active:scale-90 transition-all flex-shrink-0 shadow-md"
                          >
                            <ShoppingBag className="w-4 h-4" />
                          </button>
                        ) : (
                          <div onClick={e => e.stopPropagation()} className="flex items-center rounded-full border border-zinc-200 shadow-sm overflow-hidden">
                            <button onClick={() => updateCartQuantity(cartKey, qty - 1)} className="px-2.5 py-1.5 hover:bg-zinc-100 transition-all flex items-center justify-center">
                              <ChevronLeft className="w-3.5 h-3.5 text-zinc-600" />
                            </button>
                            <span className="text-sm font-black min-w-[1.25rem] text-center text-zinc-900 px-1">{qty}</span>
                            <button onClick={() => updateCartQuantity(cartKey, qty + 1)} className="px-2.5 py-1.5 hover:bg-zinc-100 transition-all flex items-center justify-center">
                              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </section>
      )}

      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-16"
        style={hasFixedFooter ? { paddingBottom: `${footerHeight + 40}px` } : undefined}
      >

        {filtered.length === 0 && (
          <div className="text-center py-24 bg-white rounded-xl border border-zinc-100 shadow-sm">
            <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Search className="w-10 h-10 text-zinc-300" />
            </div>
            <h3 className="text-xl font-black text-zinc-900 tracking-tight">{ui.noItems}</h3>
            <p className="text-zinc-500 mt-2 font-medium">{ui.tryAnother}</p>
          </div>
        )}

        {/* Regular Sections */}
        {groupedByCategory.map(({ category, items }, catIdx) => (
          <section
            key={category.id}
            ref={el => { categoryRefs.current[category.id] = el }}
            data-category-id={category.id}
            className="space-y-8"
          >
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-black text-zinc-900 tracking-tight whitespace-nowrap">
                {category.name}
              </h2>
              <div className="h-px w-full bg-zinc-100" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8">
              {items.map((p) => {
                const cartKey = buildCartKey(p.id, {})
                const qty = cart.find(i => i.cartKey === cartKey)?.quantity ?? 0
                return (
                  <ProductCard
                    key={p.id}
                    product={p}
                    accentColor={accentColor}
                    primaryColor={primaryColor}
                    currency={currency}
                    lang={selectedLanguage}
                    onClick={() => setSelectedProduct(p)}
                    {...(directOrdersEnabled ? {
                      cartQuantity: qty,
                      onAdd: () => addToCart(p, {}, p.price),
                      onIncrement: () => updateCartQuantity(cartKey, qty + 1),
                      onDecrement: () => updateCartQuantity(cartKey, qty - 1),
                    } : {})}
                  />
                )
              })}
            </div>
          </section>
        ))}

        {uncategorized.length > 0 && (
          <section className="space-y-8">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-black text-zinc-900 tracking-tight whitespace-nowrap">{ui.other}</h2>
              <div className="h-px w-full bg-zinc-100" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8">
              {uncategorized.map(p => {
                const cartKey = buildCartKey(p.id, {})
                const qty = cart.find(i => i.cartKey === cartKey)?.quantity ?? 0
                return (
                  <ProductCard
                    key={p.id}
                    product={p}
                    accentColor={accentColor}
                    primaryColor={primaryColor}
                    currency={currency}
                    lang={selectedLanguage}
                    onClick={() => setSelectedProduct(p)}
                    {...(directOrdersEnabled ? {
                      cartQuantity: qty,
                      onAdd: () => addToCart(p, {}, p.price),
                      onIncrement: () => updateCartQuantity(cartKey, qty + 1),
                      onDecrement: () => updateCartQuantity(cartKey, qty - 1),
                    } : {})}
                  />
                )
              })}
            </div>
          </section>
        )}
      </main>

      {/* Floating Cart Button */}
      {directOrdersEnabled && cart.length > 0 && !showCartModal && (
        <motion.button
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => setShowCartModal(true)}
          className="fixed bottom-8 right-8 z-40 bg-zinc-900 text-white pl-6 pr-4 py-4 rounded-lg shadow-2xl shadow-zinc-950/20 flex items-center gap-4 hover:bg-zinc-800 transition-all hover:scale-105 active:scale-95"
        >
          <div className="flex flex-col items-start leading-none">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">My Order</span>
            <span className="text-lg font-black">{formatPrice(cartTotal, currency)}</span>
          </div>
          <div className="relative bg-white/10 p-3 rounded-lg">
            <ShoppingBag className="w-5 h-5" />
            <div className="absolute -top-1.5 -right-1.5 text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-black shadow-lg ring-2 ring-zinc-900 text-primary-foreground" style={{ backgroundColor: primaryColor }}>{cartCount}</div>
          </div>
        </motion.button>
      )}

      {/* Footer */}
      {hasFixedFooter && (
        <footer ref={footerRef} className={`fixed bottom-0 inset-x-0 z-40 border-t border-zinc-100 bg-white/90 backdrop-blur-2xl transition-all duration-500 ${showFooterAtEnd ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              {hasContact && (
                <div className="flex flex-wrap items-center justify-center gap-8 text-xs font-bold text-zinc-500">
                  {settings?.address && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900 flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5" /> <span className="max-w-[220px] line-clamp-1">{settings.address}</span>
                    </a>
                  )}
                  {settings?.phone && (
                    <a href={`tel:${settings.phone}`} className="hover:text-zinc-900 flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5" /> {settings.phone}
                    </a>
                  )}
                  {settings?.whatsapp && (
                    <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900 flex items-center gap-2 text-green-600">
                      <MessageCircle className="w-3.5 h-3.5 fill-green-600/10" /> WhatsApp
                    </a>
                  )}
                  {settings?.instagram && (
                    <a href={`https://instagram.com/${settings.instagram}`} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900 flex items-center gap-2 text-pink-600">
                      <Camera className="w-3.5 h-3.5" /> @{settings.instagram}
                    </a>
                  )}
                  {email && (
                    <a href={`mailto:${email}`} className="hover:text-zinc-900 flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5" /> {email}
                    </a>
                  )}
                </div>
              )}
              {footerBrand && (
                <div className="text-[10px] font-black text-zinc-300 uppercase tracking-[0.3em]">
                  Powered by <a href="/" className="text-zinc-900 hover:text-primary transition-colors">{footerBrand}</a>
                </div>
              )}
            </div>
          </div>
        </footer>
      )}

      {/* Modals */}
      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          accentColor={accentColor}
          currency={currency}
          whatsapp={whatsapp}
          lang={selectedLanguage}
          onClose={() => setSelectedProduct(null)}
          onWhatsApp={() => openWhatsApp(selectedProduct)}
          optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []}
          itemNotesEnabled={settings?.item_notes_enabled ?? false}
          ingredientCustomizationEnabled={ingredientCustomizationEnabled}
          productIngredients={productIngredientsByProductId[selectedProduct.id] ?? []}
          productMedia={productMediaByProductId[selectedProduct.id] ?? []}
          onAddToCart={directOrdersEnabled
            ? (selectedOptions, unitPrice, note, ingredientModifications) => {
                addToCart(selectedProduct, selectedOptions, unitPrice, note, ingredientModifications)
                setSelectedProduct(null)
              }
            : undefined}
        />
      )}

      {chatAddonEnabled && (
        <AiChatWidget
          tenantSlug={tenant.slug}
          tenantName={tenant.name}
          primaryColor={(settings as any)?.primary_color ?? '#EEFF00'}
          audioEnabled={chatAddonAudioEnabled}
          products={products}
          onAddToCart={addToCart}
        />
      )}

      <AnimatePresence>
        {showHoursModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setShowHoursModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-lg shadow-2xl overflow-hidden" 
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 border-b border-zinc-50 flex items-center justify-between bg-zinc-50/50">
                <h3 className="text-xl font-black text-zinc-900 tracking-tight flex items-center gap-3">
                  <Clock className="w-5 h-5 text-primary" />
                  {ui.hoursTitle}
                </h3>
                <button onClick={() => setShowHoursModal(false)} className="p-2 hover:bg-white rounded-full transition-colors"><X className="w-5 h-5 text-zinc-400" /></button>
              </div>
              <div className="p-8 space-y-4">
                {Object.entries(DAYS).map(([key, label]) => {
                  const value = hours?.[key as keyof typeof hours]
                  if (!value) return null
                  return (
                    <div key={key} className="flex justify-between items-center py-2 border-b border-zinc-50 last:border-0">
                      <span className="text-sm font-bold text-zinc-500">{label}</span>
                      <span className="text-sm font-black text-zinc-900">{value}</span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showCartModal && (
        <CartModal
          cart={cart}
          confirmedCart={confirmedCart}
          currency={currency}
          customerName={customerName}
          customerPhone={customerPhone}
          submittingOrder={submittingOrder}
          orderSuccess={orderSuccess}
          orderError={orderError}
          orderId={orderId}
          ui={ui}
          accentColor={accentColor}
          onClose={() => {
            setShowCartModal(false)
            setOrderSuccess(false)
            setOrderId(null)
          }}
          onCustomerNameChange={setCustomerName}
          onCustomerPhoneChange={setCustomerPhone}
          onRemove={removeFromCart}
          onUpdateQuantity={updateCartQuantity}
          onSubmit={submitOrder}
          orderTypeConfig={orderTypeConfig}
          orderType={orderType}
          deliveryStreet={deliveryStreet}
          deliveryComplement={deliveryComplement}
          deliveryZipcode={deliveryZipcode}
          deliveryCity={deliveryCity}
          deliveryNotes={deliveryNotes}
          deliveryZones={deliveryZones}
          onOrderTypeChange={setOrderType}
          onDeliveryFieldChange={(field, value) => {
            if (field === 'street') setDeliveryStreet(value)
            else if (field === 'complement') setDeliveryComplement(value)
            else if (field === 'zipcode') setDeliveryZipcode(value)
            else if (field === 'city') setDeliveryCity(value)
            else if (field === 'notes') setDeliveryNotes(value)
          }}
          tipsEnabled={tipsEnabled}
          tipPercentages={tipPercentages}
          tipCents={tipCents}
          onTipChange={setTipCents}
        />
      )}
    </div>
  )
}

const TAG_TRANSLATIONS: Record<string, Record<string, string>> = {
  'Vegetarian': { en: 'Vegetarian' },
  'Vegan': { en: 'Vegan' },
  'Gluten-Free': { en: 'Gluten-Free' },
  'Spicy': { en: 'Spicy' },
  'Chef\'s special': { en: 'Chef\'s special' },
}

const TAG_COLORS: Record<string, string> = {
  'Vegetarian': 'bg-green-50 text-green-700 ring-1 ring-green-100',
  'Vegan': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  'Gluten-Free': 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  'Spicy': 'bg-red-50 text-red-700 ring-1 ring-red-100',
  'Chef\'s special': 'bg-purple-50 text-purple-700 ring-1 ring-purple-100',
}

function translateTag(tag: string, lang: string): string {
  return TAG_TRANSLATIONS[tag]?.[lang] ?? tag
}

function getTagStyle(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-zinc-50 text-zinc-600 ring-1 ring-zinc-100'
}

function ProductCard({ product, accentColor, primaryColor, currency, lang, onClick, cartQuantity, onAdd, onIncrement, onDecrement }: {
  product: Product; accentColor: string; primaryColor: string; currency: string; lang: string; onClick: () => void
  cartQuantity?: number; onAdd?: () => void; onIncrement?: () => void; onDecrement?: () => void
}) {
  const images = getProductImages(product)
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="group w-full bg-white rounded-lg border border-zinc-100 overflow-hidden text-left shadow-sm hover:shadow-xl hover:shadow-zinc-200/40 transition-all duration-300"
    >
      <div className="relative w-full aspect-square bg-zinc-50 overflow-hidden">
        {images[0]
          ? <Image src={images[0]} alt={product.name} fill className="object-cover transition-transform duration-700 group-hover:scale-110" sizes="(max-width: 768px) 50vw, 25vw" />
          : <div className="w-full h-full flex items-center justify-center text-4xl bg-zinc-50">🍽️</div>}

        {product.is_featured && (
          <div className="absolute top-4 left-4 bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
            <Star className="w-3 h-3 fill-white" /> Featured
          </div>
        )}

        <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm border border-white/20">
          <span style={{ color: accentColor }} className="text-sm font-black tracking-tight">{formatPrice(product.price, currency)}</span>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-black text-zinc-900 leading-tight line-clamp-1">{product.name}</h3>
        </div>

        {product.tags?.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {product.tags.map(tag => {
              const translated = translateTag(tag, lang)
              return <span key={tag} className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-sm ${getTagStyle(translated)}`}>{translated}</span>
            })}
          </div>
        )}

        {product.description && (
          <p className="text-xs text-zinc-500 font-medium line-clamp-2 leading-relaxed mb-4">
            {product.description}
          </p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-zinc-300 group-hover:text-zinc-900 transition-colors">
            Order Now <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
          {onAdd && (cartQuantity ?? 0) === 0 && (
            <button
              onClick={e => { e.stopPropagation(); onAdd() }}
              style={{ backgroundColor: primaryColor }}
              className="w-9 h-9 rounded-full text-white flex items-center justify-center hover:opacity-80 active:scale-90 transition-all flex-shrink-0 shadow-md"
            >
              <ShoppingBag className="w-4 h-4" />
            </button>
          )}
          {onIncrement && onDecrement && (cartQuantity ?? 0) > 0 && (
            <div onClick={e => e.stopPropagation()} className="flex items-center rounded-full border border-zinc-200 shadow-sm overflow-hidden">
              <button onClick={onDecrement} className="px-2.5 py-1.5 hover:bg-zinc-100 transition-all flex items-center justify-center">
                <ChevronLeft className="w-3.5 h-3.5 text-zinc-600" />
              </button>
              <span className="text-sm font-black min-w-[1.25rem] text-center text-zinc-900 px-1">{cartQuantity}</span>
              <button onClick={onIncrement} className="px-2.5 py-1.5 hover:bg-zinc-100 transition-all flex items-center justify-center">
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.button>
  )
}
