'use client'

/**
 * What the guest sees over the camera on Android (the WebXR DOM overlay).
 * Layout approved by the owner in the review preview (docs/product/ar-experience-plan.md §3):
 *
 *   top        close (X) · cart bag with a count badge in the store's secondary
 *              colour (guest ordering, items in the order) · "i" details
 *   name       centred under the top bar, incoming-call style; tap = details
 *   scanning   "Point at the table…", then one tip at a time after a few seconds
 *   surface    a tapping-dot animation with "Tap to place" (ArGestureOnboarding)
 *   placed     bottom dock on the right, 44 px pills: price capsule in the
 *              primary colour · with guest ordering a white "+" that turns into
 *              "− qty +". When the table is lost, a notice with "Try again"
 *              (back to finding the table); no permanent reposition button.
 *   sheets     order sheet (lines, total, "Go to cart") and details sheet
 *              (description, ingredients, how to use, add without closing),
 *              both iOS-style DragSheets over the live camera
 *
 * The dish is never resized. The scene itself (camera, surface, dish,
 * gestures) is src/lib/ar/webxr-dish-session.ts; it receives the overlay root
 * and the gesture layer from here. Mounted in <body> by ArButton.
 */

import { useEffect, useRef, useState, type PointerEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Minus, Plus, ShoppingBag, Smartphone, X } from 'lucide-react'
import type { DishStage } from '@/lib/ar/webxr-dish-session'
import { scanningHintIndex } from '@/lib/ar/surface-finder'
import { dishSwipe } from '@/lib/ar/gesture-router'
import { computePrimaryForeground, visibleFillColor } from '@/lib/color-utils'
import DragSheet from '@/components/sheet/DragSheet'
import { ui } from '@/components/menu/menu-ui'
import type { ArCopy } from './ar-copy'
import ArGestureOnboarding from './ArGestureOnboarding'
import DishHeading from '@/components/menu/DishHeading'

/** One row of the order sheet. */
export interface ArOrderLine { key: string; name: string; qty: number; line: string; /** Unit price, shown when qty > 1. */ unit?: string }

/** Ordering from the camera; absent on a browse-only or waiter-only menu. */
export interface ArCart {
  /** 'add': one more of this dish now. 'choose': the dish needs a choice first (leaves the camera). */
  mode: 'add' | 'choose'
  /** "R$ 34,00", the unit price. */
  priceLabel?: string
  onAdd: () => void
  onChoose: () => void
  /** Items in the whole order (the bag's badge). */
  count: number
  /** Units of this dish in the order (the stepper's number). */
  quantity?: number
  /** Takes one unit of this dish out of the order (the stepper's "−"). */
  onRemove?: () => void
  /** This dish's line total, e.g. "R$ 68,00" for 2 × R$ 34,00. */
  lineLabel?: string
  /** The order sheet's lines and total. */
  summary?: { items: ArOrderLine[]; total: string }
  /** Leaves the camera and opens the menu's cart. */
  onOpenCart?: () => void
}

/** What the details sheet shows. */
export interface ArDishDetails { description?: string | null; ingredients?: string[] }

/** The store's colours: primary for the price capsule, accent for badges. */
export interface ArTheme { primary: string; accent: string }

export interface WebXrDishViewerProps {
  active: boolean
  stage: DishStage
  name: string
  /** Unit price, shown in the dock on every menu type. */
  priceLabel?: string
  copy: ArCopy
  language?: string
  cart?: ArCart | null
  details?: ArDishDetails | null
  theme?: ArTheme
  overlayRef: Ref<HTMLDivElement>
  gestureLayerRef: Ref<HTMLDivElement>
  onExit: () => void
  /** Lifts the dish and goes back to finding the table ("Try again" when the table is lost). */
  onReposition: () => void
  /** The placed dish lost its table (from the session's onTracking). */
  trackingLost?: boolean
  onChoose: () => void
  /** Details sheet's "More info": leaves the camera and opens the dish's own screen. */
  onMoreInfo?: () => void
  /** The menu's 3D dishes: position and steps (swipe the name strip or tap the chevrons). */
  carousel?: { index: number; total: number; onPrev: () => void; onNext: () => void } | null
  /** A dish's model is downloading: its percentage, null when the size is unknown; undefined when nothing loads. */
  loadingPercent?: number | null
}

