'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { formatPrice, getInitials } from '@/lib/utils'
import { MenuAnalyticsTracker } from '@/lib/analytics/client'
import type { Category, Product, TenantWithSettings, ProductIngredientWithIngredient, IngredientModifications, DeliveryZone, ProductMedia } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { UI_COPY, type CartItem, type CartEditorState, buildCartKey, getProductImages, isProductVisibleInFeed } from './menu-utils'
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
  ShoppingBag,
  LayoutGrid,
  Rows3,
  Sparkles
} from 'lucide-react'

const ProductModal = dynamic(() => import('./ProductModal'), { ssr: false })
const CartPanel = dynamic(() => import('./CartPanel'), { ssr: false })
const CheckoutModal = dynamic(() => import('./CheckoutModal'), { ssr: false })
const AiChatWidget = dynamic(() => import('./AiChatWidget'), { ssr: false })
const MenuFeed = dynamic(() => import('./MenuFeed'))
const AnalyticsDebugPanel = dynamic(() => import('./AnalyticsDebugPanel'), { ssr: false })

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)'

function subscribeToMobileViewport(onChange: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY)
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}

function getMobileViewportSnapshot() {
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
}

function getServerMobileViewportSnapshot() {
  return false
}

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
  const router = useRouter()
  const [feedPreview, setFeedPreview] = useState(false)
  const feedEnabled = (tenant.tenant_settings?.visual_feed_enabled ?? true) || feedPreview
  const [menuView, setMenuView] = useState<'list' | 'feed'>(() =>
    feedEnabled && tenant.tenant_settings?.menu_default_view === 'feed' ? 'feed' : 'list'
  )
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  )
  const activeMenuView = isMobileViewport ? menuView : 'list'
  const defaultOrderType = (tenant.tenant_settings?.dine_in_enabled ?? true) ? 'dine_in'
    : (tenant.tenant_settings?.pickup_enabled ?? false) ? 'pickup'
    : 'delivery'
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedProductSource, setSelectedProductSource] = useState<'grid' | 'featured' | 'detail' | 'cart' | 'feed'>('detail')
  const [showFooterAtEnd, setShowFooterAtEnd] = useState(false)
  const [footerHeight, setFooterHeight] = useState(0)
  const [pauseFeaturedAutoScroll, setPauseFeaturedAutoScroll] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage ?? menu?.language ?? 'en')
  const [visibleCategory, setVisibleCategory] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [editingCartKey, setEditingCartKey] = useState<string | null>(null)
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
  const [analyticsTracker, setAnalyticsTracker] = useState<MenuAnalyticsTracker | null>(null)
  const [analyticsDebug, setAnalyticsDebug] = useState(false)
  const footerRef = useRef<HTMLElement | null>(null)
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({})
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const categoryFilterRef = useRef<HTMLDivElement | null>(null)
  const autoOpenedRef = useRef(false)

  const settings = tenant.tenant_settings
  const primaryColor = settings?.primary_color ?? '#F52323'
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
  const analyticsEnabled = settings?.analytics_enabled ?? true
  const feedAutoplayVideos = settings?.feed_autoplay_videos ?? true
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

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (new URLSearchParams(window.location.search).get('feed_preview') === '1') {
      setFeedPreview(true)
      setMenuView('feed')
    }
  }, [])

  useEffect(() => {
    if (activeMenuView !== 'feed') return
    const previousBodyOverflow = document.body.style.overflow
    const previousOverscroll = document.documentElement.style.overscrollBehavior
    const previousFeedState = document.body.dataset.menuFeed
    document.body.style.overflow = 'hidden'
    document.body.dataset.menuFeed = 'open'
    document.documentElement.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      if (previousFeedState === undefined) delete document.body.dataset.menuFeed
      else document.body.dataset.menuFeed = previousFeedState
      document.documentElement.style.overscrollBehavior = previousOverscroll
    }
  }, [activeMenuView])

  const filtered = products.filter(p => {
    const matchSearch = search === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCategory = !activeCategory || p.category_id === activeCategory
    return matchSearch && matchCategory
  })
  const feedProducts = filtered.filter(isProductVisibleInFeed)

  const categoryIds = new Set(categories.map(c => c.id))

  const groupedByCategory = categories.map(cat => ({
    category: cat,
    items: filtered.filter(p => p.category_id === cat.id),
  })).filter(g => g.items.length > 0)

  const uncategorized = filtered.filter(p => !p.category_id || !categoryIds.has(p.category_id))

  // Flat list in display order — used for prev/next navigation inside the product modal.
  const orderedProducts = [...groupedByCategory.flatMap(g => g.items), ...uncategorized]

  function openWhatsApp(product: Product) {
    if (!whatsapp) return
    const msg = encodeURIComponent(`Hi! I'd like to order: ${product.name} | ${formatPrice(product.price, currency)}`)
    window.open(`https://wa.me/${whatsapp}?text=${msg}`, '_blank')
  }

  const directOrdersEnabled = settings?.direct_orders_enabled ?? false

  function openProduct(product: Product, source: 'grid' | 'featured' | 'detail' | 'cart' | 'feed') {
    setSelectedProductSource(source)
    setSelectedProduct(product)
  }

  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  function addToCart(product: Product, selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null, editorState?: CartEditorState | null, source?: 'grid' | 'featured' | 'detail' | 'cart' | 'feed') {
    const key = buildCartKey(product.id, selectedOptions)
    setCart(prev => {
      const existing = prev.find(item => item.cartKey === key)
      if (existing) {
        return prev.map(item =>
          item.cartKey === key ? { ...item, quantity: item.quantity + 1, note: note ?? item.note, ingredientModifications: ingredientModifications ?? item.ingredientModifications, editorState: editorState ?? item.editorState } : item
        )
      }
      return [...prev, { product, quantity: 1, selectedOptions, unitPrice, cartKey: key, note, ingredientModifications, editorState }]
    })
    analyticsTracker?.track({
      event_name: 'add_to_cart',
      product_id: product.id,
      quantity: 1,
      source: source ?? (selectedProduct?.id === product.id ? 'detail' : 'grid'),
    })
  }

  // Re-save an edited item: drop the original entry and re-insert under its new
  // cart key, preserving the original quantity. Merges into an identical existing
  // item instead of creating a duplicate.
  function replaceCartItem(oldKey: string, product: Product, selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null, editorState?: CartEditorState | null) {
    const newKey = buildCartKey(product.id, selectedOptions)
    setCart(prev => {
      const old = prev.find(item => item.cartKey === oldKey)
      const qty = old?.quantity ?? 1
      const without = prev.filter(item => item.cartKey !== oldKey)
      const existing = without.find(item => item.cartKey === newKey)
      if (existing) {
        return without.map(item =>
          item.cartKey === newKey ? { ...item, quantity: item.quantity + qty, unitPrice, note, ingredientModifications, editorState } : item
        )
      }
      return [...without, { product, quantity: qty, selectedOptions, unitPrice, cartKey: newKey, note, ingredientModifications, editorState }]
    })
  }

  function editItem(itemCartKey: string) {
    const item = cart.find(i => i.cartKey === itemCartKey)
    if (!item) return
    setEditingCartKey(itemCartKey)
    openProduct(item.product, 'cart')
    setCartOpen(false)
  }

  function removeFromCart(itemCartKey: string) {
    const item = cart.find(cartItem => cartItem.cartKey === itemCartKey)
    if (item) {
      analyticsTracker?.track({
        event_name: 'remove_from_cart',
        product_id: item.product.id,
        quantity: item.quantity,
        source: 'cart',
      })
    }
    setCart(prev => prev.filter(item => item.cartKey !== itemCartKey))
  }

  function updateCartQuantity(itemCartKey: string, quantity: number) {
    const item = cart.find(cartItem => cartItem.cartKey === itemCartKey)
    if (quantity <= 0) {
      removeFromCart(itemCartKey)
      return
    }
    if (item && quantity !== item.quantity) {
      analyticsTracker?.track({
        event_name: quantity > item.quantity ? 'add_to_cart' : 'remove_from_cart',
        product_id: item.product.id,
        quantity: Math.abs(quantity - item.quantity),
        source: 'cart',
      })
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
          analytics_session_id: analyticsTracker?.sessionId ?? null,
          items: cart.map(item => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            selected_options: item.selectedOptions,
            notes: item.note || undefined,
            ingredient_modifications: item.ingredientModifications || null,
            editor_state: item.editorState || null,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit order')
      }

      // Customer (QR / public-menu) orders that require online payment skip the
      // "order placed" screen and go straight to the Stripe checkout. The order
      // already exists in 'awaiting_payment' and only reaches the kitchen once
      // the payment webhook flips it to 'paid'.
      if (data.requires_payment) {
        router.push(`/checkout/${data.id}`)
        return
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
    if (!menu?.id || !analyticsEnabled) return
    const isTest = new URLSearchParams(window.location.search).get('analytics_debug') === '1'
    setAnalyticsDebug(isTest)
    const tracker = new MenuAnalyticsTracker({
      tenantId: tenant.id,
      menuId: menu.id,
      locationId: location?.id ?? null,
      language: initialLanguage ?? menu.language,
      isTest,
    })
    setAnalyticsTracker(tracker)
    if (tracker.isNewSession) {
      tracker.track({ event_name: 'menu_session_started' })
      void tracker.flush()
    }
    return () => {
      tracker.destroy()
      setAnalyticsTracker(current => current === tracker ? null : current)
    }
  }, [tenant.id, menu?.id, menu?.language, location?.id, initialLanguage, analyticsEnabled])

  useEffect(() => {
    if (!analyticsTracker || !selectedProduct) return
    analyticsTracker.track({
      event_name: 'product_detail_opened',
      product_id: selectedProduct.id,
      source: selectedProductSource,
    })
  }, [analyticsTracker, selectedProduct, selectedProductSource])

  useEffect(() => {
    if (!analyticsTracker || !checkoutOpen) return
    analyticsTracker.track({ event_name: 'checkout_started', source: 'checkout' })
    void analyticsTracker.flush()
  }, [analyticsTracker, checkoutOpen])

  useEffect(() => {
    if (!analyticsTracker || !search.trim()) return
    const timeout = window.setTimeout(() => {
      analyticsTracker.track({
        event_name: 'search_performed',
        query_length: search.trim().length,
        source: 'search',
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [analyticsTracker, search])

  useEffect(() => {
    if (!analyticsTracker) return
    const timers = new Map<Element, ReturnType<typeof setTimeout>>()
    const engagement = new Map<string, {
      targets: Set<Element>
      startedAt: number | null
      accumulatedMs: number
      source: 'featured' | 'grid' | 'feed'
    }>()

    const readProduct = (element: Element) => {
      const htmlElement = element as HTMLElement
      const productId = htmlElement.dataset.analyticsProductId
      const source = htmlElement.dataset.analyticsSource === 'featured'
        ? 'featured' as const
        : htmlElement.dataset.analyticsSource === 'feed'
          ? 'feed' as const
          : 'grid' as const
      return productId ? { productId, source } : null
    }

    const pauseEngagement = (state: { startedAt: number | null; accumulatedMs: number }) => {
      if (state.startedAt === null) return
      state.accumulatedMs += performance.now() - state.startedAt
      state.startedAt = null
    }

    const emitEngagement = (productId: string, state: { startedAt: number | null; accumulatedMs: number; source: 'featured' | 'grid' | 'feed' }) => {
      pauseEngagement(state)
      const durationMs = Math.min(3_600_000, Math.round(state.accumulatedMs))
      if (durationMs >= 1_000) {
        analyticsTracker.track({
          event_name: 'product_engagement',
          product_id: productId,
          duration_ms: durationMs,
          source: state.source,
        })
      }
    }

    const startEngagement = (element: Element) => {
      const product = readProduct(element)
      if (!product) return
      const state = engagement.get(product.productId) ?? {
        targets: new Set<Element>(),
        startedAt: null,
        accumulatedMs: 0,
        source: product.source,
      }
      const wasEmpty = state.targets.size === 0
      state.targets.add(element)
      if (wasEmpty && document.visibilityState === 'visible') state.startedAt = performance.now()
      engagement.set(product.productId, state)
    }

    const stopEngagement = (element: Element) => {
      const product = readProduct(element)
      if (!product) return
      const state = engagement.get(product.productId)
      if (!state) return
      state.targets.delete(element)
      if (state.targets.size === 0) {
        emitEngagement(product.productId, state)
        engagement.delete(product.productId)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        engagement.forEach(state => pauseEngagement(state))
        void analyticsTracker.flush(true)
      } else {
        const now = performance.now()
        engagement.forEach(state => {
          if (state.targets.size > 0 && state.startedAt === null) state.startedAt = now
        })
      }
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const existingTimer = timers.get(entry.target)
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          startEngagement(entry.target)
          if (existingTimer) continue
          const timer = setTimeout(() => {
            const product = readProduct(entry.target)
            if (product) analyticsTracker.trackProductImpression(product.productId, product.source)
            timers.delete(entry.target)
          }, 1_000)
          timers.set(entry.target, timer)
        } else {
          stopEngagement(entry.target)
          if (existingTimer) {
            clearTimeout(existingTimer)
            timers.delete(entry.target)
          }
        }
      }
    }, { threshold: [0, 0.5] })

    const elements = document.querySelectorAll('[data-analytics-product-id]')
    elements.forEach(element => observer.observe(element))
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      timers.forEach(timer => clearTimeout(timer))
      engagement.forEach((state, productId) => emitEngagement(productId, state))
      void analyticsTracker.flush(true)
    }
  }, [analyticsTracker, activeCategory, search, filtered.length, featured.length, activeMenuView])

  function selectCategory(categoryId: string | null) {
    const nextCategory = categoryId && activeCategory === categoryId ? null : categoryId
    setActiveCategory(nextCategory)
    if (nextCategory) {
      analyticsTracker?.track({
        event_name: 'category_selected',
        category_id: nextCategory,
      })
    }
  }

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

  // Auto-open the side panel once on desktop when the first item is added.
  useEffect(() => {
    if (cart.length === 0) {
      autoOpenedRef.current = false
      return
    }
    if (!autoOpenedRef.current && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setCartOpen(true)
      autoOpenedRef.current = true
    }
  }, [cart.length])


  // Match the panel's actual on-screen visibility so the page reflow never
  // desyncs from the panel (e.g. emptying the cart while the panel is open, or
  // opening checkout). CartPanel uses the same `cartOpen && !checkoutOpen`.
  const panelPushing = directOrdersEnabled && cartOpen && !checkoutOpen
  const editingItem = editingCartKey ? cart.find(i => i.cartKey === editingCartKey) ?? null : null

  function closeProductModal() {
    setSelectedProduct(null)
    setSelectedProductSource('detail')
    setEditingCartKey(null)
    if (cart.length > 0 && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setCartOpen(true)
    }
  }

  return (
    <div className={`min-h-screen bg-zinc-50 text-zinc-900 transition-[padding] duration-300 ${panelPushing ? 'lg:pr-[380px]' : ''}`}>
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
      {(categories.length > 0 || feedEnabled) && (
        <div className="sticky top-0 z-30 bg-zinc-50/80 backdrop-blur-xl border-b border-zinc-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div ref={categoryFilterRef} className="flex gap-2 justify-start md:justify-center items-center overflow-x-auto py-4 scrollbar-hide no-scrollbar">
              {feedEnabled && (
                <button
                  type="button"
                  onClick={() => setMenuView(activeMenuView === 'feed' ? 'list' : 'feed')}
                  aria-pressed={activeMenuView === 'feed'}
                  aria-label={activeMenuView === 'feed' ? ui.viewMenu : ui.viewFeed}
                  style={activeMenuView === 'feed'
                    ? { backgroundColor: accentColor }
                    : { backgroundColor: primaryColor, boxShadow: `0 10px 24px ${primaryColor}35` }}
                  className="md:hidden flex h-10 flex-shrink-0 items-center gap-2 rounded-full px-4 text-[11px] font-black uppercase tracking-[0.14em] text-white transition-all active:scale-95"
                >
                  {activeMenuView === 'feed' ? <Rows3 className="size-4" /> : <LayoutGrid className="size-4" />}
                  <span>{activeMenuView === 'feed' ? ui.viewMenu : ui.viewFeed}</span>
                </button>
              )}
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
                      onClick={() => selectCategory(null)}
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
                        onClick={() => selectCategory(cat.id)}
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
                aria-label={showSearch ? 'Close search' : 'Search menu'}
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
      {activeMenuView === 'list' && featured.length > 0 && !search && !activeCategory && (
        <section className="relative w-full pt-10 sm:pt-16 pb-0">
          <div className="scrollbar-hide w-full overflow-x-auto pb-4 md:overflow-hidden">
            <div className="absolute top-3 sm:top-5 left-4 sm:left-6 lg:left-8 z-10 flex items-center gap-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm border border-zinc-100">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              <span className="text-xs font-black text-zinc-900 uppercase tracking-widest">{ui.featured}</span>
            </div>
            <div className="flex gap-6 w-max px-4 sm:px-6 lg:px-8 animate-marquee">
              {[...featuredBase, ...featuredBase].map((p, idx) => (
                <motion.div
                  key={`${p.id}-${idx}`}
                  data-analytics-product-id={p.id}
                  data-analytics-source="featured"
                  role="button"
                  tabIndex={0}
                  onClick={() => openProduct(p, 'featured')}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProduct(p, 'featured') } }}
                  whileHover={{ y: -8 }}
                  className="flex-shrink-0 w-64 sm:w-80 bg-white rounded-lg border border-zinc-100 overflow-hidden text-left shadow-lg shadow-zinc-200/50 hover:shadow-xl transition-all duration-500 cursor-pointer"
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
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-16"
        style={hasFixedFooter ? { paddingBottom: `${footerHeight + 40}px` } : undefined}
      >

        {activeMenuView === 'list' && filtered.length === 0 && (
          <div className="text-center py-24 bg-white rounded-xl border border-zinc-100 shadow-sm">
            <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Search className="w-10 h-10 text-zinc-300" />
            </div>
            <h3 className="text-xl font-black text-zinc-900 tracking-tight">{ui.noItems}</h3>
            <p className="text-zinc-500 mt-2 font-medium">{ui.tryAnother}</p>
          </div>
        )}

        {activeMenuView === 'feed' && feedProducts.length > 0 ? (
          <MenuFeed
            products={feedProducts}
            productMediaByProductId={productMediaByProductId}
            currency={currency}
            primaryColor={primaryColor}
            accentColor={accentColor}
            autoplayVideos={feedAutoplayVideos}
            directOrdersEnabled={directOrdersEnabled}
            cartCount={cartCount}
            exitLabel={ui.viewMenu}
            onExit={() => setMenuView('list')}
            onOpenCart={() => setCartOpen(true)}
            hasCustomization={productId =>
              (optionGroupsByProductId[productId]?.length ?? 0) > 0
              || (ingredientCustomizationEnabled && (productIngredientsByProductId[productId]?.length ?? 0) > 0)
            }
            quantityFor={productId => cart.find(item => item.cartKey === buildCartKey(productId, {}))?.quantity ?? 0}
            onOpen={product => openProduct(product, 'feed')}
            onAdd={product => addToCart(product, {}, product.price, undefined, undefined, undefined, 'feed')}
            onIncrement={product => {
              const key = buildCartKey(product.id, {})
              const quantity = cart.find(item => item.cartKey === key)?.quantity ?? 0
              updateCartQuantity(key, quantity + 1)
            }}
            onDecrement={product => {
              const key = buildCartKey(product.id, {})
              const quantity = cart.find(item => item.cartKey === key)?.quantity ?? 0
              updateCartQuantity(key, quantity - 1)
            }}
            onMediaEvent={(eventName, product, mediaType, mediaIndex) => analyticsTracker?.track({
              event_name: eventName,
              product_id: product.id,
              source: 'feed',
              media_type: mediaType,
              media_index: mediaIndex,
            })}
          />
        ) : activeMenuView === 'feed' ? (
          <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-zinc-950 px-6 text-center text-white md:hidden" role="status">
            <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-zinc-50">
              <Sparkles className="size-7 text-zinc-300" />
            </div>
            <h3 className="text-xl font-black tracking-tight">{ui.feedEmptyTitle}</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm font-medium text-white/60">{ui.feedEmptyDescription}</p>
            <button
              type="button"
              onClick={() => setMenuView('list')}
              style={{ backgroundColor: primaryColor }}
              className="mt-6 min-h-11 rounded-full px-6 text-xs font-black uppercase tracking-[0.14em] text-white transition-transform active:scale-95"
            >
              {ui.viewMenu}
            </button>
          </div>
        ) : activeMenuView === 'list' ? (
          <>
        {/* Regular Sections */}
        {groupedByCategory.map(({ category, items }) => (
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
                    onClick={() => openProduct(p, 'grid')}
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
                    onClick={() => openProduct(p, 'grid')}
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
          </>
        ) : null}
      </main>

      {/* Desktop: floating button to re-open the side panel after it's collapsed */}
      {directOrdersEnabled && cart.length > 0 && !cartOpen && !checkoutOpen && activeMenuView === 'list' && (
        <motion.button
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => setCartOpen(true)}
          className="hidden lg:flex fixed bottom-8 right-8 z-40 bg-zinc-900 text-white pl-6 pr-4 py-4 rounded-lg shadow-2xl shadow-zinc-950/20 items-center gap-4 hover:bg-zinc-800 transition-all hover:scale-105 active:scale-95"
          aria-label="Open cart"
        >
          <div className="flex flex-col items-start leading-none">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">My Order</span>
            <span className="text-lg font-black">{formatPrice(cartTotal, currency)}</span>
          </div>
          <div className="relative bg-white/10 p-3 rounded-lg">
            <ShoppingBag className="w-5 h-5" />
            <div className="absolute -top-1.5 -right-1.5 text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-black shadow-lg ring-2 ring-zinc-900 text-white" style={{ backgroundColor: primaryColor }}>{cartCount}</div>
          </div>
        </motion.button>
      )}

      {/* Mobile: bottom order bar that opens the cart drawer */}
      {directOrdersEnabled && cart.length > 0 && !cartOpen && !checkoutOpen && activeMenuView === 'list' && (
        <motion.button
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => setCartOpen(true)}
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-zinc-900 text-white px-5 py-4 flex items-center justify-between gap-4 shadow-2xl shadow-zinc-950/30"
        >
          <div className="flex items-center gap-3">
            <div className="relative bg-white/10 p-2.5 rounded-lg">
              <ShoppingBag className="w-5 h-5" />
              <div className="absolute -top-1.5 -right-1.5 text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-black shadow-lg ring-2 ring-zinc-900 text-white" style={{ backgroundColor: primaryColor }}>{cartCount}</div>
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-zinc-300">View order</span>
          </div>
          <span className="text-lg font-black">{formatPrice(cartTotal, currency)}</span>
        </motion.button>
      )}

      {/* Footer */}
      {hasFixedFooter && activeMenuView === 'list' && (
        <footer ref={footerRef} className={`fixed bottom-0 inset-x-0 z-40 border-t border-zinc-100 bg-white/90 backdrop-blur-2xl transition-all duration-500 ${panelPushing ? 'lg:right-[380px]' : ''} ${showFooterAtEnd ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
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
      {selectedProduct && (() => {
        const navIndex = orderedProducts.findIndex(p => p.id === selectedProduct.id)
        const prevProduct = navIndex > 0 ? orderedProducts[navIndex - 1] : null
        const nextProduct = navIndex >= 0 && navIndex < orderedProducts.length - 1 ? orderedProducts[navIndex + 1] : null
        return (
        <ProductModal
          product={selectedProduct}
          onPrevProduct={!editingCartKey && prevProduct ? () => openProduct(prevProduct, 'detail') : undefined}
          onNextProduct={!editingCartKey && nextProduct ? () => openProduct(nextProduct, 'detail') : undefined}
          accentColor={accentColor}
          currency={currency}
          whatsapp={whatsapp}
          lang={selectedLanguage}
          onClose={closeProductModal}
          onWhatsApp={() => openWhatsApp(selectedProduct)}
          optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []}
          itemNotesEnabled={settings?.item_notes_enabled ?? false}
          ingredientCustomizationEnabled={ingredientCustomizationEnabled}
          productIngredients={productIngredientsByProductId[selectedProduct.id] ?? []}
          productMedia={productMediaByProductId[selectedProduct.id] ?? []}
          initialEditorState={editingItem?.editorState ?? null}
          submitLabel={editingCartKey ? 'Update item' : 'Order'}
          onCustomizationStarted={() => analyticsTracker?.track({
            event_name: 'product_customization_started',
            product_id: selectedProduct.id,
            source: selectedProductSource === 'feed' ? 'feed' : 'detail',
          })}
          onAddToCart={directOrdersEnabled
            ? (selectedOptions, unitPrice, note, ingredientModifications, editorState) => {
                if (editingCartKey) {
                  replaceCartItem(editingCartKey, selectedProduct, selectedOptions, unitPrice, note, ingredientModifications, editorState)
                } else {
                  addToCart(selectedProduct, selectedOptions, unitPrice, note, ingredientModifications, editorState)
                }
                closeProductModal()
              }
            : undefined}
        />
        )
      })()}

      {chatAddonEnabled && activeMenuView === 'list' && (
        <AiChatWidget
          tenantSlug={tenant.slug}
          tenantName={tenant.name}
          primaryColor={(settings as any)?.primary_color ?? '#F52323'}
          audioEnabled={chatAddonAudioEnabled}
          products={products}
          onAddToCart={addToCart}
        />
      )}

      {analyticsDebug ? (
        <AnalyticsDebugPanel
          sessionId={analyticsTracker?.sessionId ?? null}
          onClose={() => setAnalyticsDebug(false)}
        />
      ) : null}

      <AnimatePresence>
        {showHoursModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowHoursModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              role="dialog"
              aria-modal="true"
              aria-label={ui.hoursTitle}
              className="max-h-[calc(100dvh-0.5rem)] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-sm sm:rounded-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-zinc-50 bg-zinc-50 px-4 py-4 sm:p-8">
                <h3 className="text-xl font-black text-zinc-900 tracking-tight flex items-center gap-3">
                  <Clock className="w-5 h-5 text-primary" />
                  {ui.hoursTitle}
                </h3>
                <button onClick={() => setShowHoursModal(false)} aria-label="Close" className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white transition-colors"><X className="w-5 h-5 text-zinc-400" /></button>
              </div>
              <div className="space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8">
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

      {directOrdersEnabled && (
        <CartPanel
          cart={cart}
          currency={currency}
          primaryColor={primaryColor}
          accentColor={accentColor}
          open={cartOpen && !checkoutOpen}
          onClose={() => setCartOpen(false)}
          onCheckout={() => setCheckoutOpen(true)}
          onEdit={editItem}
          onRemove={removeFromCart}
          onUpdateQuantity={updateCartQuantity}
        />
      )}

      {checkoutOpen && (
        <CheckoutModal
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
          primaryColor={primaryColor}
          accentColor={accentColor}
          onClose={() => {
            setCheckoutOpen(false)
            setOrderSuccess(false)
            setOrderId(null)
          }}
          onBack={() => {
            setCheckoutOpen(false)
            setCartOpen(true)
          }}
          onCustomerNameChange={setCustomerName}
          onCustomerPhoneChange={setCustomerPhone}
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

function translateTag(tag: string, lang: string): string {
  return TAG_TRANSLATIONS[tag]?.[lang] ?? tag
}

function ProductCard({ product, accentColor, primaryColor, currency, lang, onClick, cartQuantity, onAdd, onIncrement, onDecrement }: {
  product: Product; accentColor: string; primaryColor: string; currency: string; lang: string; onClick: () => void
  cartQuantity?: number; onAdd?: () => void; onIncrement?: () => void; onDecrement?: () => void
}) {
  const images = getProductImages(product)
  return (
    <motion.div
      data-analytics-product-id={product.id}
      data-analytics-source="grid"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="group w-full h-full flex flex-col bg-white rounded-lg border border-zinc-100 overflow-hidden text-left shadow-sm hover:shadow-xl hover:shadow-zinc-200/40 transition-all duration-300 cursor-pointer"
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
      </div>

      <div className="p-6 flex flex-col flex-grow">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-black text-zinc-900 leading-tight line-clamp-1">{product.name}</h3>
        </div>

        {product.tags?.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {product.tags.map(tag => {
              const translated = translateTag(tag, lang)
              return (
                <span
                  key={tag}
                  style={{
                    backgroundColor: `color-mix(in srgb, ${primaryColor} 12%, white)`,
                    color: primaryColor,
                  }}
                  className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
                >
                  {translated}
                </span>
              )
            })}
          </div>
        )}

        {product.description && (
          <p className="text-xs text-zinc-500 font-medium line-clamp-2 leading-relaxed mb-4">
            {product.description}
          </p>
        )}

        <div className="mt-auto pt-3">
          <div className="mb-3">
            <span style={{ color: accentColor }} className="text-lg font-black tracking-tight">{formatPrice(product.price, currency)}</span>
          </div>
          <div className="flex items-center justify-between">
          <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-zinc-300 group-hover:text-zinc-900 transition-colors">
            Details <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
          {onAdd && (cartQuantity ?? 0) === 0 && (
            <button
              onClick={e => { e.stopPropagation(); onAdd() }}
              style={{ backgroundColor: primaryColor }}
              className="px-4 py-2 rounded-full text-white text-[11px] font-black uppercase tracking-widest flex items-center justify-center hover:opacity-80 active:scale-95 transition-all flex-shrink-0 shadow-md"
            >
              Order
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
      </div>
    </motion.div>
  )
}
