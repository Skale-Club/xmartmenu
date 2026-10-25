'use client'

import Image from 'next/image'
import { useId, useState, type ReactNode } from 'react'
import { X, ChevronLeft, Check, UtensilsCrossed, Package, Truck, MapPin } from 'lucide-react'
import type { CartItem } from './menu-utils'
import { getProductImages, summarizeOptions, summarizeIngredientMods } from './menu-utils'
import { formatMoney, getMenuCopy } from './menu-i18n'
import type { DeliveryZone } from '@/types/database'
import { computePrimaryForeground } from '@/lib/color-utils'
import ModalPortal from '@/components/ui/ModalPortal'

function findMatchingZone(zipcode: string | undefined, zones: DeliveryZone[] | undefined): DeliveryZone | null {
  if (!zipcode || !zones || zones.length === 0) return null
  const clean = zipcode.trim().replace(/\D/g, '')
  if (!clean) return null
  return zones.find(z => z.is_active && z.zipcode_prefixes.some(p => clean.startsWith(p))) ?? null
}

/**
 * Checkout: one calm column — what you're ordering, how you want it, your
 * details, the totals — with "Place order · total" pinned at the bottom.
 * Phones: a sheet from the bottom. Larger screens: centred. Item editing
 * happens in CartPanel.
 */