/** Morse-style position indicator: 5 slots, the current dish is the centred dash. */
const POS_SLOT = 16
const POS_CENTER = 2 * POS_SLOT

const DEFAULT_THEME: ArTheme = { primary: '#18181b', accent: '#e11d48' }
const pill = 'pointer-events-auto flex h-11 items-center justify-center gap-1.5 rounded-full text-[15px] font-semibold'
const glass = 'bg-[rgb(21_24_25/0.88)] text-white'
const shadowText = '[text-shadow:1px_2px_2px_rgb(0_0_0/45%)]'

export default function WebXrDishViewer({ active, stage, name, priceLabel, copy, cart, details, theme = DEFAULT_THEME, overlayRef, gestureLayerRef, onExit, onReposition, onChoose, onMoreInfo, trackingLost = false, carousel = null, loadingPercent }: WebXrDishViewerProps) {
  const [sheet, setSheet] = useState<'order' | 'details' | null>(null)
  // Name-strip swipe (gesture zoning: the only place where a sideways swipe changes dish).
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const onStripDown = (event: PointerEvent<HTMLDivElement>) => {
    swipeStart.current = { x: event.clientX, y: event.clientY }
    swiped.current = false
  }
  const onStripUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || !carousel) return
    const direction = dishSwipe(event.clientX - start.x, event.clientY - start.y)
    if (!direction) return
    swiped.current = true
    if (direction === 'next' && carousel.index < carousel.total - 1) carousel.onNext()
    if (direction === 'prev' && carousel.index > 0) carousel.onPrev()
  }
  // Seconds spent scanning in this run, for the tips (reset whenever the stage changes).
  const [scanSeconds, setScanSeconds] = useState(0)
  const [scanStage, setScanStage] = useState(stage)
  if (scanStage !== stage) {
    setScanStage(stage)
    setScanSeconds(0)
  }
  useEffect(() => {
    if (!active || stage !== 'scanning') return
    const timer = window.setInterval(() => setScanSeconds(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [active, stage])
  // Leaving the camera closes any sheet.
  const [wasActive, setWasActive] = useState(active)
  if (wasActive !== active) {
    setWasActive(active)
    if (!active) setSheet(null)
  }

  if (typeof document === 'undefined') return null

  const tips = [copy.hintLight, copy.hintTexture, copy.hintStepBack]
  const tipIndex = stage === 'scanning' ? scanningHintIndex(scanSeconds * 1000, tips.length) : null
  const placed = stage === 'placed'
  const brand = { backgroundColor: theme.primary, color: computePrimaryForeground(theme.primary, '#151819') }
  const accent = { backgroundColor: theme.accent, color: computePrimaryForeground(theme.accent, '#151819') }
  // Keep tenant identity while ensuring the action separates from the dark sheet.
  // The 94% dark sheet's lightest composite (over a white camera frame).
  const sheetFill = visibleFillColor(theme.primary, theme.accent, '#232627')
  const sheetPrimary = { backgroundColor: sheetFill, color: computePrimaryForeground(sheetFill, '#151819') }
  const price = cart?.priceLabel ?? priceLabel
  const quantity = cart?.quantity ?? 0
  const stepper = cart?.mode === 'add' && quantity > 0 && cart.onRemove
  const closeSheet = () => setSheet(null)
  const openOrder = () => {
    if (cart?.summary) setSheet('order')
    else cart?.onOpenCart?.()
  }

  // The white "− qty +" control, shared by the dock and the details sheet.
  const stepperControl = cart ? (
    <div className="pointer-events-auto flex h-11 items-center gap-0.5 rounded-full bg-white px-1 text-zinc-900 shadow-[0_1px_4px_rgb(0_0_0/0.18)]">
      <button type="button" onClick={cart.onRemove} aria-label={copy.removeOne} className="flex size-9 items-center justify-center rounded-full active:bg-zinc-100">
        <Minus className="size-[18px]" strokeWidth={2.5} />
      </button>
      <span className="min-w-[18px] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{quantity}</span>
      <button type="button" onClick={cart.onAdd} aria-label={copy.addToOrder} className="flex size-9 items-center justify-center rounded-full active:bg-zinc-100">
        <Plus className="size-[18px]" strokeWidth={2.5} />
      </button>
    </div>
  ) : null

  return createPortal(
    <div
      ref={overlayRef}
      className="menu-root fixed inset-0 z-[90] select-none text-white"
      style={{ display: active ? 'block' : 'none', touchAction: 'none' }}
      aria-hidden={!active}
    >
      {/* Receives drag / twist / tap-to-place (webxr-dish-session.ts). */}
      <div ref={gestureLayerRef} className="absolute inset-0" style={{ touchAction: 'none' }} />
      {/* Tap-to-place animation and the first-time move hint. */}
      <ArGestureOnboarding active={active} stage={stage} copy={copy} />

      {/* Top bar: close · cart bag · details */}
      <div data-ar-region="top" className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onExit} aria-label={copy.close} className={`${pill} ${glass} w-11`}>
          <X className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          {cart && cart.count > 0 && (cart.summary || cart.onOpenCart) && (
            <span className="relative inline-flex">
              <button type="button" onClick={openOrder} aria-label={`${copy.viewOrder} · ${cart.count}`} className={`${pill} ${glass} w-11`}>
                <ShoppingBag className="size-5" />
              </button>
              <span aria-hidden className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums shadow-[0_1px_3px_rgb(0_0_0/0.3)]" style={accent}>
                {cart.count}
              </span>
            </span>
          )}
          <button type="button" onClick={() => setSheet('details')} aria-label={copy.details} className={`${pill} ${glass} w-11`}>
            <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden><path d="M12 10.5v8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" /><circle cx="12" cy="5.8" r="1.7" fill="currentColor" /></svg>
          </button>
        </div>
      </div>

      {/* Dish name, incoming-call style; tapping it opens the details. With several 3D
          dishes it is also the carousel: swipe it or tap the chevrons. */}
      <div
        data-ar-region="name"
        onPointerDown={carousel && carousel.total > 1 ? onStripDown : undefined}
        onPointerUp={carousel && carousel.total > 1 ? onStripUp : undefined}
        onPointerCancel={() => { swipeStart.current = null }}
        className={`absolute inset-x-2 top-[calc(max(1rem,env(safe-area-inset-top))+3.5rem)] flex flex-col items-center ${carousel && carousel.total > 1 ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="flex w-full items-center">
          {carousel && carousel.total > 1 && (
            <button type="button" onClick={carousel.onPrev} disabled={carousel.index === 0} aria-label={copy.prevDish}
              className="pointer-events-auto flex size-11 shrink-0 items-center justify-center disabled:opacity-25">
              <ChevronLeft className="size-6 [filter:drop-shadow(1px_2px_1px_rgb(0_0_0/45%))]" aria-hidden />
            </button>
          )}
          <button
            key={name}
            type="button"
            onClick={() => { if (swiped.current) { swiped.current = false; return } setSheet('details') }}
            className={`pointer-events-auto line-clamp-2 min-w-0 flex-1 text-center text-2xl font-semibold leading-[30px] tracking-[-0.01em] motion-safe:animate-[ar-tip-in_240ms_ease-out] ${shadowText}`}
          >
            {name}
          </button>
          {carousel && carousel.total > 1 && (
            <button type="button" onClick={carousel.onNext} disabled={carousel.index === carousel.total - 1} aria-label={copy.nextDish}
              className="pointer-events-auto flex size-11 shrink-0 items-center justify-center disabled:opacity-25">
              <ChevronRight className="size-6 [filter:drop-shadow(1px_2px_1px_rgb(0_0_0/45%))]" aria-hidden />
            </button>
          )}
        </div>
        {carousel && carousel.total > 1 && (
          <div className="relative mt-1.5 h-2 w-20 overflow-hidden" role="img" aria-label={`${carousel.index + 1} / ${carousel.total}`}>
            <div className="absolute inset-y-0 left-0 transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${POS_CENTER - carousel.index * POS_SLOT}px)` }}>
              {Array.from({ length: carousel.total }, (_, i) => i).filter(i => Math.abs(i - carousel.index) <= 3).map(i => {
                const d = Math.min(Math.abs(i - carousel.index), 3)
                return (
                  <span key={i} className="absolute top-px flex h-1.5 w-4 justify-center" style={{ left: i * POS_SLOT }}>
                    <span className="block h-1.5 rounded-full bg-white shadow-[1px_1px_2px_rgb(0_0_0/0.35)] transition-all duration-300 motion-reduce:transition-none"
                      style={{ width: d === 0 ? 14 : 6, opacity: [1, 0.55, 0.25, 0][d], transform: d === 2 ? 'scale(0.75)' : d === 3 ? 'scale(0.4)' : undefined }} />
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* A dish's 3D model downloading: percentage and a thin bar (indeterminate when the size is unknown). */}
      {loadingPercent !== undefined && (
        <div role="progressbar" aria-label={copy.loadingModel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingPercent ?? undefined}
          className="pointer-events-none absolute top-1/2 left-1/2 w-[min(280px,calc(100%-64px))] -translate-x-1/2 -translate-y-1/2 rounded-[20px] bg-[rgb(21_24_25/0.82)] px-4 pt-3.5 pb-3 shadow-[0_8px_28px_rgb(0_0_0/0.25)] backdrop-blur-md">
          <div className="flex items-baseline justify-between gap-3 text-sm font-semibold">
            <span>{copy.loadingModel}</span>
            {loadingPercent !== null && <span className="text-[15px] tabular-nums">{loadingPercent}%</span>}
          </div>
          <div className="relative my-2.5 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-white/75 to-white transition-[width] duration-200 ease-linear"
              style={{ width: loadingPercent === null ? '40%' : `${loadingPercent}%` }}>
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/70 to-transparent motion-safe:animate-[ar-shimmer_1.2s_ease-in-out_infinite]" />
            </div>
          </div>
          <p className="text-xs text-white/65">{copy.justAMoment}</p>
        </div>
      )}

      {/* Scanning: coaching, then one tip at a time */}
      {stage === 'scanning' && (
        <div className="pointer-events-none absolute inset-x-6 top-[38%] flex flex-col items-center gap-3 text-center">
          <Smartphone className="size-10 text-white drop-shadow-lg motion-safe:animate-[ar-scan_2.4s_ease-in-out_infinite]" aria-hidden />
          <p className="rounded-2xl bg-black/55 px-4 py-2.5 text-[15px] font-semibold text-white backdrop-blur-md">{copy.scanning}</p>
          {tipIndex !== null && (
            <p key={tipIndex} role="status" className="rounded-full bg-black/45 px-3.5 py-1.5 text-[13px] font-medium text-white/90 backdrop-blur-md motion-safe:animate-[ar-tip-in_240ms_ease-out]">
              {tips[tipIndex]}
            </p>
          )}
        </div>
      )}
      {placed && trackingLost && (
        <div role="alert" className="pointer-events-none absolute inset-x-6 top-[26%] flex flex-col items-center gap-2.5 text-center">
          <p className="rounded-2xl bg-black/70 px-4 py-3 text-[15px] font-semibold leading-snug text-white backdrop-blur-md">{copy.trackingLost}</p>
          <button type="button" onClick={onReposition} className={`${pill} bg-white px-5 text-zinc-900`}>{copy.tryAgain}</button>
        </div>
      )}

      {/* Bottom dock, on the right: price · + / − qty + */}
      {placed && (
        <div data-ar-region="dock" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex min-w-0 items-center gap-2">
            {price && <span className="flex h-11 shrink-0 items-center rounded-full px-3.5 text-[15px] font-semibold tabular-nums" style={brand}>{price}</span>}
            {cart && (stepper ? stepperControl : (
              <button
                type="button"
                onClick={cart.mode === 'choose' ? onChoose : cart.onAdd}
                aria-label={cart.mode === 'choose' ? copy.chooseOptions : copy.addToOrder}
                className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 shadow-[0_1px_4px_rgb(0_0_0/0.18)] transition-[scale] active:scale-90"
              >
                <Plus className="size-[22px]" strokeWidth={2.5} />
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet === 'details' && (
        <DragSheet tone="dark" contained label={name} closeLabel={copy.close} onClose={closeSheet}
          header={<DishHeading as="h3" size="sheet" name={name} price={price} className="pb-1" />}>
          {details?.description && <p className="mb-2 text-sm leading-5 text-white/80">{details.description}</p>}
          {onMoreInfo && (
            <button type="button" onClick={() => { closeSheet(); onMoreInfo() }}
              className="-ml-0.5 mb-3 inline-flex min-h-11 items-center gap-0.5 text-sm font-semibold text-white/85">
              {copy.moreInfo}<ChevronRight className="size-4 opacity-70" aria-hidden />
            </button>
          )}
          {/* Order row (owner, 2026-11-12): add → "− qty +" in place, and the bag beside it
              whenever the order has anything (also what was added before opening the camera). */}
          {cart && (
            <div className="mt-1 flex items-center gap-2.5 pr-1">{/* pr-1: room for the bag's badge */}
              <div className="min-w-0 flex-1">
                {cart.mode === 'choose' ? (
                  <button type="button" onClick={() => { closeSheet(); onChoose() }} className={`${ui.cta} h-[52px] w-full`} style={sheetPrimary}>{copy.chooseOptions}</button>
                ) : stepper ? (
                  <div className="flex h-[52px] items-center justify-between gap-3 rounded-full bg-white/[0.08] pr-1 pl-5">
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className={`${ui.label} text-white/65`}>{copy.inYourOrder}</span>
                      {cart.lineLabel && <strong className={`text-base ${ui.price}`}>{cart.lineLabel}</strong>}
                    </div>
                    {stepperControl}
                  </div>
                ) : (
                  <button type="button" onClick={cart.onAdd} className={`${ui.cta} h-[52px] w-full`} style={sheetPrimary}>{copy.addToOrder}</button>
                )}
              </div>
              {cart.count > 0 && (cart.summary || cart.onOpenCart) && (
                <span className="relative inline-flex shrink-0">
                  <button type="button" onClick={openOrder} aria-label={`${copy.viewOrder} · ${cart.count}`}
                    className="flex size-[52px] items-center justify-center rounded-full bg-white/[0.12] text-white active:bg-white/20">
                    <ShoppingBag className="size-5" />
                  </button>
                  <span aria-hidden className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums shadow-[0_1px_3px_rgb(0_0_0/0.3)]" style={accent}>
                    {cart.count}
                  </span>
                </span>
              )}
            </div>
          )}
        </DragSheet>
      )}

      {sheet === 'order' && cart?.summary && (
        <DragSheet tone="dark" contained label={copy.yourOrder} closeLabel={copy.back} onClose={closeSheet}
          header={<h3 className={`pb-1 ${ui.sheetTitle}`}>{copy.yourOrder}</h3>}>
          <ul className="mt-1">
            {cart.summary.items.map(item => (
              <li key={item.key} className="flex min-h-10 items-center gap-2.5 border-b border-white/[0.08] text-[15px]">
                <span className="min-w-[26px] font-bold tabular-nums text-white/75">{item.qty}×</span>
                <span className="flex min-w-0 flex-1 flex-col py-1.5">
                  <span className="truncate">{item.name}</span>
                  {item.qty > 1 && item.unit && <span className="text-xs tabular-nums text-white/55">{copy.each.replace('{price}', item.unit)}</span>}
                </span>
                <span className="tabular-nums">{item.line}</span>
              </li>
            ))}
          </ul>
          <div className={`mt-3 mb-3.5 flex items-baseline justify-between text-base ${ui.price}`}><span className={`${ui.label} text-white/65`}>{copy.total}</span><span>{cart.summary.total}</span></div>
          {cart.onOpenCart && (
            <button type="button" onClick={() => { closeSheet(); cart.onOpenCart?.() }} className={`${ui.cta} h-11 w-full`} style={sheetPrimary}>{copy.goToCart}</button>
          )}
          <button type="button" onClick={closeSheet} className={`${ui.ctaQuiet} mt-1 h-11 w-full text-white/80`}>{copy.keepBrowsing}</button>
        </DragSheet>
      )}
    </div>,
    document.body,
  )
}
