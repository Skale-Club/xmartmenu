'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { idempotencyKeyFor, type IdempotencySlot } from '@/lib/orders/idempotency-client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { getInitials } from '@/lib/utils'
import { MenuAnalyticsTracker } from '@/lib/analytics/client'
import type { Category, Product, TenantWithSettings, ProductIngredientWithIngredient, IngredientModifications, DeliveryZone, ProductMedia } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { type CartItem, type CartAddedVia, type CartEditorState, buildCartKey, getProductImages, isProductVisibleInFeed, summarizeOptions } from './menu-utils'
import { getGuestCopy } from './guest-copy'
import WaiterCallButtons from './WaiterCallButtons'
import { fill, formatMoney, formatWeekday, getMenuCopy, localeFor, matchDeviceLanguage, menuLanguage, translateTag } from './menu-i18n'
import { computeOpenState, resolveTimeZone } from '@/lib/chat-context'
import { NO_CAPABILITIES, type TenantCapabilities } from '@/lib/service-modes'
import { contactLinks, displayPrice, phoneLabel, whatsappUrl } from './showcase'
import { feedSizes } from './feed-sizes'
import { describeOpenState, menuTimeZone, type OpenLabel } from './open-label'
import { computePrimaryForeground } from '@/lib/color-utils'
import { baseName, localizeGroups, localizeItem } from '@/lib/menu-translations'
import {
  CART_TTL_MS,
  browserStorage,
  cartStorageKey,
  checkoutFields,
  defaultOrderTypeFor,
  isDraftEmpty,
  normalizeScreenState,
  readStored,
  removeStored,
  resolveInitialView,
  restoreCart,
  sanitizeScreenState,
  serializeCart,
  sessionStorageKey,
  urlWithView,
  writeStored,
  type MenuView,
  type StoredCartItem,
} from './menu-session'
import ModalPortal from '@/components/ui/ModalPortal'
import UpsellSheet from './UpsellSheet'
import { buildUpsellSteps, canQuickAdd, type UpsellStep } from './upsell'
import {
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  X,
  Sparkles,
  Plus,
  Minus,
  Languages,
  ChevronDown,
  UtensilsCrossed,
  Clapperboard,
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
  initialView?: 'list' | 'feed'
  footerBrand?: string
  optionGroupsByProductId?: Record<string, GroupWithOptions[]>
  productIngredientsByProductId?: Record<string, ProductIngredientWithIngredient[]>
  deliveryZones?: DeliveryZone[]
  productMediaByProductId?: Record<string, ProductMedia[]>
  chatAddonEnabled?: boolean
  chatAddonAudioEnabled?: boolean
  /** Typed messages in the AI chat (the restaurant can allow voice notes only). */
  chatAddonTextEnabled?: boolean
  /**
   * What the plan and the restaurant allow right now (service-modes.ts
   * TenantCapabilities): guest ordering, order types, tips, notes, ingredients,
   * WhatsApp orders. Without it the menu is a showcase.
   */
  capabilities?: TenantCapabilities
  /** The table this link belongs to (QR code / NFC tag ?table=), when guests can order. */
  table?: { id: string; name: string } | null
  /** The table this link belongs to, when the restaurant serves at the table: guests can call a waiter or ask for the bill. */
  waiterCallTable?: { id: string; name: string } | null
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

export default function MenuPage({ tenant, categories: baseCategories, products: baseProducts, menu = null, location = null, initialLanguage, initialView, footerBrand = 'XmartMenu', optionGroupsByProductId: baseOptionGroups = {}, productIngredientsByProductId = {}, deliveryZones = [], productMediaByProductId = {}, chatAddonEnabled = false, chatAddonAudioEnabled = false, chatAddonTextEnabled = true, capabilities = NO_CAPABILITIES, table = null, waiterCallTable = null }: Props) {
  const router = useRouter()
  const [feedPreview, setFeedPreview] = useState(false)
  const feedEnabled = (tenant.tenant_settings?.visual_feed_enabled ?? true) || feedPreview
  const [menuView, setMenuView] = useState<MenuView>(() => resolveInitialView({
    urlView: initialView,
    defaultView: tenant.tenant_settings?.menu_default_view,
    feedEnabled,
  }))
  // Switching views writes ?view= into the URL, so a reload (or a /feed link
  // the customer navigated away from) lands where they were.
  function changeView(view: MenuView) {
    setMenuView(view)
    try {
      window.history.replaceState(window.history.state, '', urlWithView(window.location.href, view))
    } catch {
      // URL sync is best-effort
    }
  }
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  )
  const activeMenuView = isMobileViewport ? menuView : 'list'
  // Decided on the server from the plan and the restaurant's switches.
  const directOrdersEnabled = capabilities.guestOrdering
  const ingredientCustomizationEnabled = capabilities.ingredientCustomization
  const orderingTable = directOrdersEnabled ? table : null
  const atTable = !!orderingTable
  // A table link means the guest is eating here: the order goes to that table.
  const defaultOrderType: string = defaultOrderTypeFor(capabilities, atTable)
  const [search, setSearch] = useState('')
  // Tabs scroll to a section instead of filtering; the list is never narrowed to one category.
  const activeCategory: string | null = null
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedProductSource, setSelectedProductSource] = useState<'grid' | 'featured' | 'detail' | 'cart' | 'feed' | 'upsell'>('detail')
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage ?? menu?.language ?? 'en')
  // Dish content in the guest's language (falls back to the base text). Each
  // localized item keeps `base_name`, which is what orders send the kitchen.
  const baseLanguage = menu?.language ?? null
  const products = useMemo(
    () => baseProducts.map(p => localizeItem(p, selectedLanguage, baseLanguage)),
    [baseProducts, selectedLanguage, baseLanguage],
  )
  const categories = useMemo(
    () => baseCategories.map(c => localizeItem(c, selectedLanguage, baseLanguage)),
    [baseCategories, selectedLanguage, baseLanguage],
  )
  const optionGroupsByProductId = useMemo(
    () => Object.fromEntries(Object.entries(baseOptionGroups).map(([id, groups]) => [id, localizeGroups(groups, selectedLanguage, baseLanguage)])),
    [baseOptionGroups, selectedLanguage, baseLanguage],
  )
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
  const [orderType, setOrderType] = useState<string>(defaultOrderType)
  const [deliveryStreet, setDeliveryStreet] = useState('')
  const [deliveryComplement, setDeliveryComplement] = useState('')
  const [deliveryZipcode, setDeliveryZipcode] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [tipCents, setTipCents] = useState(0)
  const [analyticsTracker, setAnalyticsTracker] = useState<MenuAnalyticsTracker | null>(null)
  const [analyticsDebug, setAnalyticsDebug] = useState(false)
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({})
  const orderAttemptRef = useRef<IdempotencySlot | null>(null)
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const categoryFilterRef = useRef<HTMLDivElement | null>(null)
  const autoOpenedRef = useRef(false)

  const settings = tenant.tenant_settings
  const primaryColor = settings?.primary_color ?? '#F52323'
  const accentColor = settings?.accent_color ?? '#09090b'
  // "Order on WhatsApp" on each dish (any plan, needs a number).
  const whatsapp = capabilities.whatsappOrders ? settings?.whatsapp ?? null : null
  const currency = settings?.currency ?? 'USD'
  const deliveryFeeCents = settings?.delivery_fee_cents ?? 0
  const orderTypeConfig = atTable
    ? { dineIn: true, pickup: false, delivery: false, deliveryFeeCents }
    : { dineIn: capabilities.dineIn, pickup: capabilities.pickup, delivery: capabilities.delivery, deliveryFeeCents }
  const tipsEnabled = capabilities.tips
  const analyticsEnabled = settings?.analytics_enabled ?? true
  const feedAutoplayVideos = settings?.feed_autoplay_videos ?? true
  const tipPercentages: [number, number, number] = [
    settings?.tip_percentage_1 ?? 15,
    settings?.tip_percentage_2 ?? 18,
    settings?.tip_percentage_3 ?? 20,
  ]
  const featured = products.filter(p => p.is_featured)
  const supportedLanguages = menu?.supported_languages?.length ? menu.supported_languages : [menu?.language ?? 'en']
  const copy = getMenuCopy(selectedLanguage)
  const guestCopy = getGuestCopy(selectedLanguage)
  const menuTitle = getTranslatedMenuField(menu, selectedLanguage, 'name', menu?.name ?? tenant.name)

  // The guest's language: ?lang= (also written on change, so a reload keeps
  // it), otherwise the phone's language when this menu offers it.
  function changeLanguage(lang: string) {
    setSelectedLanguage(lang)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('lang', lang)
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      // URL sync is best-effort
    }
  }
  useEffect(() => {
    if (supportedLanguages.length < 2) return
    if (new URLSearchParams(window.location.search).has('lang')) return
    const match = matchDeviceLanguage(navigator.languages?.length ? navigator.languages : [navigator.language], supportedLanguages)
    if (match && match !== selectedLanguage) setSelectedLanguage(match)
    // Mount-only: a suggestion, never a fight with the guest's own choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    document.documentElement.lang = localeFor(selectedLanguage)
  }, [selectedLanguage])

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

  /** `item` names the dish with the choices made (ProductModal). */
  function openWhatsApp(item: string) {
    const url = whatsappUrl(whatsapp, fill(copy.whatsappMessage, { item }))
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  // The order type, delivery fields and tip actually sent: dine_in at a table,
  // and only what the plan and the restaurant allow (menu-session.ts).
  const orderFields = checkoutFields(
    { orderType, deliveryStreet, deliveryComplement, deliveryZipcode, deliveryCity, deliveryNotes, tipCents },
    capabilities,
    atTable,
  )
  const checkoutOrderType = orderFields.order_type

  // ── "Complete your order" (see upsell.ts) ─────────────────────────────────
  // After a dish goes into the cart, offer what usually comes next. `choosing`
  // = a suggestion with required choices is open in the product modal; adding
  // it (or closing it) brings the guest back to the same step.
  const upsellEnabled = capabilities.upsell
  const [upsell, setUpsell] = useState<{
    triggerId: string
    steps: UpsellStep[]
    index: number
    added: string[]
    choosing: boolean
  } | null>(null)

  function startUpsell(product: Product) {
    if (!upsellEnabled) return
    const added = products.find(p => p.id === product.id) ?? product
    const steps = buildUpsellSteps({
      added,
      cartProductIds: [...cart.map(item => item.product.id), product.id],
      products,
      categories,
    })
    if (!steps.length) return
    setUpsell({ triggerId: product.id, steps, index: 0, added: [], choosing: false })
    analyticsTracker?.track({ event_name: 'upsell_shown', product_id: product.id, source: 'upsell' })
  }

  function acceptUpsell(product: Product, quantity: number) {
    analyticsTracker?.track({ event_name: 'upsell_accepted', product_id: product.id, quantity, source: 'upsell' })
    setUpsell(prev => prev && { ...prev, choosing: false, added: prev.added.includes(product.id) ? prev.added : [...prev.added, product.id] })
  }

  function quickAddUpsell(product: Product) {
    addToCart(product, {}, product.price, undefined, null, null, 'upsell', 1)
    acceptUpsell(product, 1)
  }

  function chooseUpsell(product: Product) {
    setUpsell(prev => prev && { ...prev, choosing: true })
    openProduct(product, 'upsell')
  }

  function finishUpsell() {
    // Tracked outside the state updater: React may run updaters twice.
    if (upsell && upsell.added.length === 0) {
      analyticsTracker?.track({ event_name: 'upsell_skipped', product_id: upsell.triggerId, source: 'upsell' })
    }
    setUpsell(null)
  }

  function nextUpsellStep() {
    if (!upsell) return
    if (upsell.index < upsell.steps.length - 1) setUpsell({ ...upsell, index: upsell.index + 1 })
    else finishUpsell()
  }

  function openProduct(product: Product, source: 'grid' | 'featured' | 'detail' | 'cart' | 'feed' | 'upsell') {
    setSelectedProductSource(source)
    setSelectedProduct(product)
  }

  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  function addToCart(product: Product, selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null, editorState?: CartEditorState | null, source?: 'grid' | 'featured' | 'detail' | 'cart' | 'feed' | 'upsell', quantity = 1, addedVia?: CartAddedVia) {
    const key = buildCartKey(product.id, selectedOptions)
    const amount = Math.max(1, Math.floor(quantity))
    const via = addedVia ?? (source === 'upsell' ? 'upsell' : undefined)
    setCart(prev => {
      const existing = prev.find(item => item.cartKey === key)
      if (existing) {
        return prev.map(item =>
          item.cartKey === key ? { ...item, quantity: item.quantity + amount, note: note ?? item.note, ingredientModifications: ingredientModifications ?? item.ingredientModifications, editorState: editorState ?? item.editorState, addedVia: item.addedVia ?? via } : item
        )
      }
      return [...prev, { product, quantity: amount, selectedOptions, unitPrice, cartKey: key, note, ingredientModifications, editorState, ...(via ? { addedVia: via } : {}) }]
    })
    analyticsTracker?.track({
      event_name: 'add_to_cart',
      product_id: product.id,
      quantity: amount,
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
    if (!directOrdersEnabled) return
    if (!customerName.trim() || !customerPhone.trim()) {
      setOrderError(copy.errNamePhone)
      return
    }
    if (cart.length === 0) {
      setOrderError(copy.errCartEmpty)
      return
    }
    if (checkoutOrderType === 'delivery' && !deliveryStreet.trim()) {
      setOrderError(copy.errStreet)
      return
    }

    setSubmittingOrder(true)
    setOrderError(null)

    // Same cart again (double tap, retry after a lost response) → same key,
    // so the server returns the order it already created.
    const orderPayload = {
      tenant_id: tenant.id,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      ...orderFields,
      location_id: location?.id ?? null,
      table_id: orderingTable ? orderingTable.id : undefined,
      menu_id: menu?.id ?? null,
      analytics_session_id: analyticsTracker?.sessionId ?? null,
      items: cart.map(item => ({
        product_id: item.product.id,
        product_name: baseName(item.product),
        quantity: item.quantity,
        unit_price: item.unitPrice,
        selected_options: item.selectedOptions,
        notes: item.note || undefined,
        ingredient_modifications: item.ingredientModifications || null,
        editor_state: item.editorState || null,
        added_via: item.addedVia,
      })),
    }
    orderAttemptRef.current = idempotencyKeyFor(orderAttemptRef.current, orderPayload)

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': orderAttemptRef.current.key },
        body: JSON.stringify(orderPayload),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(copy.errSubmit)
      }
      // Placed: an identical cart later is a new order.
      orderAttemptRef.current = null

      // Customer (QR / public-menu) orders that require online payment skip the
      // "order placed" screen and go straight to the Stripe checkout. The order
      // already exists in 'awaiting_payment' and only reaches the kitchen once
      // the payment webhook flips it to 'paid'.
      if (data.requires_payment) {
        // The order now exists (awaiting payment): the cart and the form are
        // spent, so coming back to the menu must not offer them again.
        removeStored(browserStorage('local'), cartKey)
        removeStored(browserStorage('session'), screenKey)
        setCart([])
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
      setOrderError(error instanceof Error && error.message ? error.message : copy.errSubmit)
    } finally {
      setSubmittingOrder(false)
    }
  }

  const hours = settings?.business_hours
  const hasHours = hours && Object.values(hours).some(Boolean)
  const email = settings?.contact_email?.trim() || null
  // Contact links normalized: "(555) 123-4567" → wa.me/5551234567, "@handle" or a URL → one Instagram link.
  const contacts = contactLinks(settings)
  const hasContact = !!(contacts.phone || contacts.instagram || contacts.whatsapp || settings?.address || email)

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

  function selectCategory(sectionId: string) {
    const target = categoryRefs.current[sectionId]
    if (target) {
      const nav = categoryFilterRef.current?.closest('nav')
      const offset = (nav?.getBoundingClientRect().height ?? 0) + 8
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' })
    }
    setVisibleCategory(sectionId)
    if (sectionId !== FEATURED_TAB && sectionId !== OTHER_TAB) {
      analyticsTracker?.track({ event_name: 'category_selected', category_id: sectionId })
    }
  }

  // The current tab is the last section whose top has passed under the tab
  // bar — computed from the scroll position, so jumps and fast flicks agree.
  useEffect(() => {
    if (search) {
      setVisibleCategory(null)
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const nav = categoryFilterRef.current?.closest('nav')
      // At the very end of the page the last sections can't scroll up to the
      // bar; there the last one on screen is the current one.
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      const line = atEnd ? window.innerHeight * 0.85 : (nav?.getBoundingClientRect().bottom ?? 0) + 24
      let current: string | null = null
      let currentTop = -Infinity
      for (const [id, el] of Object.entries(categoryRefs.current)) {
        if (!el || !el.isConnected) continue
        const top = el.getBoundingClientRect().top
        if (top <= line && top > currentTop) {
          current = id
          currentTop = top
        }
      }
      setVisibleCategory(current)
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [search, groupedByCategory.length, uncategorized.length])

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
    const byId = new Map(products.map(p => [p.id, p]))
    setCart(prev => prev.some(item => byId.has(item.product.id) && byId.get(item.product.id) !== item.product)
      ? prev.map(item => ({ ...item, product: byId.get(item.product.id) ?? item.product }))
      : prev)
  }, [products])

  // ── Persistence across reloads (see menu-session.ts) ──────────────────────
  const cartKey = cartStorageKey(tenant.id, menu?.id)
  const screenKey = sessionStorageKey(tenant.id, menu?.id)
  const [restored, setRestored] = useState(false)
  const [feedIndex, setFeedIndex] = useState(0)

  // Restore once, after hydration (storage doesn't exist on the server).
  useEffect(() => {
    const now = Date.now()
    // Cut down to what this menu allows now: no checkout when guests can't
    // order, dine-in only at a table, no tip when tips are off.
    const screen = sanitizeScreenState(normalizeScreenState(readStored(browserStorage('session'), screenKey, now)), capabilities, atTable)
    const savedCart = directOrdersEnabled
      ? restoreCart(readStored<StoredCartItem[]>(browserStorage('local'), cartKey, now, CART_TTL_MS), products)
      : []

    if (savedCart.length) {
      // Restoring is not "adding": don't pop the desktop drawer open for it.
      autoOpenedRef.current = true
      setCart(savedCart)
    }
    if (screen.placedOrder) {
      setConfirmedCart(restoreCart(screen.placedOrder.items, products))
      setOrderId(screen.placedOrder.id)
      setOrderSuccess(true)
      setCheckoutOpen(true)
    } else if (savedCart.length) {
      setCartOpen(screen.cartOpen)
      setCheckoutOpen(screen.checkoutOpen)
    }
    if (screen.draft) {
      setCustomerName(screen.draft.customerName)
      setCustomerPhone(screen.draft.customerPhone)
      if (screen.draft.orderType) setOrderType(screen.draft.orderType)
      setDeliveryStreet(screen.draft.deliveryStreet)
      setDeliveryComplement(screen.draft.deliveryComplement)
      setDeliveryZipcode(screen.draft.deliveryZipcode)
      setDeliveryCity(screen.draft.deliveryCity)
      setDeliveryNotes(screen.draft.deliveryNotes)
      setTipCents(screen.draft.tipCents)
    }
    const openProductAgain = screen.productId ? products.find(p => p.id === screen.productId) : undefined
    if (openProductAgain) setSelectedProduct(openProductAgain)
    setFeedIndex(screen.feedIndex)
    setRestored(true)
    // Mount-only: later changes are written by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!restored) return
    if (cart.length) writeStored(browserStorage('local'), cartKey, serializeCart(cart), Date.now())
    else removeStored(browserStorage('local'), cartKey)
  }, [restored, cart, cartKey])

  useEffect(() => {
    if (!restored) return
    const draft = {
      customerName, customerPhone, orderType,
      deliveryStreet, deliveryComplement, deliveryZipcode, deliveryCity, deliveryNotes, tipCents,
    }
    writeStored(browserStorage('session'), screenKey, {
      cartOpen,
      checkoutOpen,
      productId: selectedProduct?.id ?? null,
      feedIndex,
      draft: isDraftEmpty(draft, defaultOrderType) ? null : draft,
      placedOrder: orderSuccess && orderId ? { id: orderId, items: serializeCart(confirmedCart) } : null,
    }, Date.now())
  }, [restored, screenKey, cartOpen, checkoutOpen, selectedProduct, feedIndex, customerName, customerPhone, orderType,
    deliveryStreet, deliveryComplement, deliveryZipcode, deliveryCity, deliveryNotes, tipCents, defaultOrderType,
    orderSuccess, orderId, confirmedCart])

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


  // The cart drawer's actual on-screen visibility (CartPanel uses the same
  // `cartOpen && !checkoutOpen`); the chat widget steps aside while it is open.
  const cartPanelVisible = directOrdersEnabled && cartOpen && !checkoutOpen
  const editingItem = editingCartKey ? cart.find(i => i.cartKey === editingCartKey) ?? null : null

  function closeProductModal() {
    setSelectedProduct(null)
    setSelectedProductSource('detail')
    setEditingCartKey(null)
    if (cart.length > 0 && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setCartOpen(true)
    }
  }

  // ── Presentation ───────────────────────────────────────────────────────────
  const onPrimary = computePrimaryForeground(primaryColor)
  const money = (value: number) => formatMoney(value, currency, selectedLanguage)
  // "From $15.00" for a dish whose sizes set the price (showcase.ts).
  const priceOf = (product: Product) => {
    const shown = displayPrice(product.price, optionGroupsByProductId[product.id])
    return { text: shown.from ? fill(guestCopy.fromPrice, { price: money(shown.amount) }) : money(shown.amount), from: shown.from }
  }
  const hasCustomization = (productId: string) =>
    (optionGroupsByProductId[productId]?.length ?? 0) > 0
    || (ingredientCustomizationEnabled && (productIngredientsByProductId[productId]?.length ?? 0) > 0)

  // Open/closed is computed on the client only (it depends on "now").
  const [openInfo, setOpenInfo] = useState<{ state: ReturnType<typeof computeOpenState>['state']; todayIndex: number | null } | null>(null)
  useEffect(() => {
    // The restaurant's zone from its profile, else the guest's own.
    let deviceZone: string | null = null
    try { deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null } catch { deviceZone = null }
    const timeZone = menuTimeZone(resolveTimeZone({ country: settings?.country, region: settings?.region, currency }), deviceZone)
    const update = () => {
      const result = computeOpenState(hours as Record<string, string | null | undefined> | null | undefined, new Date(), timeZone)
      setOpenInfo({ state: result.state, todayIndex: result.todayIndex })
    }
    update()
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [hours, settings?.country, settings?.region, currency])
  const openLabel: OpenLabel | null = openInfo ? describeOpenState(openInfo.state, copy, guestCopy, selectedLanguage) : null

  const contextParts = [menuTitle !== tenant.name ? menuTitle : null, settings?.business_type, settings?.price_range]
    .filter((part): part is string => !!part && !!part.trim())

  const tabs: Array<{ id: string; label: string }> = [
    ...(featured.length > 0 && !search ? [{ id: FEATURED_TAB, label: copy.featured }] : []),
    ...groupedByCategory.map(({ category }) => ({ id: category.id, label: category.name })),
    ...(uncategorized.length > 0 ? [{ id: OTHER_TAB, label: copy.other }] : []),
  ]
  const activeTab = visibleCategory ?? tabs[0]?.id ?? null
  const showOrderBar = directOrdersEnabled && cart.length > 0 && !cartOpen && !checkoutOpen && activeMenuView === 'list'

  return (
    <div className="menu-root min-h-screen bg-menu text-zinc-900" lang={localeFor(selectedLanguage)}>
      {/* Header: banner, then identity with the logo overlapping its edge */}
      <header className="relative">
        <div
          className="relative h-44 overflow-hidden sm:h-64"
          style={!settings?.banner_url ? { background: `linear-gradient(135deg, color-mix(in srgb, ${primaryColor} 26%, white), color-mix(in srgb, ${primaryColor} 8%, white))` } : undefined}
        >
          {settings?.banner_url && (
            <>
              <Image src={settings.banner_url} alt="" fill priority sizes="100vw" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/10" />
            </>
          )}
          <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 flex items-center gap-2 sm:right-5 sm:top-5">
            {feedEnabled && (
              <button
                type="button"
                onClick={() => changeView('feed')}
                aria-label={copy.viewFeed}
                className="flex size-10 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-sm transition-[scale] active:scale-95 md:hidden"
              >
                <Clapperboard className="size-[18px]" />
              </button>
            )}
            {supportedLanguages.length > 1 && (
              <label className="relative flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-white/95 pl-3 pr-2 text-[14px] font-medium text-zinc-900 shadow-sm">
                <Languages className="size-4 text-zinc-600" aria-hidden="true" />
                <span>{menuLanguage(selectedLanguage).nativeName}</span>
                <ChevronDown className="size-4 text-zinc-500" aria-hidden="true" />
                <select
                  aria-label={copy.language}
                  value={selectedLanguage}
                  onChange={e => changeLanguage(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  {supportedLanguages.map(code => (
                    <option key={code} value={code}>{menuLanguage(code).nativeName}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <div className="relative -mt-9 size-[72px] overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-black/5 sm:-mt-12 sm:size-24">
            {settings?.logo_url ? (
              <Image src={settings.logo_url} alt={tenant.name} fill priority sizes="96px" className="object-contain p-2" />
            ) : (
              <div className="flex size-full items-center justify-center text-xl font-semibold text-zinc-700">{getInitials(tenant.name)}</div>
            )}
          </div>
          <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-zinc-900 sm:text-[32px]">{tenant.name}</h1>
          {(contextParts.length > 0 || openLabel || hasHours) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-zinc-500">
              {contextParts.map((part, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {part}
                </span>
              ))}
              {(openLabel || hasHours) && (
                <>
                  {contextParts.length > 0 && <span aria-hidden="true">·</span>}
                  <button
                    type="button"
                    onClick={() => setShowHoursModal(true)}
                    disabled={!hasHours}
                    className={`inline-flex min-w-0 items-center gap-1.5 text-left font-medium ${openLabel?.tone === 'open' ? 'text-emerald-700' : 'text-zinc-600'} enabled:hover:underline`}
                  >
                    {openLabel && openLabel.tone !== 'info' && <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${openLabel.tone === 'open' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />}
                    {openLabel ? openLabel.text : copy.hoursTitle}
                  </button>
                </>
              )}
            </div>
          )}
          {(orderingTable ?? waiterCallTable) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[14px] font-semibold text-zinc-900 shadow-card">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: primaryColor }} />
                <span className="font-medium text-zinc-500">{copy.yourTable}</span>
                {(orderingTable ?? waiterCallTable)!.name}
              </p>
              {waiterCallTable && (
                <WaiterCallButtons slug={tenant.slug} tableId={waiterCallTable.id} copy={getGuestCopy(selectedLanguage)} primaryColor={primaryColor} />
              )}
            </div>
          )}
          {settings?.tagline && (
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zinc-600">{settings.tagline}</p>
          )}
        </div>
      </header>

      {/* Sticky category tabs */}
      {activeMenuView === 'list' && (tabs.length > 0 || showSearch) && (
        <nav className="sticky top-0 z-30 mt-5 border-b border-zinc-200/70 bg-menu/90 backdrop-blur-md" aria-label={copy.viewMenu}>
          <div className="mx-auto flex max-w-5xl items-center px-2 sm:px-6">
            {showSearch ? (
              <div className="flex h-14 min-w-0 flex-1 items-center gap-2 px-3">
                <Search className="size-[18px] shrink-0 text-zinc-400" aria-hidden="true" />
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={copy.search}
                  aria-label={copy.search}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-400"
                />
              </div>
            ) : (
              <div ref={categoryFilterRef} className="scrollbar-hide no-scrollbar flex h-14 min-w-0 flex-1 items-stretch gap-6 overflow-x-auto px-3">
                {tabs.map(tab => {
                  const active = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      ref={el => { categoryButtonRefs.current[tab.id] = el }}
                      onClick={() => selectCategory(tab.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`relative flex shrink-0 items-center whitespace-nowrap text-[15px] font-medium transition-colors ${active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'}`}
                    >
                      {tab.label}
                      {active && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full" style={{ backgroundColor: primaryColor }} />}
                    </button>
                  )
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => { if (showSearch) { setShowSearch(false); setSearch('') } else { setShowSearch(true) } }}
              aria-label={showSearch ? copy.searchClose : copy.searchOpen}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-200/60"
            >
              {showSearch ? <X className="size-5" /> : <Search className="size-5" />}
            </button>
          </div>
        </nav>
      )}

      {/* Featured: a quiet row you swipe yourself */}
      {activeMenuView === 'list' && featured.length > 0 && !search && (
        <section
          ref={el => { categoryRefs.current[FEATURED_TAB] = el }}
          data-category-id={FEATURED_TAB}
          className="mx-auto max-w-5xl scroll-mt-16 pt-6 sm:pt-8"
        >
          <h2 className="px-5 text-[20px] font-semibold tracking-tight text-zinc-900 sm:px-8">{copy.featured}</h2>
          <div className="scrollbar-hide mt-3 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 sm:scroll-px-8 sm:gap-4 sm:px-8">
            {featured.map(p => {
              const image = getProductImages(p)[0]
              return (
                <button
                  key={p.id}
                  type="button"
                  data-analytics-product-id={p.id}
                  data-analytics-source="featured"
                  onClick={() => openProduct(p, 'featured')}
                  className="w-[156px] shrink-0 snap-start text-left sm:w-[220px]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-zinc-100">
                    {image
                      ? <Image src={image} alt="" fill sizes="(max-width: 640px) 156px, 220px" className="object-cover" />
                      : <DishPlaceholder />}
                  </div>
                  <p className="mt-2 line-clamp-2 text-[14px] font-semibold leading-snug text-zinc-900 sm:text-[15px]">{p.name}</p>
                  <p className="mt-0.5 text-[14px] font-medium tabular-nums text-zinc-600">{priceOf(p).text}</p>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <main
        className="mx-auto max-w-5xl space-y-8 px-4 pt-6 sm:px-8 sm:pt-8"
        style={{ paddingBottom: showOrderBar ? 112 : 48 }}
      >
        {activeMenuView === 'list' && filtered.length === 0 && (
          <div className="py-20 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-zinc-100">
              <Search className="size-6 text-zinc-400" />
            </div>
            <p className="mt-4 text-[17px] font-semibold text-zinc-900">{copy.noItems}</p>
            <p className="mt-1 text-[15px] text-zinc-500">{copy.tryAnother}</p>
          </div>
        )}

        {activeMenuView === 'feed' && feedProducts.length > 0 && restored ? (
          <MenuFeed
            products={feedProducts}
            productMediaByProductId={productMediaByProductId}
            currency={currency}
            lang={selectedLanguage}
            primaryColor={primaryColor}
            accentColor={accentColor}
            autoplayVideos={feedAutoplayVideos}
            directOrdersEnabled={directOrdersEnabled}
            cartCount={cartCount}
            exitLabel={copy.viewMenu}
            onExit={() => changeView('list')}
            initialIndex={feedIndex}
            onIndexChange={setFeedIndex}
            onOpenCart={() => setCartOpen(true)}
            hasCustomization={hasCustomization}
            sizesFor={product => feedSizes(product.price, optionGroupsByProductId[product.id])}
            quantityFor={productId => cart.find(item => item.cartKey === buildCartKey(productId, {}))?.quantity ?? 0}
            onOpen={product => openProduct(product, 'feed')}
            onAdd={(product, size) => {
              if (size) addToCart(product, size.selectedOptions, size.price, undefined, undefined, size.editorState, 'feed')
              else addToCart(product, {}, product.price, undefined, undefined, undefined, 'feed')
              startUpsell(product)
            }}
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
            priceLabel={product => priceOf(product).text}
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
            <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-white/10">
              <Sparkles className="size-7 text-white/70" />
            </div>
            <h3 className="text-xl font-semibold tracking-tight">{copy.feedEmptyTitle}</h3>
            <p className="mx-auto mt-2 max-w-sm text-[15px] text-white/60">{copy.feedEmptyDescription}</p>
            <button
              type="button"
              onClick={() => changeView('list')}
              style={{ backgroundColor: primaryColor, color: onPrimary }}
              className="mt-6 h-12 rounded-2xl px-6 text-[15px] font-semibold transition-[scale] active:scale-95"
            >
              {copy.viewMenu}
            </button>
          </div>
        ) : activeMenuView === 'list' ? (
          <>
            {[...groupedByCategory.map(({ category, items }) => ({ id: category.id, title: category.name, description: category.description, items })),
              ...(uncategorized.length > 0 ? [{ id: OTHER_TAB, title: copy.other, description: null as string | null, items: uncategorized }] : []),
            ].map(section => (
              <section
                key={section.id}
                ref={el => { categoryRefs.current[section.id] = el }}
                data-category-id={section.id}
                className="scroll-mt-16"
              >
                <h2 className="px-1 text-[20px] font-semibold tracking-tight text-zinc-900">{section.title}</h2>
                {section.description && <p className="mt-0.5 px-1 text-[14px] text-zinc-500">{section.description}</p>}
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                  {section.items.map(p => {
                    const key = buildCartKey(p.id, {})
                    const qty = cart.find(i => i.cartKey === key)?.quantity ?? 0
                    const customizable = hasCustomization(p.id)
                    return (
                      <ProductCard
                        key={p.id}
                        product={p}
                        lang={selectedLanguage}
                        currency={currency}
                        primaryColor={primaryColor}
                        price={priceOf(p)}
                        onOpen={() => openProduct(p, 'grid')}
                        {...(directOrdersEnabled ? {
                          cartQuantity: customizable ? 0 : qty,
                          // A dish with choices to make opens its sheet instead of
                          // going into the order without them.
                          onAdd: customizable ? () => openProduct(p, 'grid') : () => { addToCart(p, {}, p.price); startUpsell(p) },
                          onIncrement: () => updateCartQuantity(key, qty + 1),
                          onDecrement: () => updateCartQuantity(key, qty - 1),
                        } : {})}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        ) : null}
      </main>

      {/* Contact and credits: a plain footer at the end of the page */}
      {activeMenuView === 'list' && (hasContact || footerBrand) && (
        <footer className="border-t border-zinc-200/70" style={{ marginBottom: showOrderBar ? 88 : 0 }}>
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-8 px-5 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            {hasContact && (
              <ul className="space-y-3 text-[15px] font-medium text-zinc-700">
                {contacts.instagram && (
                  <li className="flex items-center gap-3"><Instagram className="size-[18px] shrink-0 text-zinc-400" aria-hidden="true" /><span className="select-text break-words">{contacts.instagram.handle}</span></li>
                )}
                {contacts.phone && (
                  <li className="flex items-center gap-3"><Phone className="size-[18px] shrink-0 text-zinc-400" aria-hidden="true" /><span className="select-text break-words">{contacts.phone.label}</span></li>
                )}
                {contacts.whatsapp && (
                  <li className="flex items-center gap-3"><MessageCircle className="size-[18px] shrink-0 text-zinc-400" aria-hidden="true" /><span className="select-text break-words">{phoneLabel(settings?.whatsapp)}</span></li>
                )}
                {email && (
                  <li className="flex items-center gap-3"><Mail className="size-[18px] shrink-0 text-zinc-400" aria-hidden="true" /><span className="select-text break-words">{email}</span></li>
                )}
                {settings?.address && (
                  <li className="flex items-center gap-3"><MapPin className="size-[18px] shrink-0 text-zinc-400" aria-hidden="true" /><span className="select-text break-words">{settings.address}</span></li>
                )}
              </ul>
            )}
            {footerBrand && (
              <p className="text-[12px] text-zinc-400">
                {copy.poweredBy} <a href="/" className="font-medium text-zinc-600 hover:text-zinc-900">{footerBrand}</a>
              </p>
            )}
          </div>
        </footer>
      )}

      {/* Order bar: floating, in the restaurant's colour */}
      {showOrderBar && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          style={{ backgroundColor: primaryColor, color: onPrimary }}
          className="menu-order-bar-in fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex h-14 items-center justify-between rounded-2xl px-4 shadow-float transition-[scale] active:scale-[0.98] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:min-w-[320px]"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-black/15 px-1.5 text-[13px] font-bold tabular-nums">{cartCount}</span>
            <span className="text-[15px] font-semibold">{copy.viewOrder}</span>
          </span>
          <span className="text-[15px] font-semibold tabular-nums">{money(cartTotal)}</span>
        </button>
      )}

      {/* Modals */}
      {selectedProduct && (() => {
        const shownProduct = products.find(p => p.id === selectedProduct.id) ?? selectedProduct
        const navIndex = orderedProducts.findIndex(p => p.id === selectedProduct.id)
        const prevProduct = navIndex > 0 ? orderedProducts[navIndex - 1] : null
        const nextProduct = navIndex >= 0 && navIndex < orderedProducts.length - 1 ? orderedProducts[navIndex + 1] : null
        return (
        <ProductModal
          product={shownProduct}
          onPrevProduct={!editingCartKey && !upsell?.choosing && prevProduct ? () => openProduct(prevProduct, 'detail') : undefined}
          onNextProduct={!editingCartKey && !upsell?.choosing && nextProduct ? () => openProduct(nextProduct, 'detail') : undefined}
          primaryColor={primaryColor}
          currency={currency}
          whatsapp={whatsapp}
          lang={selectedLanguage}
          onClose={() => {
            closeProductModal()
            // Back to the "Complete your order" step it was opened from.
            if (upsell?.choosing) setUpsell({ ...upsell, choosing: false })
          }}
          onWhatsApp={openWhatsApp}
          showcase={!directOrdersEnabled}
          contact={settings}
          optionGroups={optionGroupsByProductId[selectedProduct.id] ?? []}
          itemNotesEnabled={capabilities.itemNotes}
          ingredientCustomizationEnabled={ingredientCustomizationEnabled}
          productIngredients={productIngredientsByProductId[selectedProduct.id] ?? []}
          productMedia={productMediaByProductId[selectedProduct.id] ?? []}
          initialEditorState={editingItem?.editorState ?? null}
          onCustomizationStarted={directOrdersEnabled ? () => analyticsTracker?.track({
            event_name: 'product_customization_started',
            product_id: selectedProduct.id,
            source: selectedProductSource === 'feed' ? 'feed' : 'detail',
          }) : undefined}
          onAddToCart={directOrdersEnabled
            ? (selectedOptions, unitPrice, note, ingredientModifications, editorState, quantity) => {
                if (editingCartKey) {
                  replaceCartItem(editingCartKey, selectedProduct, selectedOptions, unitPrice, note, ingredientModifications, editorState)
                  closeProductModal()
                } else if (upsell?.choosing) {
                  addToCart(selectedProduct, selectedOptions, unitPrice, note, ingredientModifications, editorState, 'upsell', quantity ?? 1)
                  acceptUpsell(selectedProduct, quantity ?? 1)
                  closeProductModal()
                } else {
                  addToCart(selectedProduct, selectedOptions, unitPrice, note, ingredientModifications, editorState, undefined, quantity ?? 1)
                  closeProductModal()
                  startUpsell(selectedProduct)
                }
              }
            : undefined}
        />
        )
      })()}

      {upsell && !upsell.choosing && !selectedProduct && (
        <UpsellSheet
          steps={upsell.steps}
          stepIndex={upsell.index}
          triggerName={(products.find(p => p.id === upsell.triggerId) ?? baseProducts.find(p => p.id === upsell.triggerId))?.name ?? ''}
          addedIds={new Set(upsell.added)}
          lang={selectedLanguage}
          currency={currency}
          primaryColor={primaryColor}
          canQuickAdd={product => canQuickAdd(optionGroupsByProductId[product.id])}
          onAdd={quickAddUpsell}
          onChoose={chooseUpsell}
          onNext={nextUpsellStep}
          onClose={finishUpsell}
        />
      )}

      {chatAddonEnabled && activeMenuView === 'list' && (
        <AiChatWidget
          tenantSlug={tenant.slug}
          tenantName={tenant.name}
          primaryColor={primaryColor}
          audioEnabled={chatAddonAudioEnabled}
          textEnabled={chatAddonTextEnabled}
          products={baseProducts}
          onAddToCart={(product, options, unitPrice, note, mods, editorState) => { if (directOrdersEnabled) addToCart(product, options, unitPrice, note, mods, editorState, undefined, 1, 'chat') }}
          menuId={menu?.id ?? null}
          locationId={location?.id ?? null}
          cartOpen={cartPanelVisible}
          orderBarVisible={showOrderBar}
          onOpenCart={directOrdersEnabled ? () => setCartOpen(true) : undefined}
          language={selectedLanguage}
          cart={directOrdersEnabled ? cart.map(i => ({ name: i.product.name, quantity: i.quantity, options: summarizeOptions(i.selectedOptions) || undefined })) : null}
          canOrder={directOrdersEnabled}
          tableId={waiterCallTable?.id ?? orderingTable?.id ?? null}
        />
      )}

      {analyticsDebug ? (
        <AnalyticsDebugPanel
          sessionId={analyticsTracker?.sessionId ?? null}
          onClose={() => setAnalyticsDebug(false)}
        />
      ) : null}

      {showHoursModal && (
        <ModalPortal onClose={() => setShowHoursModal(false)}>
          <div className="menu-root fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]" onClick={() => setShowHoursModal(false)} lang={localeFor(selectedLanguage)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={copy.hoursTitle}
              className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl bg-white shadow-float"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 className="text-[17px] font-semibold text-zinc-900">{copy.hoursTitle}</h2>
                <button type="button" onClick={() => setShowHoursModal(false)} aria-label={copy.close} className="flex size-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
                  <X className="size-5" />
                </button>
              </div>
              {openLabel && (
                <p className={`mx-5 mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${openLabel.tone === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                  {openLabel.tone !== 'info' && <span aria-hidden="true" className={`size-[7px] rounded-full ${openLabel.tone === 'open' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />}
                  {openLabel.text}
                </p>
              )}
              <ul className="px-5 pb-5">
                {WEEK_KEYS.map(({ key, index }) => {
                  const value = hours?.[key as keyof typeof hours]
                  const isToday = openInfo?.todayIndex === index
                  return (
                    <li key={key} className={`flex items-center justify-between gap-4 border-b border-zinc-100 py-3 text-[15px] last:border-0 ${isToday ? 'font-semibold text-zinc-900' : 'text-zinc-600'}`}>
                      <span className="shrink-0 capitalize">{formatWeekday(index, selectedLanguage)}{isToday && <span className="ml-2 text-[12px] font-medium text-zinc-400">{copy.today}</span>}</span>
                      <span className="min-w-0 break-words text-right tabular-nums">{value || copy.closed}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </ModalPortal>
      )}

      {directOrdersEnabled && (
        <CartPanel
          cart={cart}
          currency={currency}
          lang={selectedLanguage}
          primaryColor={primaryColor}
          open={cartOpen && !checkoutOpen}
          onClose={() => setCartOpen(false)}
          onCheckout={() => setCheckoutOpen(true)}
          onEdit={editItem}
          onRemove={removeFromCart}
          onUpdateQuantity={updateCartQuantity}
        />
      )}

      {directOrdersEnabled && checkoutOpen && (
        <CheckoutModal
          cart={cart}
          confirmedCart={confirmedCart}
          currency={currency}
          lang={selectedLanguage}
          customerName={customerName}
          customerPhone={customerPhone}
          submittingOrder={submittingOrder}
          orderSuccess={orderSuccess}
          orderError={orderError}
          orderId={orderId}
          primaryColor={primaryColor}
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
          tableName={orderingTable?.name ?? null}
          orderType={checkoutOrderType}
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

const FEATURED_TAB = '__featured'
const OTHER_TAB = '__other'
// Monday first; index = JS weekday (0 = Sunday).
const WEEK_KEYS = [
  { key: 'mon', index: 1 }, { key: 'tue', index: 2 }, { key: 'wed', index: 3 }, { key: 'thu', index: 4 },
  { key: 'fri', index: 5 }, { key: 'sat', index: 6 }, { key: 'sun', index: 0 },
]

function DishPlaceholder() {
  return (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200/70">
      <UtensilsCrossed className="size-6 text-zinc-300" aria-hidden="true" />
    </div>
  )
}

/**
 * One dish. Phones: a row — text left, photo right with the add button on it.
 * Larger screens: a card with the photo on top. The whole card opens the dish.
 */
function ProductCard({ product, lang, currency, primaryColor, price, onOpen, cartQuantity, onAdd, onIncrement, onDecrement }: {
  product: Product; lang: string; currency: string; primaryColor: string; onOpen: () => void
  /** The price as shown ("From $15.00" for a dish with sizes). */
  price: { text: string; from: boolean }
  cartQuantity?: number; onAdd?: () => void; onIncrement?: () => void; onDecrement?: () => void
}) {
  const copy = getMenuCopy(lang)
  const image = getProductImages(product)[0]
  const quantity = cartQuantity ?? 0
  const promo = !price.from && product.original_price && product.original_price > product.price ? product.original_price : null
  return (
    <article
      data-analytics-product-id={product.id}
      data-analytics-source="grid"
      className="group relative flex gap-3 rounded-2xl bg-white p-3 shadow-card transition-shadow hover:shadow-[0_2px_6px_rgb(0_0_0/0.06),0_12px_32px_rgb(0_0_0/0.08)] sm:flex-col sm:gap-0 sm:overflow-hidden sm:p-0"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={product.name}
        className="absolute inset-0 z-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30"
      />
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col sm:order-2 sm:p-4">
        <h3 className="line-clamp-2 text-[16px] font-semibold leading-snug text-zinc-900">{product.name}</h3>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-500">{product.description}</p>
        )}
        {product.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {product.tags.slice(0, 2).map(tag => (
              <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{translateTag(tag, lang)}</span>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{price.text}</span>
          {promo && <span className="text-[13px] tabular-nums text-zinc-400 line-through">{formatMoney(promo, currency, lang)}</span>}
        </div>
      </div>
      <div className="pointer-events-none relative size-[104px] shrink-0 sm:order-1 sm:aspect-[4/3] sm:size-auto sm:w-full">
        <div className="relative size-full overflow-hidden rounded-xl bg-zinc-100 sm:rounded-none">
          {image
            ? <Image src={image} alt="" fill sizes="(max-width: 640px) 104px, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 sm:group-hover:scale-[1.03]" />
            : <DishPlaceholder />}
        </div>
        {onAdd && quantity === 0 && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={fill(copy.addNamed, { name: product.name })}
            style={{ color: primaryColor }}
            className="pointer-events-auto absolute right-1.5 bottom-1.5 z-10 flex size-9 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.18)] transition-[scale] active:scale-90 sm:right-3 sm:bottom-3"
          >
            <Plus className="size-[18px]" strokeWidth={2.5} />
          </button>
        )}
        {onIncrement && onDecrement && quantity > 0 && (
          <div className="pointer-events-auto absolute right-1.5 bottom-1.5 z-10 flex h-9 items-center rounded-full bg-white px-0.5 shadow-[0_1px_4px_rgb(0_0_0/0.18)] sm:right-3 sm:bottom-3">
            <button type="button" onClick={onDecrement} aria-label={fill(copy.removeNamed, { name: product.name })} className="flex size-8 items-center justify-center rounded-full text-zinc-800">
              <Minus className="size-3.5" strokeWidth={2.5} />
            </button>
            <span className="min-w-4 text-center text-[14px] font-semibold tabular-nums text-zinc-900">{quantity}</span>
            <button type="button" onClick={onIncrement} aria-label={fill(copy.addNamed, { name: product.name })} style={{ color: primaryColor }} className="flex size-8 items-center justify-center rounded-full">
              <Plus className="size-3.5" strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
