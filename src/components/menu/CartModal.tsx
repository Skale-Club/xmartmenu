'use client'

import Image from 'next/image'
import { useState } from 'react'
import { X, ShoppingCart, User, Phone, ChevronLeft, ChevronRight, CheckCircle, UtensilsCrossed, Package, Truck, MapPin } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import type { UICopyEntry, CartItem } from './menu-utils'
import { getProductImages } from './menu-utils'

export default function CartModal({ cart, confirmedCart, currency, customerName, customerPhone, submittingOrder, orderSuccess, orderError, orderId, ui, accentColor, orderTypeConfig, orderType, deliveryAddress, tipsEnabled, tipPercentages, tipCents, onTipChange, onOrderTypeChange, onDeliveryAddressChange, onClose, onCustomerNameChange, onCustomerPhoneChange, onRemove, onUpdateQuantity, onSubmit }: {
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
  accentColor?: string
  orderTypeConfig?: { dineIn: boolean; pickup: boolean; delivery: boolean; deliveryFeeCents: number }
  orderType?: string
  deliveryAddress?: string
  tipsEnabled?: boolean
  tipPercentages?: [number, number, number]
  tipCents?: number
  onTipChange?: (cents: number) => void
  onOrderTypeChange?: (t: string) => void
  onDeliveryAddressChange?: (a: string) => void
  onClose: () => void
  onCustomerNameChange: (name: string) => void
  onCustomerPhoneChange: (phone: string) => void
  onRemove: (itemCartKey: string) => void
  onUpdateQuantity: (itemCartKey: string, quantity: number) => void
  onSubmit: () => void
}) {
  const [selectedTipKey, setSelectedTipKey] = useState<'pct1' | 'pct2' | 'pct3' | 'custom' | null>(null)
  const [customTipValue, setCustomTipValue] = useState('')

  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const confirmedTotal = confirmedCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const accent = accentColor ?? '#09090b'
  const tipDollars = (tipCents ?? 0) / 100
  const deliveryFeeCents = orderType === 'delivery' ? (orderTypeConfig?.deliveryFeeCents ?? 0) : 0
  const grandTotal = total + deliveryFeeCents / 100 + tipDollars

  function handleTipPct(key: 'pct1' | 'pct2' | 'pct3', pct: number) {
    if (selectedTipKey === key) {
      setSelectedTipKey(null)
      onTipChange?.(0)
      return
    }
    setSelectedTipKey(key)
    setCustomTipValue('')
    const subtotalCents = Math.round(total * 100)
    onTipChange?.(Math.round(subtotalCents * pct / 100))
  }

  function handleCustomTip() {
    if (selectedTipKey === 'custom') {
      setSelectedTipKey(null)
      setCustomTipValue('')
      onTipChange?.(0)
      return
    }
    setSelectedTipKey('custom')
    onTipChange?.(0)
  }

  function handleCustomTipInput(value: string) {
    setCustomTipValue(value)
    const dollars = parseFloat(value)
    onTipChange?.(isNaN(dollars) ? 0 : Math.max(0, Math.round(dollars * 100)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm px-0 sm:px-4" onClick={onClose}>
      <div
        className="relative bg-[#b0b8c8] w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[92vh] flex flex-col sm:flex-row shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* X button — top-right corner of the whole modal */}
        <button onClick={onClose} className="absolute top-4 right-4 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-white/60 hover:bg-white transition-all text-zinc-500 shadow-sm">
          <X className="w-4 h-4" />
        </button>

        {/* ── LEFT: Cart items ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="px-6 pt-6 pb-4">
            <h3 className="text-lg font-black text-zinc-800 tracking-tight flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Shopping Cart
            </h3>
          </div>

          {orderSuccess && orderId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h4 className="text-xl font-black text-zinc-900">{ui.orderPlaced}</h4>
              <p className="text-sm text-zinc-500">{ui.orderThankYou}</p>
              <p className="text-sm font-mono font-bold text-zinc-700 bg-white px-4 py-2 rounded-lg">
                {ui.orderNumber} #{orderId.slice(0, 8).toUpperCase()}
              </p>
              <div className="w-full border-t border-zinc-200 pt-4 space-y-2 text-left">
                {confirmedCart.map(item => (
                  <div key={item.cartKey} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-800">{item.product.name} × {item.quantity}</span>
                    <span className="text-sm font-bold">{formatPrice(item.unitPrice * item.quantity, currency)}</span>
                  </div>
                ))}
              </div>
              <div className="w-full flex items-center justify-between border-t border-zinc-300 pt-3">
                <span className="font-black text-zinc-900">Total</span>
                <span className="text-lg font-black text-zinc-900">{formatPrice(confirmedTotal, currency)}</span>
              </div>
              <button onClick={onClose} className="w-full py-3 rounded-xl text-sm font-black bg-zinc-900 text-white hover:bg-zinc-700 transition-all mt-2">
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Items list */}
              <div className="flex-1 overflow-y-auto px-6 space-y-3 pb-4">
                {cart.length === 0 ? (
                  <p className="text-center text-zinc-400 py-12 text-sm font-medium">Your cart is empty</p>
                ) : (
                  cart.map(item => {
                    const img = getProductImages(item.product)[0]
                    return (
                      <div key={item.cartKey} className="flex items-center gap-4 bg-white/60 rounded-xl px-4 py-3">
                        {/* Circular image */}
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-100 flex-shrink-0 shadow-sm">
                          {img
                            ? <Image src={img} alt={item.product.name} width={48} height={48} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-lg">🍽️</div>}
                        </div>

                        {/* Name + options */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-zinc-900 truncate">{item.product.name}</p>
                          {Object.keys(item.selectedOptions).length > 0 && (
                            <p className="text-[10px] text-zinc-400 truncate">
                              {Object.entries(item.selectedOptions).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}
                            </p>
                          )}
                        </div>

                        {/* Quantity controls */}
                        <div className="flex items-center rounded-full border border-zinc-200 bg-white shadow-sm overflow-hidden flex-shrink-0">
                          <button
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity - 1)}
                            className="px-2.5 py-1.5 hover:bg-zinc-100 transition-all"
                          >
                            <ChevronLeft className="w-3.5 h-3.5 text-zinc-500" />
                          </button>
                          <span className="text-sm font-black min-w-[1.25rem] text-center text-zinc-900 px-1">{item.quantity}</span>
                          <button
                            onClick={() => onUpdateQuantity(item.cartKey, item.quantity + 1)}
                            className="px-2.5 py-1.5 hover:bg-zinc-100 transition-all"
                          >
                            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                          </button>
                        </div>

                        {/* Price */}
                        <span className="text-sm font-black text-zinc-800 w-16 text-right flex-shrink-0">
                          {formatPrice(item.unitPrice * item.quantity, currency)}
                        </span>

                        {/* Remove */}
                        <button onClick={() => onRemove(item.cartKey)} className="text-zinc-300 hover:text-red-400 transition-colors flex-shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Subtotal */}
              {cart.length > 0 && (
                <div className="px-6 pb-6 flex items-center justify-end gap-2">
                  <span className="text-sm font-bold text-zinc-500">Subtotal</span>
                  <span className="text-2xl font-black text-zinc-900">{formatPrice(total, currency)}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT: Order details ── */}
        {!orderSuccess && cart.length > 0 && (
          <div className="sm:w-64 bg-zinc-800 flex flex-col rounded-b-2xl sm:rounded-r-2xl sm:rounded-bl-none p-6 gap-5">
            <h3 className="text-sm font-black text-zinc-300 uppercase tracking-widest pt-6 sm:pt-0">Order Details</h3>

            {/* Order type selector — shown only when 2+ types active */}
            {orderTypeConfig && (() => {
              const activeTypes: { key: string; label: string; Icon: React.ElementType }[] = []
              if (orderTypeConfig.dineIn)   activeTypes.push({ key: 'dine_in',  label: 'Dine-In',  Icon: UtensilsCrossed })
              if (orderTypeConfig.pickup)   activeTypes.push({ key: 'pickup',   label: 'Pick-Up',  Icon: Package })
              if (orderTypeConfig.delivery) activeTypes.push({ key: 'delivery', label: 'Delivery', Icon: Truck })
              if (activeTypes.length < 2) return null
              return (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Order Type</p>
                  <div className="flex gap-2 flex-wrap">
                    {activeTypes.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onOrderTypeChange?.(key)}
                        className={orderType === key
                          ? "px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest bg-[#e8eaf0] text-zinc-900 border border-[#e8eaf0] cursor-pointer flex items-center gap-1.5"
                          : "px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest border border-zinc-600 text-zinc-400 bg-transparent hover:border-zinc-400 transition-all cursor-pointer flex items-center gap-1.5"
                        }
                      >
                        <Icon className="w-3 h-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Delivery address — shown only when delivery selected */}
            {orderType === 'delivery' && (
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={deliveryAddress ?? ''}
                  onChange={e => onDeliveryAddressChange?.(e.target.value)}
                  placeholder="Street address, city..."
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-white/10 text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all border border-zinc-700"
                />
              </div>
            )}

            {/* Tip selector */}
            {tipsEnabled && tipPercentages && (
              <div className="space-y-2">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Add a Tip</p>
                <div className="flex gap-1.5 flex-wrap">
                  {(['pct1', 'pct2', 'pct3'] as const).map((key, i) => {
                    const pct = tipPercentages[i]
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleTipPct(key, pct)}
                        className={selectedTipKey === key
                          ? "px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-[#e8eaf0] text-zinc-900 border border-[#e8eaf0] cursor-pointer"
                          : "px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border border-zinc-600 text-zinc-400 bg-transparent hover:border-zinc-400 transition-all cursor-pointer"
                        }
                      >
                        {pct}%
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={handleCustomTip}
                    className={selectedTipKey === 'custom'
                      ? "px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-[#e8eaf0] text-zinc-900 border border-[#e8eaf0] cursor-pointer"
                      : "px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border border-zinc-600 text-zinc-400 bg-transparent hover:border-zinc-400 transition-all cursor-pointer"
                    }
                  >
                    Custom
                  </button>
                </div>
                {selectedTipKey === 'custom' && (
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Enter tip amount"
                    value={customTipValue}
                    onChange={e => handleCustomTipInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/10 text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all border border-zinc-700"
                  />
                )}
              </div>
            )}

            {/* Visual order summary card — now light */}
            <div className="bg-[#e8eaf0] rounded-xl p-4 shadow-lg">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Your order</p>
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {cart.map(item => (
                  <div key={item.cartKey} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-600 truncate flex-1">{item.product.name} ×{item.quantity}</span>
                    <span className="text-xs font-bold text-zinc-900 flex-shrink-0">{formatPrice(item.unitPrice * item.quantity, currency)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-zinc-300 mt-3 pt-2 space-y-1">
                {(deliveryFeeCents > 0 || tipDollars > 0) && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Subtotal</span>
                    <span className="text-xs font-bold text-zinc-700">{formatPrice(total, currency)}</span>
                  </div>
                )}
                {deliveryFeeCents > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Delivery fee</span>
                    <span className="text-xs font-bold text-zinc-700">{formatPrice(deliveryFeeCents / 100, currency)}</span>
                  </div>
                )}
                {tipDollars > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Tip</span>
                    <span className="text-xs font-bold text-zinc-700">{formatPrice(tipDollars, currency)}</span>
                  </div>
                )}
                <div className="border-t border-zinc-300 pt-2 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Total</span>
                  <span className="text-base font-black" style={{ color: accent }}>{formatPrice(grandTotal, currency)}</span>
                </div>
              </div>
            </div>

            {/* Customer fields */}
            <div className="space-y-3">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={customerName}
                  onChange={e => onCustomerNameChange(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-white/10 text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all border border-zinc-700"
                />
              </div>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={e => onCustomerPhoneChange(e.target.value)}
                  placeholder="Phone number"
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-white/10 text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all border border-zinc-700"
                />
              </div>
            </div>

            {orderError && (
              <p className="text-xs text-red-400 bg-red-900/30 rounded-lg px-3 py-2">{orderError}</p>
            )}

            <button
              onClick={onSubmit}
              disabled={submittingOrder}
              className="mt-auto w-full py-3.5 rounded-xl text-sm font-black text-zinc-900 bg-[#e8eaf0] hover:bg-white transition-all active:scale-95 disabled:opacity-50 shadow-lg"
            >
              {submittingOrder ? 'Placing order...' : 'Check Out'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
