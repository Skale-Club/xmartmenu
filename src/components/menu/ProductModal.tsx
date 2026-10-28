'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Check, ChevronLeft, ChevronRight, MessageCircle, Minus, Phone, Plus, X } from 'lucide-react'
import type { DishDetail } from '@/lib/public-dish-details'
import DishDetails from './DishDetails'
import type { Product, ProductIngredientWithIngredient, IngredientModifications, IngredientRemoval, IngredientExtra, ProductMedia } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { getProductImages, type CartEditorState } from './menu-utils'
import { fill, formatMoney, getMenuCopy, translateTag } from './menu-i18n'
import { computePrimaryForeground } from '@/lib/color-utils'
import { baseName } from '@/lib/menu-translations'
import { getGuestCopy } from './guest-copy'
import { contactLinks, displayPrice, optionPriceList, orderedItemText, showcaseItemText } from './showcase'
import ModalPortal from '@/components/ui/ModalPortal'
import { halfAndHalfUnit } from '@/lib/menu/option-pricing'

type MediaSlide = { type: 'image'; url: string } | { type: 'video'; url: string }

function isYouTubeUrl(url: string) { return /youtu\.?be/.test(url) }
function isVimeoUrl(url: string) { return /vimeo\.com/.test(url) }

function getYouTubeId(url: string) {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return match?.[1] ?? null
}

function VideoSlide({ url }: { url: string }) {
  if (isYouTubeUrl(url)) {
    const vid = getYouTubeId(url)
    if (vid) {
      return (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${vid}?rel=0`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Product video"
        />
      )
    }
  }
  if (isVimeoUrl(url)) {
    const match = url.match(/vimeo\.com\/(\d+)/)
    const vid = match?.[1]
    if (vid) {
      return (
        <iframe
          src={`https://player.vimeo.com/video/${vid}?autoplay=0`}
          className="w-full h-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title="Product video"
        />
      )
    }
  }
  // Direct video file
  return (
    <video
      src={url}
      autoPlay
      muted
      loop
      playsInline
      className="w-full h-full object-cover"
    />
  )
}

