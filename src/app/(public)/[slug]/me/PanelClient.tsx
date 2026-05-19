'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Clock, CheckCircle2, Package, UtensilsCrossed, Truck, LogOut, MapPin, Phone as PhoneIcon, RefreshCw } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import type { Order, OrderItem } from '@/types/database'

type OrderWithItems = Order & { order_items: OrderItem[] }

const STATUS_STEPS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'done', label: 'Done' },
]

const DELIVERY_STATUS_STEPS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'done', label: 'Delivered' },
]

const STATUS_INDEX: Record<string, number> = {
  pending: 0, preparing: 1, ready: 2, out_for_delivery: 3, done: 4,
  paid: 0, payment_failed: -1, cancelled: -1,
}

const ORDER_TYPE_ICON: Record<string, React.ElementType> = {
  dine_in: UtensilsCrossed,
  pickup: Package,
  delivery: Truck,
}

interface TenantInfo {
  name: string
  slug: string
  settings: {
    primary_color: string
    accent_color: string
    address: string | null
    phone: string | null
    currency: string
    logo_url: string | null
  }
}

interface Props {
  tenant: TenantInfo
  orders: OrderWithItems[]
  customerPhone: string
}

function OrderStatusBar({ order, primaryColor }: { order: OrderWithItems; primaryColor: string }) {
  const steps = order.order_type === 'delivery' ? DELIVERY_STATUS_STEPS : STATUS_STEPS
  const currentIdx = STATUS_INDEX[order.status] ?? 0
  const isCancelled = order.status === 'cancelled' || order.status === 'payment_failed'

  if (isCancelled) {
    return (
      <div className="flex items-center gap-2 text-red-500 font-bold text-sm">
        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
        {order.status === 'cancelled' ? 'Cancelled' : 'Payment failed'}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 w-full">
      {steps.map((step, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
            <div className={`w-full h-1.5 rounded-full transition-all ${done || active ? '' : 'bg-zinc-200'}`}
              style={done || active ? { backgroundColor: primaryColor } : {}} />
            {active && (
              <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest whitespace-nowrap">{step.label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function PanelClient({ tenant, orders, customerPhone }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const primaryColor = tenant.settings.primary_color
  const currency = tenant.settings.currency ?? 'USD'

  const activeOrders = orders.filter(o =>
    !['done', 'cancelled', 'payment_failed'].includes(o.status)
  )
  const pastOrders = orders.filter(o =>
    ['done', 'cancelled', 'payment_failed'].includes(o.status)
  )

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push(`/${tenant.slug}/me/login`)
  }

  const TypeIcon = (type: string) => {
    const Icon = ORDER_TYPE_ICON[type] ?? Package
    return <Icon className="w-3.5 h-3.5" />
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="px-4 pt-8 pb-6" style={{ backgroundColor: primaryColor + '20' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">My Orders</p>
            <h1 className="text-2xl font-black text-zinc-950 tracking-tight">{tenant.name}</h1>
            <p className="text-xs text-zinc-500 font-medium mt-0.5">{customerPhone}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.refresh()}
              className="p-2.5 rounded-xl bg-white/60 hover:bg-white transition-all text-zinc-400 hover:text-zinc-700"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/60 hover:bg-white transition-all text-xs font-black text-zinc-500 hover:text-zinc-900 uppercase tracking-widest"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* Active Orders */}
        {activeOrders.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: primaryColor }} />
              <h2 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Active Orders</h2>
            </div>
            {activeOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {TypeIcon(order.order_type)}
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        {order.order_type === 'dine_in' ? 'Dine-In' : order.order_type === 'pickup' ? 'Pick-Up' : 'Delivery'}
                      </span>
                    </div>
                    <span className="font-mono text-xs font-black text-zinc-400">#{order.id.slice(0, 8).toUpperCase()}</span>
                  </div>

                  <OrderStatusBar order={order} primaryColor={primaryColor} />

                  <div className="space-y-1.5 border-t border-zinc-50 pt-3">
                    {order.order_items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-600">{item.product_name} ×{item.quantity}</span>
                        <span className="text-xs font-bold text-zinc-900">{formatPrice(item.unit_price * item.quantity, currency)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
                    <span className="text-xs font-bold text-zinc-500">Total</span>
                    <span className="text-base font-black text-zinc-950" style={{ color: primaryColor }}>{formatPrice(order.total, currency)}</span>
                  </div>

                  <p className="text-[10px] font-medium text-zinc-400">
                    Placed at {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Past Orders */}
        {pastOrders.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Order History</h2>
            {pastOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {TypeIcon(order.order_type)}
                    <span className="font-mono text-xs font-black text-zinc-400">#{order.id.slice(0, 8).toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {order.status === 'done' ? (
                      <span className="text-[10px] font-black text-green-600 uppercase tracking-widest flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </span>
                    ) : (
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                        {order.status === 'cancelled' ? 'Cancelled' : 'Failed'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{new Date(order.created_at).toLocaleDateString()}</span>
                  <span className="text-sm font-black text-zinc-950">{formatPrice(order.total, currency)}</span>
                </div>
                <div className="mt-2 space-y-0.5">
                  {order.order_items.slice(0, 3).map((item, i) => (
                    <p key={i} className="text-[11px] text-zinc-400">{item.product_name} ×{item.quantity}</p>
                  ))}
                  {order.order_items.length > 3 && (
                    <p className="text-[11px] text-zinc-400">+{order.order_items.length - 3} more items</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {orders.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: primaryColor + '20' }}>
              <Package className="w-8 h-8" style={{ color: primaryColor }} />
            </div>
            <p className="text-sm font-bold text-zinc-500">No orders yet</p>
            <p className="text-xs text-zinc-400 mt-1">Your order history will appear here</p>
          </div>
        )}

        {/* Restaurant Info */}
        {(tenant.settings.address || tenant.settings.phone) && (
          <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 space-y-3">
            <h2 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Restaurant Info</h2>
            {tenant.settings.address && (
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                <span className="text-sm font-medium text-zinc-700">{tenant.settings.address}</span>
              </div>
            )}
            {tenant.settings.phone && (
              <div className="flex items-center gap-3">
                <PhoneIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="text-sm font-medium text-zinc-700">{tenant.settings.phone}</span>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-[10px] text-zinc-300 pb-4">
          Powered by XmartMenu
        </p>
      </div>
    </div>
  )
}
