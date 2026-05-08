'use client'

import { formatPrice } from '@/lib/utils'
import type { UICopyEntry, CartItem } from './menu-utils'

export default function CartModal({ cart, confirmedCart, currency, customerName, customerPhone, submittingOrder, orderSuccess, orderError, orderId, ui, onClose, onCustomerNameChange, onCustomerPhoneChange, onRemove, onUpdateQuantity, onSubmit }: {
  cart: CartItem[]
  confirmedCart: CartItem[]
  currency: string
  customerName: string
  customerPhone: string
  submittingOrder: boolean
  orderSuccess: boolean
  orderError: string | null
  orderId: string | null
  ui: UICopyEntry
  onClose: () => void
  onCustomerNameChange: (name: string) => void
  onCustomerPhoneChange: (phone: string) => void
  onRemove: (itemCartKey: string) => void
  onUpdateQuantity: (itemCartKey: string, quantity: number) => void
  onSubmit: () => void
}) {
  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const confirmedTotal = confirmedCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md lg:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 sm:p-6 border-b border-zinc-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900">Your order</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
        </div>
        {orderSuccess && orderId ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl mb-3">&#10003;</div>
                <h4 className="text-xl font-bold text-zinc-900">{ui.orderPlaced}</h4>
                <p className="text-sm text-zinc-500 mt-1">{ui.orderThankYou}</p>
                <p className="text-sm font-mono font-semibold text-zinc-700 mt-2">
                  {ui.orderNumber} #{orderId.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div className="border-t border-zinc-100 pt-4 space-y-2">
                {confirmedCart.map(item => (
                  <div key={item.cartKey} className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900">{item.product.name} x {item.quantity}</p>
                      {Object.keys(item.selectedOptions).length > 0 && (
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {Object.entries(item.selectedOptions)
                            .filter(([, v]) => v)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(', ')}
                        </p>
                      )}
                    </div>
                    <p className="text-sm font-semibold shrink-0">{formatPrice(item.unitPrice * item.quantity, currency)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-zinc-200 pt-3 flex items-center justify-between">
                <span className="font-semibold text-zinc-900">Total</span>
                <span className="text-lg font-bold text-zinc-900">{formatPrice(confirmedTotal, currency)}</span>
              </div>
            </div>
            <div className="p-5 sm:p-6 border-t border-zinc-200 bg-zinc-50">
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              {cart.length === 0 ? (
                <p className="text-center text-zinc-400 py-8">Your cart is empty</p>
              ) : (
                <>
                  {cart.map(item => (
                    <div key={item.cartKey} className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-zinc-900 truncate">{item.product.name}</p>
                        {Object.keys(item.selectedOptions).length > 0 && (
                          <p className="text-xs text-zinc-500 mt-0.5 truncate">
                            {Object.entries(item.selectedOptions)
                              .filter(([, v]) => v)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')}
                          </p>
                        )}
                        <p className="text-sm text-zinc-500">{formatPrice(item.unitPrice, currency)} each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                          className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600"
                        >
                          -
                        </button>
                        <span className="w-8 text-center font-medium">{item.quantity}</span>
                        <button
                          onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                          className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600"
                        >
                          +
                        </button>
                      </div>
                      <p className="w-20 text-right font-semibold">{formatPrice(item.unitPrice * item.quantity, currency)}</p>
                      <button
                        onClick={() => onRemove(item.cartKey)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}

              {cart.length > 0 && (
                <div className="pt-4 border-t border-zinc-200 space-y-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customerName}
                      onChange={e => onCustomerNameChange(e.target.value)}
                      placeholder="Your name"
                      className="flex-1 px-4 py-2.5 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={e => onCustomerPhoneChange(e.target.value)}
                      placeholder="Your phone number"
                      className="flex-1 px-4 py-2.5 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    />
                  </div>

                  {orderError && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{orderError}</p>
                  )}
                </div>
              )}
            </div>
            {cart.length > 0 && (
              <div className="p-5 sm:p-6 border-t border-zinc-200 bg-zinc-50">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-semibold text-zinc-900">Total</span>
                  <span className="text-xl font-bold text-zinc-900">{formatPrice(total, currency)}</span>
                </div>
                <button
                  onClick={onSubmit}
                  disabled={submittingOrder}
                  className="w-full py-3 rounded-xl text-sm font-semibold transition-colors bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {submittingOrder ? 'Submitting...' : 'Confirm order'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