export default function ProductModal({ product, primaryColor, currency, whatsapp, lang, onClose, onWhatsApp, onAddToCart, showcase: showcaseProp, contact = null, onCustomizationStarted, optionGroups = [], itemNotesEnabled = false, ingredientCustomizationEnabled = false, productIngredients = [], productMedia = [], initialEditorState = null, onPrevProduct, onNextProduct, details = [] }: {
  /** Ingredient and allergen notes, shown right after the description. */
  details?: DishDetail[]
  product: Product; primaryColor: string; currency: string;
  /** Set when guests may send their order on WhatsApp (TenantCapabilities.whatsappOrders): shows "Order on WhatsApp". */
  whatsapp?: string | null;
  lang: string; onClose: () => void;
  /** "Order on WhatsApp": `item` names the dish with the choices made (or its sizes, in showcase). */
  onWhatsApp?: (item: string) => void;
  /** quantity: how many of this exact configuration to add (always 1 when editing a cart item). */
  onAddToCart?: (selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null, editorState?: CartEditorState | null, quantity?: number) => void;
  /** View-only menu: options as a price list, no choices, no cart (defaults to !onAddToCart). */
  showcase?: boolean
  /** The restaurant's contact details (tenant_settings), shown as links in showcase. */
  contact?: { whatsapp?: string | null; phone?: string | null; instagram?: string | null } | null
  onCustomizationStarted?: () => void
  optionGroups?: GroupWithOptions[]
  itemNotesEnabled?: boolean
  ingredientCustomizationEnabled?: boolean
  productIngredients?: ProductIngredientWithIngredient[]
  productMedia?: ProductMedia[]
  initialEditorState?: CartEditorState | null  // when set, the modal opens in Edit mode pre-filled with these selections
  onPrevProduct?: () => void  // navigate to the previous dish (undefined = no previous / disabled)
  onNextProduct?: () => void  // navigate to the next dish
}) {
  // Build ordered media slides: video first (if any), then images from product_media,
  // falling back to products.image_urls for backward compat
  const mediaSlides: MediaSlide[] = (() => {
    if (productMedia.length > 0) {
      const sorted = [...productMedia].sort((a, b) => a.display_order - b.display_order)
      const videos = sorted.filter(m => m.type === 'video').map(m => ({ type: 'video' as const, url: m.url }))
      const images = sorted.filter(m => m.type === 'image').map(m => ({ type: 'image' as const, url: m.url }))
      return [...videos, ...images]
    }
    return getProductImages(product).map(url => ({ type: 'image' as const, url }))
  })()

  const [slideIndex, setSlideIndex] = useState(0)
  const hasManySlides = mediaSlides.length > 1
  // Keep legacy aliases so the rest of the code still works
  const images = mediaSlides.filter(s => s.type === 'image').map(s => s.url)
  const imageIndex = (() => {
    let img = 0
    for (let i = 0; i < slideIndex; i++) {
      if (mediaSlides[i]?.type === 'image') img++
    }
    return img
  })()
  const hasManyImages = images.length > 1
  const touchStartXRef = useRef<number | null>(null)
  const touchDeltaXRef = useRef(0)
  const [touchOffsetX, setTouchOffsetX] = useState(0)
  const [isDraggingImage, setIsDraggingImage] = useState(false)

  useEffect(() => {
    setSlideIndex(0)
  }, [product.id])

  const [singleSelections, setSingleSelections] = useState<Record<string, string>>(initialEditorState?.singleSelections ?? {})
  const [halfSelections, setHalfSelections] = useState<Record<string, { half1: string | null; half2: string | null }>>(initialEditorState?.halfSelections ?? {})
  const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>(initialEditorState?.multiSelections ?? {})
  const [itemNote, setItemNote] = useState(initialEditorState?.note ?? '')
  const [ingredientSteppers, setIngredientSteppers] = useState<Record<string, number>>(initialEditorState?.ingredientSteppers ?? {})
  const [addedIngredients, setAddedIngredients] = useState<string[]>(initialEditorState?.addedIngredients ?? [])
  const [quantity, setQuantity] = useState(1)
  const [attentionGroupId, setAttentionGroupId] = useState<string | null>(null)
  const customizationTrackedRef = useRef(false)

  useEffect(() => {
    // Re-open in Edit mode pre-fills from initialEditorState; otherwise resets for a fresh product.
    setSingleSelections(initialEditorState?.singleSelections ?? {})
    setHalfSelections(initialEditorState?.halfSelections ?? {})
    setMultiSelections(initialEditorState?.multiSelections ?? {})
    setItemNote(initialEditorState?.note ?? '')  // Pitfall 6: reset note when new product opens
    setIngredientSteppers(initialEditorState?.ingredientSteppers ?? {})
    setAddedIngredients(initialEditorState?.addedIngredients ?? [])
    setQuantity(1)
    setAttentionGroupId(null)
    customizationTrackedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  const showcase = showcaseProp ?? !onAddToCart

  function notifyCustomizationStarted() {
    if (showcase || customizationTrackedRef.current) return
    customizationTrackedRef.current = true
    onCustomizationStarted?.()
  }

  const canAddToCart = optionGroups.every(group => {
    if (!group.required) return true
    if (group.type === 'single') return !!singleSelections[group.id]
    if (group.type === 'half_and_half') {
      const half = halfSelections[group.id]
      return !!half?.half1 && !!half?.half2
    }
    if (group.type === 'multiple') {
      const sel = multiSelections[group.id] ?? []
      return sel.length >= group.min_selections
    }
    return true
  })

  const computedUnitPrice = (() => {
    let price = product.price
    for (const group of optionGroups) {
      if (group.type === 'single') {
        const optId = singleSelections[group.id]
        if (optId) {
          const opt = group.options.find(o => o.id === optId)
          if (opt) {
            if (opt.base_price !== null) price = opt.base_price
            else price += opt.price_modifier
          }
        }
      } else if (group.type === 'half_and_half') {
        const half = halfSelections[group.id]
        if (half?.half1 && half?.half2) {
          const opt1 = group.options.find(o => o.id === half.half1)
          const opt2 = group.options.find(o => o.id === half.half2)
          // D-10: the dearer half; a half without its own price counts as the dish (same as checkout)
          price = halfAndHalfUnit(product.price, opt1, opt2)
        }
      } else if (group.type === 'multiple') {
        const sel = multiSelections[group.id] ?? []
        for (const optId of sel) {
          const opt = group.options.find(o => o.id === optId)
          if (opt) price += opt.price_modifier
        }
      }
    }
    return price
  })()

  // INGR-08: ingredient delta adds on top of options price
  const ingredientDelta = (() => {
    let delta = 0
    // Default ingredients with stepper = +1 (extra)
    for (const pi of productIngredients) {
      const stepperVal = ingredientSteppers[pi.ingredient_id] ?? 0
      if (stepperVal === 1) {
        // extra_price_override ?? catalog default; removal is always free (v1.7)
        delta += pi.extra_price_override ?? pi.ingredient.default_extra_price
      }
    }
    // Non-default added ingredients
    for (const ingId of addedIngredients) {
      const pi = productIngredients.find(p => p.ingredient_id === ingId)
      if (pi) {
        delta += pi.add_price_override ?? pi.ingredient.default_add_price
      }
    }
    return delta
  })()

  const finalUnitPrice = computedUnitPrice + ingredientDelta

  function buildIngredientModifications(): IngredientModifications | null {
    const removed: IngredientRemoval[] = []
    const extras: IngredientExtra[] = []
    const addedMods: IngredientExtra[] = []

    for (const pi of productIngredients) {
      const val = ingredientSteppers[pi.ingredient_id] ?? 0
      if (val === -1 && pi.is_default) {
        removed.push({ ingredient_id: pi.ingredient_id, name: pi.ingredient.name })
      } else if (val === 1 && pi.is_default) {
        const unit_price = pi.extra_price_override ?? pi.ingredient.default_extra_price
        extras.push({ ingredient_id: pi.ingredient_id, name: pi.ingredient.name, qty: 1, unit_price })
      }
    }

    for (const ingId of addedIngredients) {
      const pi = productIngredients.find(p => p.ingredient_id === ingId)
      if (pi) {
        const unit_price = pi.add_price_override ?? pi.ingredient.default_add_price
        addedMods.push({ ingredient_id: ingId, name: pi.ingredient.name, qty: 1, unit_price })
      }
    }

    if (removed.length === 0 && extras.length === 0 && addedMods.length === 0) return null
    return { removed, extras, added: addedMods }
  }

  const prevImage = () => setSlideIndex(i => (i - 1 + mediaSlides.length) % mediaSlides.length)
  const nextImage = () => setSlideIndex(i => (i + 1) % mediaSlides.length)
  const SWIPE_THRESHOLD = 40

  // Swipe to change dish — bound to the modal body (below the media area, so it
  // never conflicts with the image carousel's own swipe).
  const bodyTouchStartXRef = useRef<number | null>(null)
  const PRODUCT_SWIPE_THRESHOLD = 50

  function handleBodyTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    bodyTouchStartXRef.current = e.touches[0]?.clientX ?? null
  }

  function handleBodyTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const start = bodyTouchStartXRef.current
    bodyTouchStartXRef.current = null
    if (start === null) return
    const endX = e.changedTouches[0]?.clientX ?? start
    const delta = endX - start
    if (Math.abs(delta) < PRODUCT_SWIPE_THRESHOLD) return
    if (delta < 0) onNextProduct?.()
    else onPrevProduct?.()
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (!hasManySlides) return
    touchStartXRef.current = e.touches[0]?.clientX ?? null
    touchDeltaXRef.current = 0
    setIsDraggingImage(true)
    setTouchOffsetX(0)
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!hasManySlides || touchStartXRef.current === null) return
    const currentX = e.touches[0]?.clientX ?? touchStartXRef.current
    const delta = currentX - touchStartXRef.current
    touchDeltaXRef.current = delta
    setTouchOffsetX(delta)
  }

  function handleTouchEnd() {
    if (!hasManySlides) return
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

  const copy = getMenuCopy(lang)
  const guestCopy = getGuestCopy(lang)
  const money = (value: number) => formatMoney(value, currency, lang)
  const headerPrice = displayPrice(product.price, optionGroups)
  const onPrimary = computePrimaryForeground(primaryColor)
  const isEditing = !!initialEditorState
  const defaultIngredients = productIngredients.filter(pi => pi.is_default)
  const extraIngredients = productIngredients.filter(pi => !pi.is_default)

  function groupSatisfied(group: GroupWithOptions): boolean {
    if (!group.required) return true
    if (group.type === 'single') return !!singleSelections[group.id]
    if (group.type === 'half_and_half') {
      const half = halfSelections[group.id]
      return !!half?.half1 && !!half?.half2
    }
    if (group.type === 'multiple') return (multiSelections[group.id] ?? []).length >= group.min_selections
    return true
  }

  function groupHint(group: GroupWithOptions): string {
    const need = group.required ? copy.required : copy.optional
    if (group.type === 'single' || group.type === 'half_and_half') return group.type === 'single' ? `${copy.chooseOne} · ${need}` : need
    const min = group.min_selections
    const max = group.max_selections
    let rule: string | null = null
    if (min > 0 && max !== null && min !== max) rule = fill(copy.chooseBetween, { min, max })
    else if (min > 0) rule = fill(copy.chooseAtLeast, { min })
    else if (max !== null) rule = fill(copy.chooseUpTo, { max })
    return rule ? `${rule} · ${need}` : need
  }

  // Option groups in the restaurant's own language, for messages it reads.
  const kitchenGroups = optionGroups.map(group => ({
    ...group,
    name: baseName(group),
    options: group.options.map(opt => ({ ...opt, name: baseName(opt) })),
  }))

  function buildSelectedOptions(): Record<string, unknown> {
    const opts: Record<string, unknown> = {}
    for (const group of optionGroups) {
      if (group.type === 'single') {
        const optId = singleSelections[group.id]
        if (optId) {
          const opt = group.options.find(o => o.id === optId)
          if (opt) opts[baseName(group)] = baseName(opt)
        }
      } else if (group.type === 'half_and_half') {
        const half = halfSelections[group.id]
        if (half?.half1 && half?.half2) {
          const opt1 = group.options.find(o => o.id === half.half1)
          const opt2 = group.options.find(o => o.id === half.half2)
          if (opt1 && opt2) opts[baseName(group)] = `${baseName(opt1)} / ${baseName(opt2)}`
        }
      } else if (group.type === 'multiple') {
        const sel = multiSelections[group.id] ?? []
        if (sel.length > 0) {
          opts[baseName(group)] = sel
            .map(id => { const opt = group.options.find(o => o.id === id); return opt ? baseName(opt) : undefined })
            .filter(Boolean)
            .join(', ')
        }
      }
    }
    return opts
  }

  /** The dish as named in a WhatsApp order: with the choices made, else with its sizes. */
  function whatsappItem(): string {
    const opts = showcase ? {} : buildSelectedOptions()
    if (Object.keys(opts).length > 0) return orderedItemText(baseName(product), opts, finalUnitPrice, money)
    return showcaseItemText(baseName(product), product.price, kitchenGroups, money)
  }

  function submit() {
    if (!onAddToCart) return
    if (!canAddToCart) {
      // Point at the first required choice still missing instead of a dead button.
      const missing = optionGroups.find(g => !groupSatisfied(g))
      if (missing) {
        setAttentionGroupId(missing.id)
        document.getElementById(`option-group-${missing.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }
    const opts = buildSelectedOptions()
    const mods = buildIngredientModifications()
    const editorState: CartEditorState = {
      singleSelections,
      halfSelections,
      multiSelections,
      ingredientSteppers,
      addedIngredients,
      note: itemNote,
    }
    onAddToCart(opts, finalUnitPrice, itemNote || undefined, mods, editorState, isEditing ? 1 : quantity)
  }

  // Showcase footer: how to reach the restaurant about this dish. WhatsApp is
  // left out when the green "Order on WhatsApp" button already covers it.
  const contactDetails = contactLinks(contact, fill(guestCopy.whatsappAsk, { item: baseName(product) }))
  const contactRow = { ...contactDetails, whatsapp: whatsapp && onWhatsApp ? null : contactDetails.whatsapp }
  const hasContactRow = !!(contactRow.whatsapp || contactRow.phone || contactRow.instagram)

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label={copy.close}
      className="flex size-10 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-sm transition-colors hover:bg-white"
    >
      <X className="size-5" />
    </button>
  )

  // Phones: a sheet from the bottom. Larger screens: centred, never taller than the viewport.
  return (
    <ModalPortal onClose={onClose}>
    <div className="menu-root fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div className="relative w-full sm:max-w-lg" onClick={e => e.stopPropagation()}>
      {onPrevProduct && (
        <button
          type="button"
          onClick={onPrevProduct}
          aria-label={copy.previousDish}
          className="absolute top-1/2 -left-14 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-float transition-[scale] active:scale-90 sm:flex"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      {onNextProduct && (
        <button
          type="button"
          onClick={onNextProduct}
          aria-label={copy.nextDish}
          className="absolute top-1/2 -right-14 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-float transition-[scale] active:scale-90 sm:flex"
        >
          <ChevronRight className="size-5" />
        </button>
      )}
      <div role="dialog" aria-modal="true" aria-label={product.name} className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-menu shadow-float sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {mediaSlides.length > 0 ? (
            <div
              className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              {mediaSlides[slideIndex]?.type === 'video' ? (
                <VideoSlide url={mediaSlides[slideIndex].url} />
              ) : (
                <Image
                  src={mediaSlides[slideIndex]?.url ?? ''}
                  alt={`${product.name} ${imageIndex + 1}`}
                  fill
                  className={`object-cover ${isDraggingImage ? '' : 'transition-transform duration-200 ease-out'}`}
                  style={{ transform: `translateX(${touchOffsetX}px)` }}
                  sizes="(max-width: 640px) 100vw, 512px"
                />
              )}
              <div className="absolute top-3 right-3 z-10">{closeButton}</div>
              {hasManySlides && (
                <>
                  <button
                    type="button"
                    onClick={prevImage}
                    className="absolute top-1/2 left-3 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-sm sm:flex"
                    aria-label={copy.previousPhoto}
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={nextImage}
                    className="absolute top-1/2 right-3 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-sm sm:flex"
                    aria-label={copy.nextPhoto}
                  >
                    <ChevronRight className="size-4" />
                  </button>
                  <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                    {mediaSlides.map((slide, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSlideIndex(i)}
                        className={`h-1.5 rounded-full transition-all ${i === slideIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/60'}`}
                        aria-label={`${slide.type === 'video' ? 'Video' : copy.nextPhoto} ${i + 1}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex justify-end px-3 pt-3">{closeButton}</div>
          )}

          <div className="space-y-4 px-5 pt-4 pb-6" onTouchStart={handleBodyTouchStart} onTouchEnd={handleBodyTouchEnd}>
            <div>
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-zinc-900">{product.name}</h2>
                <div className="shrink-0 text-right">
                  <p className="text-[20px] font-semibold tabular-nums tracking-tight text-zinc-900">
                    {headerPrice.from ? fill(guestCopy.fromPrice, { price: money(headerPrice.amount) }) : money(headerPrice.amount)}
                  </p>
                  {!headerPrice.from && product.original_price && product.original_price > product.price && (
                    <p className="text-[13px] tabular-nums text-zinc-400 line-through">{money(product.original_price)}</p>
                  )}
                </div>
              </div>
              {product.description && <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{product.description}</p>}
              <DishDetails details={details} />
              {product.tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {product.tags.map(tag => (
                    <span key={tag} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-700">{translateTag(tag, lang)}</span>
                  ))}
                </div>
              )}
            </div>

            {showcase && optionGroups.map(group => group.options.length > 0 && (
              <section key={group.id} className="overflow-hidden rounded-2xl bg-white shadow-card">
                <h3 className="px-4 pt-4 pb-2 text-[15px] font-semibold text-zinc-900">{group.name}</h3>
                <ul>
                  {optionPriceList(group, money).map(row => (
                    <li key={row.id} className="flex min-h-[44px] items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2">
                      <span className="text-[15px] text-zinc-900">{row.name}</span>
                      {row.price && <span className="shrink-0 text-[14px] tabular-nums text-zinc-600">{row.price}</span>}
                    </li>
                  ))}
                </ul>
                <div className="h-1" />
              </section>
            ))}

            {!showcase && optionGroups.map(group => {
              const needsAttention = attentionGroupId === group.id && !groupSatisfied(group)
              return (
                <section
                  key={group.id}
                  id={`option-group-${group.id}`}
                  className={`overflow-hidden rounded-2xl bg-white shadow-card transition-shadow ${needsAttention ? 'ring-2 ring-red-300' : ''}`}
                >
                  <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2">
                    <h3 className="text-[15px] font-semibold text-zinc-900">{group.name}</h3>
                    <span className={`text-right text-[12px] font-medium ${needsAttention ? 'text-red-600' : 'text-zinc-500'}`}>{groupHint(group)}</span>
                  </div>

                  {group.type === 'single' && group.options.map(opt => {
                    const isSelected = singleSelections[group.id] === opt.id
                    return (
                      <label key={opt.id} className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2">
                        <span className="flex min-w-0 items-center gap-3">
                          <input
                            type="radio"
                            name={group.id}
                            value={opt.id}
                            checked={isSelected}
                            onChange={() => {
                              notifyCustomizationStarted()
                              setSingleSelections(prev => ({ ...prev, [group.id]: opt.id }))
                            }}
                            className="peer sr-only"
                          />
                          <RadioMark selected={isSelected} color={primaryColor} />
                          <span className="text-[15px] text-zinc-900">{opt.name}</span>
                        </span>
                        {opt.base_price !== null ? (
                          <span className="shrink-0 text-[14px] tabular-nums text-zinc-500">{money(opt.base_price)}</span>
                        ) : opt.price_modifier !== 0 ? (
                          <span className="shrink-0 text-[14px] tabular-nums text-zinc-500">{opt.price_modifier > 0 ? '+' : '−'}{money(Math.abs(opt.price_modifier))}</span>
                        ) : null}
                      </label>
                    )
                  })}

                  {group.type === 'multiple' && (() => {
                    const selected = multiSelections[group.id] ?? []
                    const maxReached = group.max_selections !== null && selected.length >= group.max_selections
                    return group.options.map(opt => {
                      const isChecked = selected.includes(opt.id)
                      const isDisabled = maxReached && !isChecked
                      return (
                        <label
                          key={opt.id}
                          aria-disabled={isDisabled ? 'true' : undefined}
                          className={`flex min-h-[52px] cursor-pointer items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2 ${isDisabled ? 'pointer-events-none opacity-40' : ''}`}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <input
                              type="checkbox"
                              value={opt.id}
                              checked={isChecked}
                              onChange={() => {
                                notifyCustomizationStarted()
                                setMultiSelections(prev => {
                                  const cur = prev[group.id] ?? []
                                  return { ...prev, [group.id]: isChecked ? cur.filter(id => id !== opt.id) : [...cur, opt.id] }
                                })
                              }}
                              className="sr-only"
                            />
                            <CheckMark checked={isChecked} color={primaryColor} />
                            <span className="text-[15px] text-zinc-900">{opt.name}</span>
                          </span>
                          {opt.price_modifier !== 0 && (
                            <span className="shrink-0 text-[14px] tabular-nums text-zinc-500">{opt.price_modifier > 0 ? '+' : '−'}{money(Math.abs(opt.price_modifier))}</span>
                          )}
                        </label>
                      )
                    })
                  })()}

                  {group.type === 'half_and_half' && (() => {
                    const half = halfSelections[group.id] ?? { half1: null, half2: null }
                    const halves: Array<{ key: 'half1' | 'half2'; label: string }> = [
                      { key: 'half1', label: copy.firstHalf },
                      { key: 'half2', label: copy.secondHalf },
                    ]
                    const halfPrice = half.half1 && half.half2
                      ? halfAndHalfUnit(product.price, group.options.find(o => o.id === half.half1), group.options.find(o => o.id === half.half2))
                      : null
                    return (
                      <>
                        {halves.map(({ key, label }) => (
                          <div key={key}>
                            <p className="border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-[13px] font-medium text-zinc-500">{label}</p>
                            {group.options.map(opt => {
                              const isSelected = half[key] === opt.id
                              return (
                                <label key={opt.id} className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2">
                                  <span className="flex min-w-0 items-center gap-3">
                                    <input
                                      type="radio"
                                      name={`${group.id}-${key}`}
                                      value={opt.id}
                                      checked={isSelected}
                                      onChange={() => {
                                        notifyCustomizationStarted()
                                        setHalfSelections(prev => ({
                                          ...prev,
                                          [group.id]: { ...(prev[group.id] ?? { half1: null, half2: null }), [key]: opt.id },
                                        }))
                                      }}
                                      className="sr-only"
                                    />
                                    <RadioMark selected={isSelected} color={primaryColor} />
                                    <span className="text-[15px] text-zinc-900">{opt.name}</span>
                                  </span>
                                  {opt.base_price !== null && (
                                    <span className="shrink-0 text-[14px] tabular-nums text-zinc-500">{money(opt.base_price)}</span>
                                  )}
                                </label>
                              )
                            })}
                          </div>
                        ))}
                        {halfPrice !== null && (
                          <p className="border-t border-zinc-100 px-4 py-3 text-[13px] font-medium text-zinc-600">{fill(copy.halfPrice, { price: money(halfPrice) })}</p>
                        )}
                      </>
                    )
                  })()}
                  <div className="h-1" />
                </section>
              )
            })}

            {!showcase && ingredientCustomizationEnabled && defaultIngredients.length > 0 && (
              <section className="overflow-hidden rounded-2xl bg-white shadow-card">
                <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2">
                  <h3 className="text-[15px] font-semibold text-zinc-900">{copy.ingredients}</h3>
                  <span className="text-[12px] font-medium text-zinc-500">{copy.ingredientsHint}</span>
                </div>
                {defaultIngredients.map(pi => {
                  const value = ingredientSteppers[pi.ingredient_id] ?? 0
                  const count = value + 1
                  const extraPrice = pi.extra_price_override ?? pi.ingredient.default_extra_price
                  const setValue = (next: number) => {
                    notifyCustomizationStarted()
                    setIngredientSteppers(prev => ({ ...prev, [pi.ingredient_id]: Math.max(-1, Math.min(1, next)) }))
                  }
                  return (
                    <div key={pi.ingredient_id} className="flex min-h-[52px] items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2">
                      <span className="min-w-0">
                        <span className={`text-[15px] ${value === -1 ? 'text-zinc-400 line-through' : 'text-zinc-900'}`}>{pi.ingredient.name}</span>
                        {value === 1 && extraPrice > 0 && (
                          <span className="ml-2 text-[13px] tabular-nums text-zinc-500">+{money(extraPrice)}</span>
                        )}
                      </span>
                      <Stepper
                        value={count}
                        onDecrement={() => setValue(value - 1)}
                        onIncrement={() => setValue(value + 1)}
                        canDecrement={value > -1}
                        canIncrement={value < 1}
                        decrementLabel={fill(copy.withoutNamed, { name: pi.ingredient.name })}
                        incrementLabel={fill(copy.extraNamed, { name: pi.ingredient.name })}
                        color={primaryColor}
                      />
                    </div>
                  )
                })}
                <div className="h-1" />
              </section>
            )}

            {!showcase && ingredientCustomizationEnabled && extraIngredients.length > 0 && (
              <section className="overflow-hidden rounded-2xl bg-white shadow-card">
                <div className="px-4 pt-4 pb-2">
                  <h3 className="text-[15px] font-semibold text-zinc-900">{copy.extras}</h3>
                </div>
                {extraIngredients.map(pi => {
                  const checked = addedIngredients.includes(pi.ingredient_id)
                  const addPrice = pi.add_price_override ?? pi.ingredient.default_add_price
                  return (
                    <label key={pi.ingredient_id} className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2">
                      <span className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            notifyCustomizationStarted()
                            setAddedIngredients(prev => checked ? prev.filter(id => id !== pi.ingredient_id) : [...prev, pi.ingredient_id])
                          }}
                          className="sr-only"
                        />
                        <CheckMark checked={checked} color={primaryColor} />
                        <span className="text-[15px] text-zinc-900">{pi.ingredient.name}</span>
                      </span>
                      {addPrice > 0 && <span className="shrink-0 text-[14px] tabular-nums text-zinc-500">+{money(addPrice)}</span>}
                    </label>
                  )
                })}
                <div className="h-1" />
              </section>
            )}

            {!showcase && itemNotesEnabled && (
              <section className="rounded-2xl bg-white p-4 shadow-card">
                <label htmlFor={`note-${product.id}`} className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-semibold text-zinc-900">{copy.notes}</span>
                  <span className="text-[12px] font-medium tabular-nums text-zinc-500">{itemNote.length}/140</span>
                </label>
                <textarea
                  id={`note-${product.id}`}
                  value={itemNote}
                  onChange={e => setItemNote(e.target.value.slice(0, 140))}
                  placeholder={copy.notesPlaceholder}
                  rows={2}
                  maxLength={140}
                  className="mt-2 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-[16px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5"
                />
              </section>
            )}
          </div>
        </div>

        {((!showcase && onAddToCart) || (whatsapp && onWhatsApp) || (showcase && hasContactRow)) && (
          <div className="shrink-0 space-y-2 border-t border-zinc-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {!showcase && onAddToCart && (
              <div className="flex items-center gap-3">
                {!isEditing && (
                  <div className="flex h-[52px] shrink-0 items-center rounded-2xl border border-zinc-200 bg-white px-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                      aria-label={copy.decrease}
                      className="flex size-10 items-center justify-center rounded-xl text-zinc-800 transition-colors hover:bg-zinc-100 disabled:text-zinc-300"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="min-w-7 text-center text-[16px] font-semibold tabular-nums text-zinc-900" aria-label={copy.quantity}>{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(q => Math.min(99, q + 1))}
                      aria-label={copy.increase}
                      className="flex size-10 items-center justify-center rounded-xl text-zinc-800 transition-colors hover:bg-zinc-100"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={submit}
                  aria-disabled={!canAddToCart}
                  style={{ backgroundColor: primaryColor, color: onPrimary }}
                  className={`flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold shadow-float transition-[opacity,scale] active:scale-[0.98] ${canAddToCart ? 'hover:opacity-95' : 'opacity-50'}`}
                >
                  {canAddToCart ? (
                    <>
                      <span className="truncate">{isEditing ? copy.updateItem : copy.orderNow}</span>
                      <span aria-hidden="true" className="opacity-70">·</span>
                      <span className="tabular-nums">{money(finalUnitPrice * (isEditing ? 1 : quantity))}</span>
                    </>
                  ) : (
                    <span className="truncate text-[15px]">{copy.chooseRequired}</span>
                  )}
                </button>
              </div>
            )}
            {whatsapp && onWhatsApp && (
              <button
                type="button"
                onClick={() => onWhatsApp(whatsappItem())}
                className={!showcase && onAddToCart
                  ? 'w-full py-1.5 text-[14px] font-medium text-emerald-700 hover:underline'
                  : 'flex h-[52px] w-full items-center justify-center rounded-2xl bg-[#25D366] text-[16px] font-semibold text-white transition-opacity hover:opacity-95'}
              >
                {copy.orderWhatsApp}
              </button>
            )}
            {showcase && hasContactRow && (
              <div>
                <p className="text-[12px] font-medium text-zinc-500">{guestCopy.contactTitle}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {contactRow.whatsapp && (
                    <a href={contactRow.whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-zinc-200 px-3.5 text-[14px] font-medium text-zinc-800 transition-colors hover:bg-zinc-50">
                      <MessageCircle className="size-4 text-emerald-600" aria-hidden="true" /> WhatsApp
                    </a>
                  )}
                  {contactRow.phone && (
                    <a href={contactRow.phone.url} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-zinc-200 px-3.5 text-[14px] font-medium text-zinc-800 transition-colors hover:bg-zinc-50">
                      <Phone className="size-4 text-zinc-500" aria-hidden="true" /> {guestCopy.callRestaurant}
                    </a>
                  )}
                  {contactRow.instagram && (
                    <a href={contactRow.instagram.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 min-w-0 items-center gap-1.5 rounded-full border border-zinc-200 px-3.5 text-[14px] font-medium text-zinc-800 transition-colors hover:bg-zinc-50">
                      <Camera className="size-4 shrink-0 text-zinc-500" aria-hidden="true" /> <span className="truncate">{contactRow.instagram.handle}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
    </ModalPortal>
  )
}

function RadioMark({ selected, color }: { selected: boolean; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors"
      style={selected ? { backgroundColor: color, borderColor: color } : { borderColor: '#d4d4d8' }}
    >
      {selected && <span className="size-2 rounded-full bg-white" />}
    </span>
  )
}

function CheckMark({ checked, color }: { checked: boolean; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[22px] shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors"
      style={checked ? { backgroundColor: color, borderColor: color } : { borderColor: '#d4d4d8' }}
    >
      {checked && <Check className="size-3.5 text-white" strokeWidth={3} />}
    </span>
  )
}

function Stepper({ value, onDecrement, onIncrement, canDecrement, canIncrement, decrementLabel, incrementLabel, color }: {
  value: number
  onDecrement: () => void
  onIncrement: () => void
  canDecrement: boolean
  canIncrement: boolean
  decrementLabel: string
  incrementLabel: string
  color: string
}) {
  return (
    <span className="flex h-9 shrink-0 items-center rounded-full border border-zinc-200 bg-white px-0.5">
      <button type="button" onClick={onDecrement} disabled={!canDecrement} aria-label={decrementLabel} className="flex size-8 items-center justify-center rounded-full text-zinc-800 transition-colors hover:bg-zinc-100 disabled:text-zinc-300">
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-5 text-center text-[15px] font-semibold tabular-nums text-zinc-900">{value}</span>
      <button type="button" onClick={onIncrement} disabled={!canIncrement} aria-label={incrementLabel} className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-zinc-100 disabled:text-zinc-300" style={canIncrement ? { color } : undefined}>
        <Plus className="size-3.5" />
      </button>
    </span>
  )
}
