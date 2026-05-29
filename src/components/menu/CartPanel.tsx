'use client'

import Image from 'next/image'
import { X, Minus, Plus, Pencil, Trash2, ShoppingBag } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import type { CartItem } from './menu-utils'
import { getProductImages, summarizeOptions, summarizeIngredientMods } from './menu-utils'

/**
 * Persistent right-side order panel.
 * - Desktop/tablet (lg+): a fixed 380px column; the page content is padded right
 *   by MenuPage so this panel sits beside the menu instead of overlaying it.
 * - Mobile: a full-width drawer that slides in from the right over a backdrop.
 */
export default function CartPanel({
  cart, currency, primaryColor, accentColor, open,
  onClose, onCheckout, onEdit, onRemove, onUpdateQuantity,
}: {
  cart: CartItem[]
  currency: string
  primaryColor: string
  accentColor: string
  open: boolean
  onClose: () => void
  onCheckout: () => void
  onEdit: (cartKey: string) => void
  onRemove: (cartKey: string) => void
  onUpdateQuantity: (cartKey: string, quantity: number) => void
}) {
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <>
      {/* Mobile backdrop — desktop keeps content visible beside the panel */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] lg:w-[380px] bg-[#f4f5f8] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-label="Order panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-white">
          <h3 className="text-base font-black text-zinc-900 tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            Your order
            {count > 0 && (
              <span className="text-[11px] font-black text-white rounded-full px-2 py-0.5" style={{ backgroundColor: primaryColor }}>
                {count}
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 transition-all text-zinc-500"
            aria-label="Close cart"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <div className="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center">
                <ShoppingBag className="w-7 h-7 text-zinc-300" />
              </div>
              <p className="text-sm font-bold text-zinc-400">Your cart is empty</p>
            </div>
          ) : (
            cart.map(item => {
              const img = getProductImages(item.product)[0]
              const optionsText = summarizeOptions(item.selectedOptions)
              const ingredientLabels = summarizeIngredientMods(item.ingredientModifications)
              return (
                <div key={item.cartKey} className="bg-white rounded-2xl p-3 shadow-sm">
                  <div className="flex gap-3">
                    {/* Product photo */}
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-zinc-100 flex-shrink-0">
                      {img
                        ? <Image src={img} alt={item.product.name} width={80} height={80} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-black text-zinc-900 leading-tight line-clamp-2">{item.product.name}</p>
                        <button
                          onClick={() => onRemove(item.cartKey)}
                          className="text-zinc-300 hover:text-red-500 transition-colors flex-shrink-0"
                          aria-label={`Remove ${item.product.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {optionsText && (
                        <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">{optionsText}</p>
                      )}
                      {ingredientLabels.length > 0 && (
                        <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">{ingredientLabels.join(' · ')}</p>
                      )}
                      {item.note && (
                        <p className="text-[11px] italic text-zinc-400 line-clamp-1 mt-0.5">“{item.note}”</p>
                      )}

                      <div className="flex items-center justify-between gap-2 mt-2">
                        {/* − qty + stepper */}
                        <div className="flex items-center rounded-full border border-zinc-200 bg-white overflow-hidden">
                          <button
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-zinc-100 transition-all"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5 text-zinc-600" />
                          </button>
                          <span className="text-sm font-black min-w-[1.5rem] text-center text-zinc-900">{item.quantity}</span>
                          <button
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-zinc-100 transition-all"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5 text-zinc-600" />
                          </button>
                        </div>

                        <span className="text-sm font-black text-zinc-900">
                          {formatPrice(item.unitPrice * item.quantity, currency)}
                        </span>
                      </div>

                      {/* Edit */}
                      <button
                        onClick={() => onEdit(item.cartKey)}
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-900 transition-colors"
                      >
                        <Pencil className="w-3 h-3" /> Edit
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
          <div className="border-t border-zinc-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-500">Subtotal</span>
              <span className="text-2xl font-black" style={{ color: accentColor }}>{formatPrice(subtotal, currency)}</span>
            </div>
            <button
              onClick={onCheckout}
              style={{ backgroundColor: primaryColor }}
              className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-widest text-white hover:opacity-90 active:scale-95 transition-all shadow-lg"
            >
              Checkout
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
