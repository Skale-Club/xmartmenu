'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import type { Product, ProductIngredientWithIngredient, IngredientModifications, IngredientRemoval, IngredientExtra } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import { UI_COPY, getProductImages } from './menu-utils'

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

export default function ProductModal({ product, accentColor, currency, whatsapp, lang, onClose, onWhatsApp, onAddToCart, optionGroups = [], itemNotesEnabled = false, ingredientCustomizationEnabled = false, productIngredients = [] }: {
  product: Product; accentColor: string; currency: string; whatsapp?: string | null;
  lang: string; onClose: () => void; onWhatsApp: () => void;
  onAddToCart?: (selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null) => void;
  optionGroups?: GroupWithOptions[]
  itemNotesEnabled?: boolean
  ingredientCustomizationEnabled?: boolean
  productIngredients?: ProductIngredientWithIngredient[]
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

  const [singleSelections, setSingleSelections] = useState<Record<string, string>>({})
  const [halfSelections, setHalfSelections] = useState<Record<string, { half1: string | null; half2: string | null }>>({})
  const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>({})
  const [itemNote, setItemNote] = useState('')
  const [ingredientSteppers, setIngredientSteppers] = useState<Record<string, number>>({})
  const [addedIngredients, setAddedIngredients] = useState<string[]>([])
  const [showAddIngredient, setShowAddIngredient] = useState(false)

  useEffect(() => {
    setSingleSelections({})
    setHalfSelections({})
    setMultiSelections({})
    setItemNote('')  // Pitfall 6: reset note when new product opens
    setIngredientSteppers({})
    setAddedIngredients([])
    setShowAddIngredient(false)
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
            <Image
              src={images[imageIndex]}
              alt={`${product.name} ${imageIndex + 1}`}
              fill
              className={`object-cover ${isDraggingImage ? '' : 'transition-transform duration-200 ease-out'}`}
              style={{ transform: `translateX(${touchOffsetX}px)` }}
              sizes="(max-width: 768px) 100vw, 448px"
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
                                {group.name} — {halfLabels[idx]}
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
              <p className="text-xs font-semibold text-zinc-500 uppercase mb-2">Ingredientes</p>

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

              {/* "Adicionar ingrediente" expandable picker */}
              {productIngredients.filter(pi => !pi.is_default && !addedIngredients.includes(pi.ingredient_id)).length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowAddIngredient(v => !v)}
                    className="text-sm text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                  >
                    + Adicionar ingrediente
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
                                  Adicionar
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
                          aria-label={`Remover ${pi.ingredient.name}`}
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
                Observações
                <span className="ml-2 text-xs text-zinc-400 font-normal">Máx. 140 caracteres</span>
              </label>
              <textarea
                value={itemNote}
                onChange={e => setItemNote(e.target.value.slice(0, 140))}
                placeholder="Ex: sem gelo, ponto bem passado..."
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
                    onAddToCart(opts, finalUnitPrice, itemNote || undefined, mods)
                  }}
                  disabled={!canAddToCart}
                  aria-disabled={!canAddToCart}
                  className={`w-full sm:w-auto bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${canAddToCart ? 'hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'}`}
                >
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
