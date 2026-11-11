'use client'

import { useEffect, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { X, Minus, Plus, Trash2, ShoppingBag, ArrowRight, UtensilsCrossed } from 'lucide-react'
import type { CartItem } from './menu-utils'
import { getProductImages, summarizeOptions, summarizeIngredientMods } from './menu-utils'
import { formatMoney, getMenuCopy, itemsLabel, fill } from './menu-i18n'
import { computePrimaryForeground } from '@/lib/color-utils'
import BottomSheet from '@/components/ui/BottomSheet'
import { lockBodyScroll } from '@/components/ui/ModalPortal'

// Tablets and computers (sm, 640px and up) keep the order in a drawer on the right.
const WIDE = '(min-width: 640px)'
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * The order, over the dimmed menu; Escape or a tap on the menu closes it, and
 * checkout stays pinned at the bottom.
 * - Phones: the iOS-style bottom sheet (BottomSheet). It opens at about 60%
 *   height; the grabber or the header dragged up (or the grabber tapped) takes
 *   it to nearly full height, dragged down shrinks it and then closes it.
 * - Tablets and computers (sm+): a drawer on the right, 400px / 380px wide.
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
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)
  const copy = getMenuCopy(lang)
  const money = (value: number) => formatMoney(value, currency, lang)
  const onPrimary = computePrimaryForeground(primaryColor)
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false)

  // The drawer's own Escape and scroll lock (the bottom sheet gets both from ModalPortal).
  useEffect(() => {
    if (!wide || !open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const unlock = lockBodyScroll()
    return () => {
      window.removeEventListener('keydown', onKey)
      unlock()
    }
  }, [wide, open, onClose])

  const content = (
      <>
        {/* Header: on phones it drags the sheet like the grabber */}
        <div data-sheet-grip={wide ? undefined : true} className={`flex shrink-0 items-center justify-between border-b border-zinc-100 bg-white px-5 ${wide ? 'py-4' : 'touch-none pt-0.5 pb-3'}`}>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900">
            {copy.yourOrder}
            {count > 0 && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[13px] font-semibold text-zinc-600">{count}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="relative flex size-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-zinc-200 hover:text-zinc-900"
            aria-label={copy.closeCart}
          >
            <X className="size-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Items */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-4">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-zinc-100">
                <ShoppingBag className="size-6 text-zinc-400" />
              </div>
              <p className="text-[15px] font-medium text-zinc-600">{copy.cartEmpty}</p>
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
                          className="relative -mr-1 -mt-1 flex size-8 flex-shrink-0 before:absolute before:-inset-1.5 before:content-[''] items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={fill(copy.removeNamed, { name: item.product.name })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      {optionsText && <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-600">{optionsText}</p>}
                      {ingredientLabels.length > 0 && (
                        <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-600">{ingredientLabels.join(' · ')}</p>
                      )}
                      {item.note && <p className="mt-0.5 line-clamp-1 text-[13px] italic text-zinc-500">&ldquo;{item.note}&rdquo;</p>}

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex h-9 items-center rounded-full border border-zinc-200 bg-white px-0.5">
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                            className="relative flex size-8 items-center justify-center rounded-full text-zinc-700 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-zinc-100"
                            aria-label={copy.decrease}
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="min-w-6 text-center text-[15px] font-semibold tabular-nums text-zinc-900">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                            className="relative flex size-8 items-center justify-center rounded-full text-zinc-700 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-zinc-100"
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
                        className="mt-1.5 py-1 text-[14px] font-medium text-zinc-700 underline-offset-2 transition-colors hover:text-zinc-900 hover:underline"
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
              <span className="text-[15px] font-medium text-zinc-600">{copy.subtotal} · {itemsLabel(copy, count, lang)}</span>
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
      </>
  )

  if (!wide) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        detents="medium-large"
        ariaLabel={copy.yourOrder}
        zIndexClassName="z-50"
        expandLabel={copy.expandCart}
        shrinkLabel={copy.shrinkCart}
      >
        {content}
      </BottomSheet>
    )
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-[2px] transition-opacity duration-300 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-[400px] flex-col overflow-hidden bg-menu shadow-float transition-transform duration-300 ease-out lg:w-[380px] ${open ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
        aria-label={copy.yourOrder}
        aria-hidden={!open}
        inert={!open}
      >
        {content}
      </aside>
    </>
  )
}
