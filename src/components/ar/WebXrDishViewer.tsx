'use client'

/**
 * What the guest sees over the camera on Android (the WebXR DOM overlay):
 *
 *   scanning  "Point at the table and move your phone slowly" (no dish yet)
 *   surface   "Tap to place the dish" (a ring and a see-through dish on the table)
 *   placed    a hint for the gestures (4 s, again with "?"), the size chip
 *             ("Real size" / "130 %" + a button back to real size) and the
 *             order bar: dish, price and "Add to order" / "Choose options"
 *
 * The scene itself (camera, surface, dish, gestures) is
 * src/lib/ar/webxr-dish-session.ts; it receives the overlay root and the
 * gesture layer from here. Mounted in <body> by ArButton, hidden until a
 * session starts.
 */

import { useEffect, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Maximize2, Plus, ShoppingBag, Smartphone, X } from 'lucide-react'
import type { DishStage } from '@/lib/ar/webxr-dish-session'
import { scalePercent } from '@/lib/ar/gestures'
import type { ArCopy } from './ar-copy'

/** Ordering from the camera; absent on a browse-only menu. */
export interface ArCart {
  /** 'add': one more of this dish now. 'choose': the dish needs a choice first (leaves the camera). */
  mode: 'add' | 'choose'
  /** "R$ 34,00", shown on the button. */
  priceLabel?: string
  onAdd: () => void
  onChoose: () => void
  /** Items in the order, for the confirmation. */
  count: number
}

export interface WebXrDishViewerProps {
  active: boolean
  stage: DishStage
  scale: number
  name: string
  copy: ArCopy
  cart?: ArCart | null
  overlayRef: Ref<HTMLDivElement>
  gestureLayerRef: Ref<HTMLDivElement>
  onExit: () => void
  onResetScale: () => void
  onChoose: () => void
}

const HINT_MS = 4500

export default function WebXrDishViewer({ active, stage, scale, name, copy, cart, overlayRef, gestureLayerRef, onExit, onResetScale, onChoose }: WebXrDishViewerProps) {
  const [hint, setHint] = useState(false)
  const [toast, setToast] = useState(false)

  // The gesture hint shows once the dish is placed, and again from "?".
  useEffect(() => {
    if (stage !== 'placed' || !active) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shown when the dish lands
    setHint(true)
  }, [stage, active])
  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(false), HINT_MS)
    return () => window.clearTimeout(timer)
  }, [hint])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(false), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (typeof document === 'undefined') return null

  const percent = scalePercent(scale)
  const realSize = percent === 100
  const pill = 'pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/55 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-md'

  return createPortal(
    <div
      ref={overlayRef}
      className="menu-root fixed inset-0 z-[90] select-none"
      style={{ display: active ? 'block' : 'none', touchAction: 'none' }}
      aria-hidden={!active}
    >
      {/* Receives drag / twist / pinch / tap-to-place (webxr-dish-session.ts). */}
      <div ref={gestureLayerRef} className="absolute inset-0" style={{ touchAction: 'none' }} />

      {/* Top: close, size chip, help */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onExit} aria-label={copy.close} className={`${pill} size-11 justify-center px-0`}>
          <X className="size-5" />
        </button>
        {stage === 'placed' && (
          realSize ? (
            <span className={`${pill} pointer-events-none`}><Maximize2 className="size-4" aria-hidden />{copy.realSize}</span>
          ) : (
            <span className="pointer-events-auto flex items-center gap-2">
              <span className={`${pill} pointer-events-none tabular-nums`}>{percent}%</span>
              <button type="button" onClick={onResetScale} className={`${pill} bg-white/90 text-zinc-900`}>
                <Maximize2 className="size-4" aria-hidden />{copy.realSize}
              </button>
            </span>
          )
        )}
        {stage === 'placed' ? (
          <button type="button" onClick={() => setHint(true)} aria-label={copy.help} className={`${pill} size-11 justify-center px-0`}>
            <HelpCircle className="size-5" />
          </button>
        ) : <span className="size-11" />}
      </div>

      {/* Middle: coaching, then the gesture hint */}
      {stage !== 'placed' && (
        <div className="pointer-events-none absolute inset-x-6 top-[38%] flex flex-col items-center gap-3 text-center">
          {stage === 'scanning' && (
            <Smartphone className="size-10 text-white drop-shadow-lg motion-safe:animate-[ar-scan_2.4s_ease-in-out_infinite]" aria-hidden />
          )}
          <p className="rounded-2xl bg-black/55 px-4 py-2.5 text-[15px] font-semibold text-white backdrop-blur-md">
            {stage === 'scanning' ? copy.scanning : copy.tapToPlace}
          </p>
        </div>
      )}
      {stage === 'placed' && hint && (
        <div className="pointer-events-none absolute inset-x-6 top-[22%] flex justify-center text-center">
          <p className="rounded-2xl bg-black/60 px-4 py-3 text-[15px] font-semibold leading-snug text-white backdrop-blur-md">{copy.gestures}</p>
        </div>
      )}

      {/* Bottom: the order bar */}
      {cart && stage === 'placed' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {toast && (
            <p role="status" className="mx-auto mb-3 w-fit rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md">
              {copy.added.replace('{count}', String(cart.count))}
            </p>
          )}
          <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-3xl bg-black/60 p-2 pl-4 backdrop-blur-md">
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{name}</p>
            <button
              type="button"
              onClick={() => {
                if (cart.mode === 'choose') { onChoose(); return }
                cart.onAdd()
                setToast(true)
              }}
              className="flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-white px-4 text-[15px] font-semibold text-zinc-900 active:scale-[0.98]"
            >
              {cart.mode === 'choose' ? <ShoppingBag className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {cart.mode === 'choose' ? copy.chooseOptions : copy.addToOrder}
              {cart.mode === 'add' && cart.priceLabel ? <span className="tabular-nums text-zinc-500">· {cart.priceLabel}</span> : null}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
