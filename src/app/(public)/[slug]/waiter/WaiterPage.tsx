'use client'

import { useRef, useState } from 'react'
import { idempotencyKeyFor, type IdempotencySlot } from '@/lib/orders/idempotency-client'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import { ShoppingBag, ChevronLeft, Plus, Minus, CheckCircle, SlidersHorizontal } from 'lucide-react'
import WaiterCallsPanel from '@/components/admin/WaiterCallsPanel'
import type { Product, ProductIngredientWithIngredient } from '@/types/database'
import type { GroupWithOptions } from '@/app/(admin)/menu/products/[id]/page'
import type { TenantCapabilities } from '@/lib/service-modes'
import { summarizeIngredientMods, summarizeOptions } from '@/components/menu/menu-utils'
import {
  addWaiterLine,
  changeWaiterLine,
  needsDishSheet,
  plainLineKey,
  quantityOfProduct,
  waiterCartTotal,
  waiterOrderItems,
  type WaiterLine,
} from './waiter-cart'

// The same dish sheet guests use: sizes, add-ons, ingredients, note.
const ProductModal = dynamic(() => import('@/components/menu/ProductModal'), { ssr: false })

interface Table {
  id: string
  name: string
  position: number
}

interface Category {
  id: string
  name: string
}

interface ActiveOrder {
  id: string
  table_name: string | null
  status: string
}

interface Props {
  slug: string
  tenantId: string
  tenantName: string
  tables: Table[]
  categories: Category[]
  products: Product[]
  optionGroupsByProductId: Record<string, GroupWithOptions[]>
  productIngredientsByProductId?: Record<string, ProductIngredientWithIngredient[]>
  /** What the plan and the restaurant allow (the page already requires waiterOrdering). */
  capabilities: TenantCapabilities
  activeOrders: ActiveOrder[]
  currency: string
  primaryColor: string
}

function getTableStatus(tableName: string, activeOrders: ActiveOrder[]): 'free' | 'active' | 'ready' {
  const orders = activeOrders.filter(o => o.table_name === tableName)
  if (orders.length === 0) return 'free'
  if (orders.some(o => o.status === 'ready')) return 'ready'
  return 'active'
}

