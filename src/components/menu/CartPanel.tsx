'use client'

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import Image from 'next/image'
import { X, Minus, Plus, Trash2, ShoppingBag, ArrowRight, UtensilsCrossed } from 'lucide-react'
import type { CartItem } from './menu-utils'
import { getProductImages, summarizeOptions, summarizeIngredientMods } from './menu-utils'
import { formatMoney, getMenuCopy, itemsLabel, fill } from './menu-i18n'
import { computePrimaryForeground } from '@/lib/color-utils'
import { lockBodyScroll } from '@/components/ui/ModalPortal'

/**
 * Order drawer that opens over the menu, above a dimmed backdrop — the page
 * underneath never reflows. Closes on backdrop click or Escape.
 * - Tablet/desktop (sm+): a curtain from the right, 400px / 380px wide.
 * - Mobile: a bottom sheet at ~72% height. Tapping it (anywhere but a button)
 *   or dragging the handle up opens it full screen; dragging down shrinks it,
 *   then closes it. Checkout stays pinned at the bottom either way.
 */
export default function CartPanel({
  cart, currency, lang, primaryColor, open,
  onClose, onCheckout, onEdit, onRemove, onUpdateQuantity,
}: {
  cart: CartItem[]
  currency: string
  lang: string
  primaryColor: string
  open: boolean
  onClose: () => void
  onCheckout: () => void
  onEdit: (cartKey: string) => void
  onRemove: (cartKey: string) => void
  onUpdateQuantity: (cartKey: string, quantity: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const dragStartY = useRef<number | null>(null)
  const dragged = useRef(false)
  const isExpanded = open && expanded

  function close() {
    setExpanded(false)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setExpanded(false)
      onClose()
    }
    window.addEventListener('keydown', onKey)
    // The page behind an overlay must not scroll under the customer's finger.
    // Shared, counted lock: checkout opening over the drawer keeps it locked.
    const unlock = lockBodyScroll()
    return () => {
      window.removeEventListener('keydown', onKey)
      unlock()
    }
  }, [open, onClose])

  const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches

  // Handle + header: a tap toggles full screen; a drag up expands, a drag down
  // shrinks (or closes when already at sheet height).
  function onGripPointerDown(e: PointerEvent) {
    if (!isMobile()) return
    dragStartY.current = e.clientY
    dragged.current = false
    // Keep receiving the release even when the finger/mouse ends outside the grip.
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onGripPointerUp(e: PointerEvent) {
    if (dragStartY.current === null) return
    const dy = e.clientY - dragStartY.current
    dragStartY.current = null
    if (Math.abs(dy) < 8) return // a tap, handled by onClick
    dragged.current = true
    if (dy < -40) setExpanded(true)
    else if (dy > 60) {
      if (isExpanded) setExpanded(false)
      else close()
    }
  }
  function onGripClick(e: MouseEvent) {
    if (!isMobile() || dragged.current) return
    if ((e.target as HTMLElement).closest('[data-close-cart]')) return
    setExpanded((v) => !v)
  }
  // Tapping the item list while it is a sheet opens it full screen, except on
  // the item controls (quantity, remove, edit), which keep working as usual.
  function onListClick(e: MouseEvent) {
    if (isExpanded || !isMobile()) return
    if ((e.target as HTMLElement).closest('button')) return
    setExpanded(true)
  }

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)
  const copy = getMenuCopy(lang)
  const money = (value: number) => formatMoney(value, currency, lang)
  const onPrimary = computePrimaryForeground(primaryColor)

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-[2px] transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={close}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden bg-menu shadow-float transition-[translate,height,border-radius] duration-300 ease-out sm:inset-x-auto sm:top-0 sm:right-0 sm:h-full sm:w-[400px] sm:rounded-none lg:w-[380px] ${isExpanded ? 'h-[100dvh] rounded-none' : 'h-[72dvh] rounded-t-3xl'} ${open ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'}`}
        aria-label={copy.yourOrder}
      >
        {/* Grip (mobile): drag handle + header */}
        <div
          className="bg-white border-b border-zinc-100 touch-none sm:touch-auto"
          onPointerDown={onGripPointerDown}
          onPointerUp={onGripPointerUp}
          onPointerCancel={() => { dragStartY.current = null }}
          onClick={onGripClick}
        >
          <div className={`sm:hidden flex justify-center ${isExpanded ? 'pt-[max(0.625rem,env(safe-area-inset-top))]' : 'pt-2.5'}`}>
            <button
              type="button"
              className="h-1.5 w-12 rounded-full bg-zinc-300"
              aria-label={isExpanded ? copy.shrinkCart : copy.expandCart}
            />
          </div>
          <div className="flex items-center justify-between px-5 pt-2 pb-3 sm:py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900">
              {copy.yourOrder}
              {count > 0 && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[13px] font-semibold text-zinc-600">{count}</span>
              )}
            </h2>
            <button
              type="button"
              data-close-cart
              onClick={close}
              className="flex size-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label={copy.closeCart}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-4" onClick={onListClick}>
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-zinc-100">
                <ShoppingBag className="size-6 text-zinc-400" />
              </div>
              <p className="text-[15px] font-medium text-zinc-500">{copy.cartEmpty}</p>
            </div>
          ) : (
            cart.map(item => {
              const img = getProductImages(item.product)[0]
              const optionsText = summarizeOptions(item.selectedOptions)
              const ingredientLabels = summarizeIngredientMods(item.ingredientModifications, copy)
              return (
                <div key={item.cartKey} className="rounded-2xl bg-white p-3 shadow-card">
                  <div className="flex gap-3">
                    <div className="size-[72px] flex-shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                      {img
                        ? <Image src={img} alt="" width={72} height={72} className="size-full object-cover" />
                        : <div className="flex size-full items-center justify-center"><UtensilsCrossed className="size-5 text-zinc-300" /></div>}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-zinc-900">{item.product.name}</p>
                        <button
                          type="button"
                          onClick={() => onRemove(item.cartKey)}
                          className="-mr-1 -mt-1 flex size-8 flex-shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={fill(copy.removeNamed, { name: item.product.name })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      {optionsText && <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-500">{optionsText}</p>}
                      {ingredientLabels.length > 0 && (
                        <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-500">{ingredientLabels.join(' · ')}</p>
                      )}
                      {item.note && <p className="mt-0.5 line-clamp-1 text-[13px] italic text-zinc-400">&ldquo;{item.note}&rdquo;</p>}

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex h-9 items-center rounded-full border border-zinc-200 bg-white px-0.5">
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                            className="flex size-8 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100"
                            aria-label={copy.decrease}
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="min-w-6 text-center text-[15px] font-semibold tabular-nums text-zinc-900">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                            className="flex size-8 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100"
                            aria-label={copy.increase}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{money(item.unitPrice * item.quantity)}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onEdit(item.cartKey)}
                        className="mt-1.5 text-[13px] font-medium text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-900 hover:underline"
                      >
                        {copy.edit}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer / checkout */}
        {cart.length > 0 && (
          <div className="space-y-3 border-t border-zinc-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-medium text-zinc-500">{copy.subtotal} · {itemsLabel(copy, count, lang)}</span>
              <span className="text-xl font-semibold tabular-nums text-zinc-900">{money(subtotal)}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              style={{ backgroundColor: primaryColor, color: onPrimary }}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-6 text-base font-semibold shadow-float transition-[opacity,scale] hover:opacity-95 active:scale-[0.98]"
            >
              {copy.checkout}
              <ArrowRight className="size-5" />
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
