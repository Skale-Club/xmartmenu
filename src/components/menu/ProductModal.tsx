'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import type { Product, ProductIngredientWithIngredient, IngredientModifications, IngredientRemoval, IngredientExtra, ProductMedia } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { UI_COPY, getProductImages, type CartEditorState } from './menu-utils'

const TAG_TRANSLATIONS: Record<string, Record<string, string>> = {
  'Vegetarian': { en: 'Vegetarian' },
  'Vegan': { en: 'Vegan' },
  'Gluten-Free': { en: 'Gluten-Free' },
  'Spicy': { en: 'Spicy' },
  'Chef\'s special': { en: 'Chef\'s special' },
}

const TAG_COLORS: Record<string, string> = {
  'Vegetarian': 'bg-green-100 text-green-700',
  'Vegan': 'bg-emerald-100 text-emerald-700',
  'Gluten-Free': 'bg-amber-100 text-amber-700',
  'Spicy': 'bg-red-100 text-red-700',
  'Chef\'s special': 'bg-purple-100 text-purple-700',
}

function translateTag(tag: string, lang: string): string {
  return TAG_TRANSLATIONS[tag]?.[lang] ?? tag
}

function getTagStyle(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-zinc-100 text-zinc-600'
}

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

export default function ProductModal({ product, accentColor, currency, whatsapp, lang, onClose, onWhatsApp, onAddToCart, optionGroups = [], itemNotesEnabled = false, ingredientCustomizationEnabled = false, productIngredients = [], productMedia = [], initialEditorState = null, submitLabel = 'Order', onPrevProduct, onNextProduct }: {
  product: Product; accentColor: string; currency: string; whatsapp?: string | null;
  lang: string; onClose: () => void; onWhatsApp: () => void;
  onAddToCart?: (selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null, editorState?: CartEditorState | null) => void;
  optionGroups?: GroupWithOptions[]
  itemNotesEnabled?: boolean
  ingredientCustomizationEnabled?: boolean
  productIngredients?: ProductIngredientWithIngredient[]
  productMedia?: ProductMedia[]
  initialEditorState?: CartEditorState | null  // when set, the modal opens in Edit mode pre-filled with these selections
  submitLabel?: string
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
  const [showAddIngredient, setShowAddIngredient] = useState(false)

  useEffect(() => {
    // Re-open in Edit mode pre-fills from initialEditorState; otherwise resets for a fresh product.
    setSingleSelections(initialEditorState?.singleSelections ?? {})
    setHalfSelections(initialEditorState?.halfSelections ?? {})
    setMultiSelections(initialEditorState?.multiSelections ?? {})
    setItemNote(initialEditorState?.note ?? '')  // Pitfall 6: reset note when new product opens
    setIngredientSteppers(initialEditorState?.ingredientSteppers ?? {})
    setAddedIngredients(initialEditorState?.addedIngredients ?? [])
    setShowAddIngredient(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

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
          // D-10: max of the two base_prices (not price_modifier)
          price = Math.max(opt1?.base_price ?? 0, opt2?.base_price ?? 0)
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4" onClick={onClose}>
      <div className="relative w-full sm:max-w-md lg:max-w-lg" onClick={e => e.stopPropagation()}>
      {onPrevProduct && (
        <button
          onClick={onPrevProduct}
          aria-label="Previous dish"
          className="hidden sm:flex absolute top-1/2 -translate-y-1/2 -left-14 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-zinc-900 shadow-lg items-center justify-center text-2xl leading-none transition-all active:scale-90"
        >
          ‹
        </button>
      )}
      {onNextProduct && (
        <button
          onClick={onNextProduct}
          aria-label="Next dish"
          className="hidden sm:flex absolute top-1/2 -translate-y-1/2 -right-14 z-20 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-zinc-900 shadow-lg items-center justify-center text-2xl leading-none transition-all active:scale-90"
        >
          ›
        </button>
      )}
      <div className="bg-white w-full rounded-t-2xl sm:rounded-2xl overflow-hidden">
        {mediaSlides.length > 0 && (
          <div
            className="relative w-full aspect-video bg-zinc-100 overflow-hidden"
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
                sizes="(max-width: 768px) 100vw, 448px"
              />
            )}
            {hasManySlides && (
              <>
                <button
                  onClick={prevImage}
                  className="absolute z-10 left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/75 text-white w-9 h-9 rounded-full shadow-md flex items-center justify-center"
                  aria-label="Previous"
                  type="button"
                >
                  ‹
                </button>
                <button
                  onClick={nextImage}
                  className="absolute z-10 right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/75 text-white w-9 h-9 rounded-full shadow-md flex items-center justify-center"
                  aria-label="Next"
                  type="button"
                >
                  ›
                </button>
                <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
                  {mediaSlides.map((slide, i) => (
                    <button
                      key={i}
                      onClick={() => setSlideIndex(i)}
                      className={`rounded-full ${i === slideIndex ? 'bg-white' : 'bg-white/50'} ${slide.type === 'video' ? 'w-3 h-1.5' : 'w-1.5 h-1.5'}`}
                      aria-label={`Go to ${slide.type} ${i + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="p-5 sm:p-6" onTouchStart={handleBodyTouchStart} onTouchEnd={handleBodyTouchEnd}>
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
          {optionGroups.length > 0 && (
            <div className="mt-4 space-y-6">
              {optionGroups.map(group => {
                const groupUi = UI_COPY[lang] ?? UI_COPY.en
                // Min/max hint text
                const hintText = (() => {
                  const min = group.min_selections
                  const max = group.max_selections
                  if (min > 0 && max !== null && min !== max) return groupUi.chooseBetween.replace('{min}', String(min)).replace('{max}', String(max))
                  if (min > 0 && (max === null || max === min)) return groupUi.chooseAtLeast.replace('{min}', String(min))
                  if (max !== null) return groupUi.chooseUpTo.replace('{max}', String(max))
                  return null
                })()

                return (
                  <div key={group.id}>
                    {/* Group header */}
                    <div className="flex items-center mb-2">
                      <span className="text-sm font-bold text-zinc-900">{group.name}</span>
                      {group.required && (
                        <span className="ml-2 text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                          {groupUi.required}
                        </span>
                      )}
                    </div>
                    {hintText && group.type !== 'half_and_half' && (
                      <p className="text-xs text-zinc-400 mb-2">{hintText}</p>
                    )}

                    {/* Single-type: radio buttons */}
                    {group.type === 'single' && (
                      <div className="space-y-1">
                        {group.options.map(opt => {
                          const isSelected = singleSelections[group.id] === opt.id
                          return (
                            <label
                              key={opt.id}
                              className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer min-h-[44px] ${isSelected ? 'bg-zinc-50 border-zinc-900' : 'bg-white border-zinc-200'}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="radio"
                                  name={group.id}
                                  value={opt.id}
                                  checked={isSelected}
                                  onChange={() => setSingleSelections(prev => ({ ...prev, [group.id]: opt.id }))}
                                  className="sr-only"
                                />
                                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${isSelected ? 'border-zinc-900 bg-zinc-900' : 'border-zinc-300'}`} />
                                <span className="text-sm text-zinc-900 truncate">{opt.name}</span>
                                {opt.price_modifier !== 0 && opt.base_price === null && (
                                  <span className="text-sm text-zinc-500 flex-shrink-0">
                                    {opt.price_modifier > 0 ? '+' : ''}{formatPrice(opt.price_modifier, currency)}
                                  </span>
                                )}
                              </div>
                              {opt.base_price !== null && (
                                <span className="text-sm font-bold text-zinc-900 flex-shrink-0">{formatPrice(opt.base_price, currency)}</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {/* Multiple-type: checkboxes */}
                    {group.type === 'multiple' && (() => {
                      const selected = multiSelections[group.id] ?? []
                      const maxReached = group.max_selections !== null && selected.length >= group.max_selections
                      return (
                        <div className="space-y-1">
                          {group.options.map(opt => {
                            const isChecked = selected.includes(opt.id)
                            const isDisabled = maxReached && !isChecked
                            return (
                              <label
                                key={opt.id}
                                aria-disabled={isDisabled ? 'true' : undefined}
                                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer min-h-[44px] ${isChecked ? 'bg-zinc-50 border-zinc-900' : 'bg-white border-zinc-200'} ${isDisabled ? 'opacity-40 pointer-events-none' : ''}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    value={opt.id}
                                    checked={isChecked}
                                    onChange={() => {
                                      setMultiSelections(prev => {
                                        const cur = prev[group.id] ?? []
                                        return {
                                          ...prev,
                                          [group.id]: isChecked ? cur.filter(id => id !== opt.id) : [...cur, opt.id],
                                        }
                                      })
                                    }}
                                    className="sr-only"
                                  />
                                  <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${isChecked ? 'border-zinc-900 bg-zinc-900' : 'border-zinc-300'}`}>
                                    {isChecked && (
                                      <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" className="w-3 h-3">
                                        <polyline points="2,6 5,9 10,3" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className="text-sm text-zinc-900 truncate">{opt.name}</span>
                                  {opt.price_modifier !== 0 && (
                                    <span className="text-sm text-zinc-500 flex-shrink-0">
                                      {opt.price_modifier > 0 ? '+' : ''}{formatPrice(opt.price_modifier, currency)}
                                    </span>
                                  )}
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* Half-and-half: two stacked radio selectors */}
                    {group.type === 'half_and_half' && (() => {
                      const half = halfSelections[group.id] ?? { half1: null, half2: null }
                      const groupUiLocal = UI_COPY[lang] ?? UI_COPY.en
                      const halfNames: Array<'half1' | 'half2'> = ['half1', 'half2']
                      const halfLabels = [groupUiLocal.firstHalf, groupUiLocal.secondHalf]
                      const halfPrice = (() => {
                        if (!half.half1 || !half.half2) return null
                        const opt1 = group.options.find(o => o.id === half.half1)
                        const opt2 = group.options.find(o => o.id === half.half2)
                        return Math.max(opt1?.base_price ?? 0, opt2?.base_price ?? 0)
                      })()
                      return (
                        <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3 space-y-3">
                          {halfNames.map((halfKey, idx) => (
                            <div key={halfKey}>
                              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1">
                                {group.name} | {halfLabels[idx]}
                              </p>
                              <div className="space-y-1">
                                {group.options.map(opt => {
                                  const isSelected = half[halfKey] === opt.id
                                  return (
                                    <label
                                      key={opt.id}
                                      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer min-h-[44px] ${isSelected ? 'bg-white border-zinc-900' : 'bg-white border-zinc-200'}`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <input
                                          type="radio"
                                          name={`${group.id}-${halfKey}`}
                                          value={opt.id}
                                          checked={isSelected}
                                          onChange={() => setHalfSelections(prev => ({
                                            ...prev,
                                            [group.id]: { ...(prev[group.id] ?? { half1: null, half2: null }), [halfKey]: opt.id },
                                          }))}
                                          className="sr-only"
                                        />
                                        <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${isSelected ? 'border-zinc-900 bg-zinc-900' : 'border-zinc-300'}`} />
                                        <span className="text-sm text-zinc-900 truncate">{opt.name}</span>
                                      </div>
                                      {opt.base_price !== null && (
                                        <span className="text-sm font-bold text-zinc-900 flex-shrink-0">{formatPrice(opt.base_price, currency)}</span>
                                      )}
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                          {halfPrice !== null && (
                            <p className="text-xs text-zinc-500 pt-1">
                              Price: {formatPrice(halfPrice, currency)}
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          )}
          {ingredientCustomizationEnabled && productIngredients.length > 0 && (
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase mb-2">Ingredients</p>

              {/* Default ingredient chips with stepper */}
              <div className="space-y-2">
                {productIngredients.filter(pi => pi.is_default).map(pi => {
                  const stepperVal = ingredientSteppers[pi.ingredient_id] ?? 0
                  const extraPrice = pi.extra_price_override ?? pi.ingredient.default_extra_price
                  return (
                    <div key={pi.ingredient_id} className="flex items-center justify-between gap-2">
                      <span className={`text-sm flex-1 ${stepperVal === -1 ? 'text-red-600 line-through' : 'text-zinc-800'}`}>
                        {pi.ingredient.name}
                      </span>
                      {stepperVal === 1 && extraPrice > 0 && (
                        <span className="text-xs text-amber-600">+{formatPrice(extraPrice, currency)}</span>
                      )}
                      <div className="flex items-center gap-1">
                        {([-1, 0, 1] as const).map(val => (
                          <button
                            key={val}
                            onClick={() => setIngredientSteppers(prev => ({ ...prev, [pi.ingredient_id]: val }))}
                            className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors
                              ${stepperVal === val
                                ? 'bg-zinc-900 text-white'
                                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                          >
                            {val === -1 ? '−' : val === 0 ? '0' : '+'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Add ingredient expandable picker */}
              {productIngredients.filter(pi => !pi.is_default && !addedIngredients.includes(pi.ingredient_id)).length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowAddIngredient(v => !v)}
                    className="text-sm text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                  >
                    + Add ingredient
                  </button>
                  {showAddIngredient && (
                    <div className="mt-2 border border-zinc-200 rounded-xl overflow-hidden">
                      {productIngredients
                        .filter(pi => !pi.is_default && !addedIngredients.includes(pi.ingredient_id))
                        .map(pi => {
                          const addPrice = pi.add_price_override ?? pi.ingredient.default_add_price
                          return (
                            <div key={pi.ingredient_id} className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 last:border-b-0">
                              <span className="text-sm text-zinc-800">{pi.ingredient.name}</span>
                              <div className="flex items-center gap-2">
                                {addPrice > 0 && (
                                  <span className="text-xs text-zinc-500">+{formatPrice(addPrice, currency)}</span>
                                )}
                                <button
                                  onClick={() => {
                                    setAddedIngredients(prev => [...prev, pi.ingredient_id])
                                    setShowAddIngredient(false)
                                  }}
                                  className="text-xs bg-zinc-900 text-white px-2 py-1 rounded-lg hover:bg-zinc-800"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* Selected added ingredients as removable chips */}
              {addedIngredients.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {addedIngredients.map(ingId => {
                    const pi = productIngredients.find(p => p.ingredient_id === ingId)
                    if (!pi) return null
                    const addPrice = pi.add_price_override ?? pi.ingredient.default_add_price
                    return (
                      <div key={ingId} className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-full px-2 py-1">
                        <span className="text-xs text-green-600">
                          {pi.ingredient.name}{addPrice > 0 ? ` +${formatPrice(addPrice, currency)}` : ''}
                        </span>
                        <button
                          onClick={() => setAddedIngredients(prev => prev.filter(id => id !== ingId))}
                          className="text-green-500 hover:text-green-700 text-xs leading-none ml-0.5"
                          aria-label={`Remove ${pi.ingredient.name}`}
                        >
                          &#x2715;
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {itemNotesEnabled && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Notes
                <span className="ml-2 text-xs text-zinc-400 font-normal">Max. 140 characters</span>
              </label>
              <textarea
                value={itemNote}
                onChange={e => setItemNote(e.target.value.slice(0, 140))}
                placeholder="Ex: no ice, well done..."
                rows={2}
                maxLength={140}
                className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none"
              />
              <p className="text-xs text-zinc-400 text-right mt-1">{itemNote.length}/140</p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-4">
            <div>
              {product.original_price && <p className="text-sm text-zinc-400 line-through">{formatPrice(product.original_price, currency)}</p>}
              <p style={{ color: accentColor }} className="text-2xl font-bold">
                {formatPrice(finalUnitPrice, currency)}
              </p>
              {optionGroups.length > 0 && finalUnitPrice !== product.price && (
                <p className="text-xs text-zinc-400">Base: {formatPrice(product.price, currency)}</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              {whatsapp && (
                <button onClick={onWhatsApp} className="w-full sm:w-auto bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-600 transition-colors">
                  Order via WhatsApp
                </button>
              )}
              {onAddToCart && (
                <button
                  onClick={() => {
                    if (!onAddToCart) return
                    // Build selectedOptions from current selections
                    const opts: Record<string, unknown> = {}
                    for (const group of optionGroups) {
                      if (group.type === 'single') {
                        const optId = singleSelections[group.id]
                        if (optId) {
                          const opt = group.options.find(o => o.id === optId)
                          if (opt) opts[group.name] = opt.name
                        }
                      } else if (group.type === 'half_and_half') {
                        const half = halfSelections[group.id]
                        if (half?.half1 && half?.half2) {
                          const opt1 = group.options.find(o => o.id === half.half1)
                          const opt2 = group.options.find(o => o.id === half.half2)
                          if (opt1 && opt2) opts[group.name] = `${opt1.name} / ${opt2.name}`
                        }
                      } else if (group.type === 'multiple') {
                        const sel = multiSelections[group.id] ?? []
                        if (sel.length > 0) {
                          opts[group.name] = sel
                            .map(id => group.options.find(o => o.id === id)?.name)
                            .filter(Boolean)
                            .join(', ')
                        }
                      }
                    }
                    const mods = buildIngredientModifications()
                    const editorState: CartEditorState = {
                      singleSelections,
                      halfSelections,
                      multiSelections,
                      ingredientSteppers,
                      addedIngredients,
                      note: itemNote,
                    }
                    onAddToCart(opts, finalUnitPrice, itemNote || undefined, mods, editorState)
                  }}
                  disabled={!canAddToCart}
                  aria-disabled={!canAddToCart}
                  className={`w-full sm:w-auto bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${canAddToCart ? 'hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'}`}
                >
                  {submitLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