export default function CheckoutModal({ cart, confirmedCart, currency, lang, customerName, customerPhone, submittingOrder, orderSuccess, orderError, orderId, primaryColor, orderTypeConfig, tableName = null, orderType, deliveryStreet, deliveryComplement, deliveryZipcode, deliveryCity, deliveryNotes, deliveryZones, tipsEnabled, tipPercentages, tipCents, onTipChange, onOrderTypeChange, onDeliveryFieldChange, onClose, onBack, onCustomerNameChange, onCustomerPhoneChange, onSubmit }: {
  cart: CartItem[]
  confirmedCart: CartItem[]
  currency: string
  lang: string
  customerName: string
  customerPhone: string
  submittingOrder: boolean
  orderSuccess: boolean
  orderError: string | null
  orderId: string | null
  primaryColor?: string
  orderTypeConfig?: { dineIn: boolean; pickup: boolean; delivery: boolean; deliveryFeeCents: number }
  /** Ordering from a table link: the order goes to this table. */
  tableName?: string | null
  orderType?: string
  deliveryStreet?: string
  deliveryComplement?: string
  deliveryZipcode?: string
  deliveryCity?: string
  deliveryNotes?: string
  deliveryZones?: DeliveryZone[]
  tipsEnabled?: boolean
  tipPercentages?: [number, number, number]
  tipCents?: number
  onTipChange?: (cents: number) => void
  onOrderTypeChange?: (t: string) => void
  onDeliveryFieldChange?: (field: 'street' | 'complement' | 'zipcode' | 'city' | 'notes', value: string) => void
  onClose: () => void
  onBack: () => void
  onCustomerNameChange: (name: string) => void
  onCustomerPhoneChange: (phone: string) => void
  onSubmit: () => void
}) {
  const [selectedTipKey, setSelectedTipKey] = useState<'pct1' | 'pct2' | 'pct3' | 'custom' | null>(null)
  const [customTipValue, setCustomTipValue] = useState('')
  const copy = getMenuCopy(lang)
  const money = (value: number) => formatMoney(value, currency, lang)
  const primary = primaryColor ?? '#18181b'
  const onPrimary = computePrimaryForeground(primary)

  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const confirmedTotal = confirmedCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const tipAmount = (tipCents ?? 0) / 100
  const matchedZone = findMatchingZone(deliveryZipcode, deliveryZones)
  const deliveryFeeCents = orderType === 'delivery'
    ? (matchedZone != null ? matchedZone.fee_cents : (orderTypeConfig?.deliveryFeeCents ?? 0))
    : 0
  const grandTotal = total + deliveryFeeCents / 100 + tipAmount

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
    const amount = parseFloat(value)
    onTipChange?.(isNaN(amount) ? 0 : Math.max(0, Math.round(amount * 100)))
  }

  const activeTypes: { key: string; label: string; Icon: typeof Truck }[] = []
  if (orderTypeConfig?.dineIn) activeTypes.push({ key: 'dine_in', label: copy.dineIn, Icon: UtensilsCrossed })
  if (orderTypeConfig?.pickup) activeTypes.push({ key: 'pickup', label: copy.pickup, Icon: Package })
  if (orderTypeConfig?.delivery) activeTypes.push({ key: 'delivery', label: copy.delivery, Icon: Truck })

  const showForm = !orderSuccess && cart.length > 0

  return (
    <ModalPortal onClose={onClose}>
      <div className="menu-root fixed inset-0 z-[60] flex items-end justify-center bg-zinc-950/40 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={copy.checkoutTitle}
          className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-menu shadow-float sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:rounded-3xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-100 bg-white px-2 py-2">
            {!orderSuccess ? (
              <button type="button" onClick={onBack} className="flex size-11 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-100" aria-label={copy.backToCart}>
                <ChevronLeft className="size-5" />
              </button>
            ) : <span className="size-11" />}
            <h2 className="flex-1 text-center text-[17px] font-semibold text-zinc-900">{orderSuccess ? copy.orderPlaced : copy.checkoutTitle}</h2>
            <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900" aria-label={copy.close}>
              <X className="size-5" />
            </button>
          </div>

          {orderSuccess && orderId ? (
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <div className="flex flex-col items-center text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50">
                  <Check className="size-8 text-emerald-600" strokeWidth={2.5} />
                </div>
                <p className="mt-4 text-[22px] font-semibold tracking-tight text-zinc-900">{copy.orderPlaced}</p>
                <p className="mt-1 max-w-xs text-[15px] text-zinc-500">{copy.orderThankYou}</p>
                <p className="mt-4 rounded-full bg-white px-4 py-2 font-mono text-sm font-semibold text-zinc-700 shadow-card">
                  {copy.orderNumber} #{orderId.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <Card className="mt-6">
                <div className="divide-y divide-zinc-100">
                  {confirmedCart.map(item => (
                    <div key={item.cartKey} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-[15px] text-zinc-800">{item.quantity}× {item.product.name}</span>
                      <span className="text-[15px] font-medium tabular-nums text-zinc-900">{money(item.unitPrice * item.quantity)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[15px] font-semibold text-zinc-900">{copy.total}</span>
                    <span className="text-[17px] font-semibold tabular-nums text-zinc-900">{money(confirmedTotal)}</span>
                  </div>
                </div>
              </Card>
              <button type="button" onClick={onClose} className="mt-6 h-12 w-full rounded-2xl bg-zinc-900 text-[15px] font-semibold text-white transition-opacity hover:opacity-90">
                {copy.close}
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
                {/* What you're ordering */}
                <Card>
                  <div className="divide-y divide-zinc-100">
                    {cart.map(item => {
                      const img = getProductImages(item.product)[0]
                      const optionsText = summarizeOptions(item.selectedOptions)
                      const ingredientLabels = summarizeIngredientMods(item.ingredientModifications, copy)
                      const details = [optionsText, ingredientLabels.join(' · ')].filter(Boolean).join(' · ')
                      return (
                        <div key={item.cartKey} className="flex gap-3 px-4 py-3">
                          <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                            {img
                              ? <Image src={img} alt="" width={48} height={48} className="size-full object-cover" />
                              : <div className="flex size-full items-center justify-center"><UtensilsCrossed className="size-4 text-zinc-300" /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-[15px] font-medium leading-snug text-zinc-900">
                                <span className="text-zinc-500">{item.quantity}×</span> {item.product.name}
                              </p>
                              <span className="shrink-0 text-[15px] font-medium tabular-nums text-zinc-900">{money(item.unitPrice * item.quantity)}</span>
                            </div>
                            {details && <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-500">{details}</p>}
                            {item.note && <p className="mt-0.5 line-clamp-1 text-[13px] italic text-zinc-400">&ldquo;{item.note}&rdquo;</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                {showForm && tableName && (
                  <Card title={copy.yourTable}>
                    <div className="flex items-center gap-3 px-4 pb-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700"><UtensilsCrossed className="size-5" /></span>
                      <span className="min-w-0">
                        <span className="block text-[17px] font-semibold text-zinc-900">{tableName}</span>
                        <span className="block text-[13px] text-zinc-500">{copy.tableServed}</span>
                      </span>
                    </div>
                  </Card>
                )}

                {showForm && !tableName && activeTypes.length >= 2 && (
                  <Card title={copy.orderType}>
                    <div className="px-4 pb-4">
                      <div className="grid gap-1 rounded-xl bg-zinc-100 p-1" style={{ gridTemplateColumns: `repeat(${activeTypes.length}, minmax(0, 1fr))` }}>
                        {activeTypes.map(({ key, label, Icon }) => {
                          const active = orderType === key
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={active}
                              onClick={() => onOrderTypeChange?.(key)}
                              className={`flex h-11 items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
                            >
                              <Icon className="size-4" />
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </Card>
                )}

                {showForm && orderType === 'delivery' && (
                  <Card title={copy.deliveryAddress}>
                    <div className="space-y-3 px-4 pb-4">
                      <Field label={copy.street} value={deliveryStreet ?? ''} onChange={v => onDeliveryFieldChange?.('street', v)} autoComplete="address-line1" required />
                      <Field label={copy.complement} value={deliveryComplement ?? ''} onChange={v => onDeliveryFieldChange?.('complement', v)} autoComplete="address-line2" />
                      <div className="grid grid-cols-[2fr_3fr] gap-3">
                        <Field label={copy.zipcode} value={deliveryZipcode ?? ''} onChange={v => onDeliveryFieldChange?.('zipcode', v)} autoComplete="postal-code" inputMode="numeric" />
                        <Field label={copy.city} value={deliveryCity ?? ''} onChange={v => onDeliveryFieldChange?.('city', v)} autoComplete="address-level2" />
                      </div>
                      <Field label={copy.deliveryNotes} value={deliveryNotes ?? ''} onChange={v => onDeliveryFieldChange?.('notes', v)} />
                      {deliveryZones && deliveryZones.length > 0 && deliveryZipcode && (
                        matchedZone ? (
                          <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                            <MapPin className="size-3.5" />
                            {matchedZone.name} · {money(matchedZone.fee_cents / 100)}
                          </p>
                        ) : (
                          <p className="text-[13px] font-medium text-amber-700">{copy.noDeliveryZone}</p>
                        )
                      )}
                    </div>
                  </Card>
                )}

                {showForm && tipsEnabled && tipPercentages && (
                  <Card title={copy.tip}>
                    <div className="space-y-3 px-4 pb-4">
                      <div className="grid grid-cols-4 gap-2">
                        {(['pct1', 'pct2', 'pct3'] as const).map((key, i) => {
                          const pct = tipPercentages[i]
                          const active = selectedTipKey === key
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={active}
                              onClick={() => handleTipPct(key, pct)}
                              className={`h-11 rounded-xl border text-[14px] font-medium tabular-nums transition-colors ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'}`}
                            >
                              {pct}%
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          aria-pressed={selectedTipKey === 'custom'}
                          onClick={handleCustomTip}
                          className={`h-11 rounded-xl border text-[14px] font-medium transition-colors ${selectedTipKey === 'custom' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'}`}
                        >
                          {copy.tipCustom}
                        </button>
                      </div>
                      {selectedTipKey === 'custom' && (
                        <Field label={copy.tipAmount} value={customTipValue} onChange={handleCustomTipInput} inputMode="decimal" type="number" />
                      )}
                    </div>
                  </Card>
                )}

                {showForm && (
                  <Card title={copy.yourDetails}>
                    <div className="space-y-3 px-4 pb-4">
                      <Field label={copy.yourName} value={customerName} onChange={onCustomerNameChange} autoComplete="name" required />
                      <Field label={copy.phone} value={customerPhone} onChange={onCustomerPhoneChange} autoComplete="tel" type="tel" inputMode="tel" required />
                    </div>
                  </Card>
                )}

                {showForm && (
                  <Card title={copy.paymentSummary}>
                    <dl className="space-y-1.5 px-4 pb-4 text-[15px]">
                      <div className="flex justify-between"><dt className="text-zinc-500">{copy.subtotal}</dt><dd className="tabular-nums text-zinc-800">{money(total)}</dd></div>
                      {deliveryFeeCents > 0 && (
                        <div className="flex justify-between"><dt className="text-zinc-500">{copy.deliveryFee}</dt><dd className="tabular-nums text-zinc-800">{money(deliveryFeeCents / 100)}</dd></div>
                      )}
                      {tipAmount > 0 && (
                        <div className="flex justify-between"><dt className="text-zinc-500">{copy.tip}</dt><dd className="tabular-nums text-zinc-800">{money(tipAmount)}</dd></div>
                      )}
                      <div className="flex justify-between border-t border-zinc-100 pt-2"><dt className="font-semibold text-zinc-900">{copy.total}</dt><dd className="font-semibold tabular-nums text-zinc-900">{money(grandTotal)}</dd></div>
                    </dl>
                  </Card>
                )}
              </div>

              {showForm && (
                <div className="shrink-0 space-y-2 border-t border-zinc-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  {orderError && (
                    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">{orderError}</p>
                  )}
                  <button
                    type="button"
                    onClick={onSubmit}
                    disabled={submittingOrder}
                    style={{ backgroundColor: primary, color: onPrimary }}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-6 text-base font-semibold shadow-float transition-[opacity,scale] hover:opacity-95 active:scale-[0.98] disabled:opacity-60"
                  >
                    {submittingOrder ? copy.placingOrder : (
                      <>
                        <span>{copy.placeOrder}</span>
                        <span aria-hidden="true" className="opacity-70">·</span>
                        <span className="tabular-nums">{money(grandTotal)}</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

function Card({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-2xl bg-white shadow-card ${className}`}>
      {title && <h3 className="px-4 pt-4 pb-3 text-[15px] font-semibold text-zinc-900">{title}</h3>}
      {children}
    </section>
  )
}

function Field({ label, value, onChange, type = 'text', inputMode, autoComplete, required = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel'
  autoComplete?: string
  required?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-zinc-600">
        {label}{required && <span aria-hidden="true" className="text-zinc-400"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required={required}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 0.01 : undefined}
        className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-[16px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5"
      />
    </div>
  )
}