const STATUS_STYLES = {
  free:   { bg: 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100', label: 'text-zinc-700', dot: 'bg-zinc-300' },
  active: { bg: 'bg-amber-50 border-amber-300 hover:bg-amber-100', label: 'text-amber-700', dot: 'bg-amber-400' },
  ready:  { bg: 'bg-green-50 border-green-400 hover:bg-green-100', label: 'text-green-700', dot: 'bg-green-500' },
}

export default function WaiterPage({ tenantId, tenantName, tables, categories, products, optionGroupsByProductId, productIngredientsByProductId = {}, capabilities, activeOrders, currency, primaryColor }: Props) {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [cart, setCart] = useState<WaiterLine[]>([])
  const orderAttemptRef = useRef<IdempotencySlot | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null)
  const [customerName] = useState('Mesa')
  const [customerPhone] = useState('0000000000')

  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>(activeOrders)

  const groupsOf = (productId: string) => optionGroupsByProductId[productId] ?? []
  const ingredientsOf = (productId: string) => (capabilities.ingredientCustomization ? productIngredientsByProductId[productId] ?? [] : [])
  const hasChoices = (product: Product) => needsDishSheet(groupsOf(product.id).length, ingredientsOf(product.id).length, capabilities)

  function addProduct(product: Product) {
    setSubmitError(null)
    if (hasChoices(product)) {
      setSheetProduct(product)
      return
    }
    setCart(prev => addWaiterLine(prev, { product, quantity: 1, selectedOptions: {}, unitPrice: product.price }))
  }

  function changeLine(key: string, delta: number) {
    setSubmitError(null)
    setCart(prev => changeWaiterLine(prev, key, delta))
  }

  const cartTotal = waiterCartTotal(cart)
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)

  async function handleSubmitOrder() {
    if (!selectedTable || cart.length === 0 || submitting) return
    setSubmitting(true)
    setSubmitError(null)

    const body = {
      tenant_id: tenantId,
      customer_name: `${customerName} (${selectedTable.name})`,
      customer_phone: customerPhone,
      order_type: 'dine_in',
      table_name: selectedTable.name,
      table_id: selectedTable.id,
      items: waiterOrderItems(cart),
    }
    // A retry of this same round reuses the key (no duplicate in the kitchen);
    // after it is sent the key is dropped, so an identical next round is new.
    orderAttemptRef.current = idempotencyKeyFor(orderAttemptRef.current, body)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': orderAttemptRef.current.key },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(typeof data?.error === 'string' && data.error ? `Order not sent: ${data.error}` : 'Order not sent. Check the connection and try again.')
        return
      }
      orderAttemptRef.current = null
      setLiveOrders(prev => [...prev, { id: data.id, table_name: selectedTable.name, status: 'pending' }])
      setCart([])
      setSubmitted(true)
      setTimeout(() => {
        setSubmitted(false)
        setSelectedTable(null)
      }, 2000)
    } catch {
      setSubmitError('Order not sent. Check the connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const filteredProducts = activeCategory
    ? products.filter(p => p.category_id === activeCategory)
    : products

  // Table grid view
  if (!selectedTable) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6" style={{ '--primary': primaryColor } as React.CSSProperties}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">Waiter Interface</p>
              <h1 className="text-2xl font-bold text-zinc-900">{tenantName}</h1>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-zinc-300" />Free</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />Active</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Ready</span>
            </div>
          </div>

          <div className="mb-6">
            <WaiterCallsPanel tenantId={tenantId} />
          </div>

          {tables.length === 0 ? (
            <div className="text-center py-20 text-zinc-400">
              <p className="font-semibold">No tables configured</p>
              <p className="text-sm mt-1">Go to Store Settings → Table Management to add tables.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {tables.map(table => {
                const status = getTableStatus(table.name, liveOrders)
                const styles = STATUS_STYLES[status]
                return (
                  <button
                    key={table.id}
                    onClick={() => { setSelectedTable(table); setCart([]); setSubmitted(false); setSubmitError(null) }}
                    className={`relative aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${styles.bg}`}
                  >
                    <span className={`absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full ${styles.dot}`} />
                    <span className={`text-sm font-bold text-center px-2 leading-snug ${styles.label}`}>{table.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Order entry view
  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => setSelectedTable(null)} aria-label="Back to tables" className="p-2 rounded-lg hover:bg-zinc-100 transition-colors">
          <ChevronLeft className="w-5 h-5 text-zinc-600" />
        </button>
        <div className="flex-1">
          <p className="text-xs text-zinc-400 font-medium">New order for</p>
          <h2 className="text-base font-bold text-zinc-900">{selectedTable.name}</h2>
        </div>
        {cartCount > 0 && (
          <button
            onClick={handleSubmitOrder}
            disabled={submitting || submitted}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-semibold rounded-xl hover:bg-zinc-800 disabled:opacity-60 transition-colors"
          >
            {submitted ? (
              <><CheckCircle className="w-4 h-4 text-green-400" /> Sent!</>
            ) : (
              <><ShoppingBag className="w-4 h-4" /> {cartCount} · {formatPrice(cartTotal, currency)}</>
            )}
          </button>
        )}
      </div>

      <div className="px-4 pt-3">
        <WaiterCallsPanel tenantId={tenantId} compact />
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${!activeCategory ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600'}`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${activeCategory === cat.id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600'}`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Product list */}
      <div className="px-4 pb-72 space-y-2">
        {filteredProducts.map(product => {
          const choices = hasChoices(product)
          const inCart = quantityOfProduct(cart, product.id)
          const plainKey = plainLineKey(product)
          const plainQuantity = cart.find(l => l.key === plainKey)?.quantity ?? 0
          return (
            <div key={product.id} className="flex items-center gap-3 bg-white border border-zinc-100 rounded-xl px-4 py-3">
              {product.image_url && (
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 relative">
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" sizes="48px" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{product.name}</p>
                <p className="text-sm font-bold text-zinc-700">
                  {formatPrice(product.price, currency)}
                  {choices && <span className="ml-2 text-xs font-medium text-zinc-400">options</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {choices ? (
                  <>
                    {inCart > 0 && <span className="min-w-6 text-center text-sm font-bold text-zinc-900">{inCart}</span>}
                    <button
                      onClick={() => addProduct(product)}
                      aria-label={`Choose options for ${product.name}`}
                      className="h-8 px-3 rounded-full bg-zinc-900 flex items-center gap-1.5 text-xs font-semibold text-white hover:bg-zinc-800 transition-colors"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" /> Add
                    </button>
                  </>
                ) : plainQuantity > 0 ? (
                  <>
                    <button
                      onClick={() => changeLine(plainKey, -1)}
                      aria-label={`Remove ${product.name}`}
                      className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 transition-colors"
                    >
                      <Minus className="w-4 h-4 text-zinc-700" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-zinc-900">{plainQuantity}</span>
                    <button
                      onClick={() => addProduct(product)}
                      aria-label={`Add ${product.name}`}
                      className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center hover:bg-zinc-800 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-white" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => addProduct(product)}
                    aria-label={`Add ${product.name}`}
                    className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center hover:bg-zinc-800 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Order summary: every line with its choices, then send */}
      {cartCount > 0 && !submitted && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-zinc-200 px-4 py-4 space-y-2">
          <ul className="max-h-40 overflow-y-auto divide-y divide-zinc-100">
            {cart.map(line => {
              const details = [
                summarizeOptions(line.selectedOptions),
                ...summarizeIngredientMods(line.ingredientModifications),
                line.note ? `“${line.note}”` : '',
              ].filter(Boolean).join(' · ')
              return (
                <li key={line.key} className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">{line.product.name}</p>
                    {details && <p className="truncate text-xs text-zinc-500">{details}</p>}
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-zinc-600">{formatPrice(line.unitPrice * line.quantity, currency)}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => changeLine(line.key, -1)} aria-label={`Remove one ${line.product.name}`} className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200">
                      <Minus className="w-3.5 h-3.5 text-zinc-700" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-zinc-900">{line.quantity}</span>
                    <button onClick={() => changeLine(line.key, 1)} aria-label={`Add one ${line.product.name}`} className="w-7 h-7 rounded-full bg-zinc-900 flex items-center justify-center hover:bg-zinc-800">
                      <Plus className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-between text-sm font-bold text-zinc-900">
            <span>{cartCount} items</span>
            <span>{formatPrice(cartTotal, currency)}</span>
          </div>
          {submitError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>
          )}
          <button
            onClick={handleSubmitOrder}
            disabled={submitting}
            className="w-full py-3.5 bg-zinc-900 text-white font-bold rounded-xl hover:bg-zinc-800 disabled:opacity-60 transition-colors text-sm"
          >
            {submitting ? 'Sending…' : submitError ? `Try again — ${selectedTable.name}` : `Send order — ${selectedTable.name}`}
          </button>
        </div>
      )}

      {sheetProduct && (
        <ProductModal
          product={sheetProduct}
          primaryColor={primaryColor}
          currency={currency}
          lang="en"
          showcase={false}
          onClose={() => setSheetProduct(null)}
          optionGroups={groupsOf(sheetProduct.id)}
          itemNotesEnabled={capabilities.itemNotes}
          ingredientCustomizationEnabled={capabilities.ingredientCustomization}
          productIngredients={ingredientsOf(sheetProduct.id)}
          onAddToCart={(selectedOptions, unitPrice, note, ingredientModifications, editorState, quantity) => {
            setCart(prev => addWaiterLine(prev, {
              product: sheetProduct,
              quantity: quantity ?? 1,
              selectedOptions,
              unitPrice,
              note,
              ingredientModifications: ingredientModifications ?? null,
              editorState: editorState ?? null,
            }))
            setSheetProduct(null)
          }}
        />
      )}
    </div>
  )
}
