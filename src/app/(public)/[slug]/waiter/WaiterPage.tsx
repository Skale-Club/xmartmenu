'use client'

import { useState } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import { ShoppingBag, X, ChevronLeft, Plus, Minus, CheckCircle } from 'lucide-react'

interface Table {
  id: string
  name: string
  position: number
}

interface Category {
  id: string
  name: string
}

interface Product {
  id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  image_url: string | null
}

interface ActiveOrder {
  id: string
  table_name: string | null
  status: string
}

interface CartItem {
  product: Product
  quantity: number
  note?: string
}

interface Props {
  slug: string
  tenantId: string
  tenantName: string
  tables: Table[]
  categories: Category[]
  products: Product[]
  optionGroupsByProductId: Record<string, any[]>
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

export default function WaiterPage({ tenantId, tenantName, tables, categories, products, optionGroupsByProductId, activeOrders, currency, primaryColor }: Props) {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [customerName, setCustomerName] = useState('Mesa')
  const [customerPhone, setCustomerPhone] = useState('0000000000')

  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>(activeOrders)

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { product, quantity: 1 }]
    })
  }

  function removeFromCart(productId: string) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === productId)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter(i => i.product.id !== productId)
      return prev.map(i => i.product.id === productId ? { ...i, quantity: i.quantity - 1 } : i)
    })
  }

  const cartTotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0)
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)

  async function handleSubmitOrder() {
    if (!selectedTable || cart.length === 0) return
    setSubmitting(true)

    const body = {
      tenant_id: tenantId,
      customer_name: `${customerName} (${selectedTable.name})`,
      customer_phone: customerPhone,
      order_type: 'dine_in',
      table_name: selectedTable.name,
      items: cart.map(i => ({
        product_id: i.product.id,
        product_name: i.product.name,
        quantity: i.quantity,
        unit_price: i.product.price,
        notes: i.note || undefined,
        selected_options: {},
      })),
    }

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = await res.json()
      setLiveOrders(prev => [...prev, { id: data.id, table_name: selectedTable.name, status: 'pending' }])
      setCart([])
      setSubmitted(true)
      setTimeout(() => {
        setSubmitted(false)
        setSelectedTable(null)
      }, 2000)
    }
    setSubmitting(false)
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
                    onClick={() => { setSelectedTable(table); setCart([]); setSubmitted(false) }}
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
        <button onClick={() => setSelectedTable(null)} className="p-2 rounded-lg hover:bg-zinc-100 transition-colors">
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

      {/* Product grid */}
      {/* Product list */}
      <div className="px-4 pb-32 space-y-2">
        {filteredProducts.map(product => {
          const inCart = cart.find(i => i.product.id === product.id)
          return (
            <div key={product.id} className="flex items-center gap-3 bg-white border border-zinc-100 rounded-xl px-4 py-3">
              {product.image_url && (
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 relative">
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" sizes="48px" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{product.name}</p>
                <p className="text-sm font-bold text-zinc-700">{formatPrice(product.price, currency)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {inCart ? (
                  <>
                    <button
                      onClick={() => removeFromCart(product.id)}
                      className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 transition-colors"
                    >
                      <Minus className="w-4 h-4 text-zinc-700" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-zinc-900">{inCart.quantity}</span>
                    <button
                      onClick={() => addToCart(product)}
                      className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center hover:bg-zinc-800 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-white" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => addToCart(product)}
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

      {/* Cart summary bar */}
      {cartCount > 0 && !submitted && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-zinc-200 px-4 py-4 space-y-2">
          <div className="flex items-center justify-between text-sm font-bold text-zinc-900">
            <span>{cartCount} items</span>
            <span>{formatPrice(cartTotal, currency)}</span>
          </div>
          <button
            onClick={handleSubmitOrder}
            disabled={submitting}
            className="w-full py-3.5 bg-zinc-900 text-white font-bold rounded-xl hover:bg-zinc-800 disabled:opacity-60 transition-colors text-sm"
          >
            {submitting ? 'Sending…' : `Send order — ${selectedTable.name}`}
          </button>
        </div>
      )}
    </div>
  )
}
