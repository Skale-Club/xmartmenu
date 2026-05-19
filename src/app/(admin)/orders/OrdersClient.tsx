'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderItem } from '@/types/database'
import { useElapsedTime } from './useElapsedTime'
import { Bell, BellOff, LayoutGrid, List, MessageSquare, Package, Clock, CheckCircle2, XCircle, AlertCircle, Play, Check, X, Info, ChevronRight, Plus, UtensilsCrossed, Truck, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type OrderWithItems = Order & { order_items: OrderItem[] }

const STATUS_COLORS: Record<string, {
  border: string
  bg: string
  badge: string
  label: string
  icon: any
}> = {
  pending:          { border: 'border-blue-500',    bg: 'bg-blue-50/30',    badge: 'bg-blue-100 text-blue-800',         label: 'Pending', icon: Clock },
  paid:             { border: 'border-emerald-500', bg: 'bg-emerald-50/30', badge: 'bg-emerald-100 text-emerald-800',   label: 'Paid', icon: CheckCircle2 },
  payment_failed:   { border: 'border-red-500',     bg: 'bg-red-50/30',     badge: 'bg-red-100 text-red-800',           label: 'Payment failed', icon: AlertCircle },
  preparing:        { border: 'border-amber-500',   bg: 'bg-amber-50/30',   badge: 'bg-amber-100 text-amber-800',       label: 'Preparing', icon: Play },
  ready:            { border: 'border-green-500',   bg: 'bg-green-50/30',   badge: 'bg-green-100 text-green-800',       label: 'Ready', icon: CheckCircle2 },
  out_for_delivery: { border: 'border-indigo-500',  bg: 'bg-indigo-50/30',  badge: 'bg-indigo-100 text-indigo-800',     label: 'Out for Delivery', icon: Truck },
  done:             { border: 'border-zinc-400',    bg: 'bg-zinc-50/30',    badge: 'bg-zinc-100 text-zinc-600',         label: 'Done', icon: Check },
  cancelled:        { border: 'border-red-500',     bg: 'bg-red-50/30',     badge: 'bg-red-100 text-red-800',           label: 'Cancelled', icon: XCircle },
}

const ORDER_TYPE_CONFIG: Record<string, { badge: string; label: string; Icon: any }> = {
  dine_in:  { badge: 'bg-blue-100 text-blue-700 border border-blue-200',     label: 'Dine-In',  Icon: UtensilsCrossed },
  pickup:   { badge: 'bg-amber-100 text-amber-700 border border-amber-200',   label: 'Pick-Up',  Icon: Package },
  delivery: { badge: 'bg-purple-100 text-purple-700 border border-purple-200', label: 'Delivery', Icon: Truck },
}

// Canonical state machine: pending -> paid -> preparing -> ready -> done.
// Delivery orders: ready -> out_for_delivery -> done.
// payment_failed is terminal pre-prep; cancelled is terminal at any point.
const NEXT_STATUS: Record<string, string | null> = {
  pending:          'preparing',
  paid:             'preparing',
  preparing:        'ready',
  ready:            'done',         // overridden for delivery orders by getNextStatus
  out_for_delivery: 'done',
  done:             null,
  payment_failed:   null,
  cancelled:        null,
}

function getNextStatus(order: OrderWithItems): string | null {
  if (order.status === 'ready' && (order as any).order_type === 'delivery') {
    return 'out_for_delivery'
  }
  return NEXT_STATUS[order.status] ?? null
}

const ADVANCE_LABEL: Record<string, string> = {
  pending:          'Start preparing',
  paid:             'Start preparing',
  preparing:        'Mark ready',
  ready:            'Complete',
  out_for_delivery: 'Mark delivered',
}

const KDS_VIEW_KEY    = (tenantId: string) => `kds_view_${tenantId}`
const KDS_FILTER_KEY  = (tenantId: string) => `kds_filter_${tenantId}`
const KDS_MUTE_KEY    = (tenantId: string) => `kds_mute_${tenantId}`

type FilterValue = 'active' | 'pending' | 'preparing' | 'ready' | 'all'

const FILTER_CHIPS: { value: FilterValue; label: string }[] = [
  { value: 'active',    label: 'Active' },
  { value: 'pending',   label: 'Pending' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready',     label: 'Ready' },
  { value: 'all',       label: 'All' },
]

const DEFAULT_FILTER: FilterValue = 'active'

interface LocationOption {
  id: string
  name: string
  slug: string
}

interface OrdersClientProps {
  initialOrders: OrderWithItems[]
  tenantId: string
  amberThreshold: number
  redThreshold: number
  locations?: LocationOption[]
}

function OrderCard({
  order,
  loadingId,
  onAdvance,
  onCancel,
  amberMinutes,
  redMinutes,
  onClick,
}: {
  order: OrderWithItems
  loadingId: string | null
  onAdvance: (id: string, status: string) => void
  onCancel: (id: string) => void
  amberMinutes: number
  redMinutes: number
  onClick: () => void
}) {
  const { minutes, chipClass } = useElapsedTime(order.created_at, amberMinutes, redMinutes)
  const colors = STATUS_COLORS[order.status] ?? STATUS_COLORS['pending']
  const nextStatus = getNextStatus(order)
  const isLoading = loadingId === order.id
  const StatusIcon = colors.icon

  return (
    <div className={cn(
      "group relative bg-white border border-zinc-100 rounded-[1.25rem] p-6 transition-all duration-500 hover:border-primary hover:shadow-2xl hover:shadow-primary/10 flex flex-col gap-6",
      order.status === 'ready' && "ring-2 ring-green-100"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-colors", colors.bg)}>
            <StatusIcon className={cn("w-5 h-5", colors.badge.split(' ')[1])} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Order ID</p>
            <p className="text-sm font-black text-zinc-950 font-mono tracking-tight">#{order.id.slice(0, 8)}</p>
          </div>
        </div>
        <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm", colors.badge)}>
          {colors.label}
        </div>
      </div>

      {/* Fulfillment badge */}
      {(() => {
        const orderType = (order as any).order_type ?? 'dine_in'
        const cfg = ORDER_TYPE_CONFIG[orderType]
        if (!cfg) return null
        const { badge, label, Icon } = cfg
        return (
          <div className="flex items-center gap-2 -mt-3">
            <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest", badge)}>
              <Icon className="w-3 h-3" />
              {label}
            </span>
            {orderType === 'delivery' && (() => {
              const street = (order as any).delivery_street
              const zip = (order as any).delivery_zipcode
              const city = (order as any).delivery_city
              const display = [street, zip, city].filter(Boolean).join(', ') || (order as any).delivery_address
              return display ? <span className="text-[10px] text-zinc-400 font-medium truncate max-w-[150px]">{display}</span> : null
            })()}
            {(order as any).table_name && (
              <span className="text-[10px] font-black text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full uppercase tracking-wide">
                {(order as any).table_name}
              </span>
            )}
          </div>
        )
      })()}

      {/* Customer */}
      <div onClick={onClick} className="cursor-pointer space-y-1">
        <h3 className="text-xl font-black text-zinc-950 tracking-tight leading-tight group-hover:text-primary transition-colors">{order.customer_name}</h3>
        <p className="text-xs font-bold text-zinc-500">{order.customer_phone}</p>
      </div>

      {/* Items */}
      <div className="flex-1 space-y-3">
        {order.order_items.map((item, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-lg bg-zinc-50 flex items-center justify-center text-[10px] font-black text-zinc-950 border border-zinc-100">
              {item.quantity}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-zinc-800 leading-tight truncate">{item.product_name}</p>
              {item.notes && (
                <div className="flex items-center gap-1.5 mt-1">
                  <MessageSquare size={12} className="text-primary shrink-0" />
                  <p className="text-[11px] font-medium text-zinc-500 italic truncate">{item.notes}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="pt-6 border-t border-zinc-50 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-0.5">Total</p>
          <p className="text-xl font-black text-zinc-950 tracking-tighter">R$ {order.total.toFixed(2)}</p>
          {(order as any).tip_cents > 0 && (
            <p className="text-[10px] font-bold text-zinc-400">tip R$ {((order as any).tip_cents / 100).toFixed(2)}</p>
          )}
        </div>
        <div className={cn("px-4 py-2 rounded-xl flex items-center gap-2 shadow-sm border", chipClass)}>
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs font-black tracking-widest">{minutes}m</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {nextStatus && (
          <button
            onClick={() => onAdvance(order.id, nextStatus)}
            disabled={isLoading}
            className="w-full py-4 bg-zinc-950 text-white rounded-full text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-zinc-950 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-zinc-950/10"
          >
            {isLoading ? 'Processing...' : ADVANCE_LABEL[order.status]}
          </button>
        )}
        {(order.status === 'pending' || order.status === 'preparing') && (
          <button
            onClick={() => onCancel(order.id)}
            disabled={isLoading}
            className="w-full py-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-50"
          >
            Cancel Order
          </button>
        )}
      </div>
    </div>
  )
}

export default function OrdersClient({ initialOrders, tenantId, amberThreshold, redThreshold, locations = [] }: OrdersClientProps) {
  const [orders, setOrders] = useState(initialOrders)
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [activeFilter, setActiveFilter] = useState<FilterValue>(DEFAULT_FILTER)
  const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'dine_in' | 'pickup' | 'delivery'>('all')
  const [locationFilter, setLocationFilter] = useState<'all' | string>('all')
  const [muted, setMuted] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mutedRef = useRef(false)
  const supabase = createClient()

  useEffect(() => {
    const saved = localStorage.getItem(KDS_VIEW_KEY(tenantId))
    if (saved === 'grid' || saved === 'list') setView(saved)
  }, [tenantId])

  useEffect(() => {
    const saved = localStorage.getItem(KDS_FILTER_KEY(tenantId))
    if (saved === 'pending' || saved === 'preparing' || saved === 'ready' || saved === 'all') {
      setActiveFilter(saved)
    }
  }, [tenantId])

  useEffect(() => {
    const saved = localStorage.getItem(KDS_MUTE_KEY(tenantId))
    if (saved === 'true') setMuted(true)
  }, [tenantId])

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  function playBeep() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.1)
    } catch {}
  }

  useEffect(() => {
    const channel = supabase
      .channel(`orders-realtime-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${tenantId}`,
        },
        async (payload) => {
          const { data: fullOrder } = await supabase
            .from('orders')
            .select('*, order_items(*)')
            .eq('id', (payload.new as { id: string }).id)
            .single()
          if (fullOrder) {
            setOrders((prev) => {
              if (prev.some((o) => o.id === fullOrder.id)) return prev
              return [fullOrder as OrderWithItems, ...prev]
            })
            const newOrder = fullOrder as OrderWithItems
            if (newOrder.status === 'pending' && !mutedRef.current) {
              playBeep()
            }
          }
        }
      )
      // Round-2 P0-06 fix: also listen for UPDATEs so webhook-driven status
      // transitions (pending -> paid -> payment_failed) reach the KDS without
      // waiting for the 15s poll.
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${tenantId}`,
        },
        async (payload) => {
          const updated = payload.new as { id: string; status: string }
          setOrders((prev) =>
            prev.map((o) =>
              o.id === updated.id ? { ...o, ...(updated as Partial<OrderWithItems>) } : o,
            ),
          )
          // Beep on freshly-paid orders the same way we beep on new pending
          // orders — pay flow is the "real" arrival for paid stores.
          if (updated.status === 'paid' && !mutedRef.current) {
            playBeep()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tenantId, supabase])

  useEffect(() => {
    // Polling is a safety net behind realtime. Tenant scope is derived
    // server-side from getEffectiveTenant — the URL no longer needs a
    // tenant_id query parameter (the route ignores it after round-1 P0-07).
    const id = setInterval(async () => {
      const res = await fetch('/api/orders')
      if (res.ok) {
        const data = await res.json()
        // Merge by id rather than replace, so an optimistic status update
        // isn't reverted if a poll lands between the PATCH and the realtime
        // UPDATE event.
        setOrders((prev) => {
          const byId = new Map<string, OrderWithItems>(prev.map((o) => [o.id, o]))
          for (const o of data.orders as OrderWithItems[]) byId.set(o.id, o)
          return Array.from(byId.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
        })
      }
    }, 15_000)
    return () => clearInterval(id)
  }, [tenantId])

  function toggleView(next: 'grid' | 'list') {
    setView(next)
    localStorage.setItem(KDS_VIEW_KEY(tenantId), next)
  }

  function selectFilter(next: FilterValue) {
    setActiveFilter(next)
    localStorage.setItem(KDS_FILTER_KEY(tenantId), next)
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    localStorage.setItem(KDS_MUTE_KEY(tenantId), String(next))
  }

  const filteredOrders = (() => {
    const byStatus = activeFilter === 'all'
      ? orders
      : activeFilter === 'active'
        ? orders.filter((o) => o.status === 'pending' || o.status === 'preparing' || o.status === 'out_for_delivery')
        : orders.filter((o) => o.status === activeFilter)
    const byType = orderTypeFilter === 'all'
      ? byStatus
      : byStatus.filter((o) => (o as any).order_type === orderTypeFilter)
    return locationFilter === 'all'
      ? byType
      : byType.filter((o) => (o as any).location_id === locationFilter)
  })()

  async function updateStatus(orderId: string, status: string) {
    setLoadingId(orderId)
    const res = await fetch(`/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, status }),
    })
    const data = await res.json()
    if (res.ok) {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: data.status } : o))
      )
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) => prev ? { ...prev, status: data.status } : null)
      }
    }
    setLoadingId(null)
  }

  return (
    <div className="p-8 w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Kitchen Display</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Orders Queue</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Real-time order management and fulfillment</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right mr-2 hidden sm:block">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Volume</p>
            <p className="text-lg font-black text-zinc-950">{filteredOrders.length} active</p>
          </div>
          <button
            onClick={toggleMute}
            className={cn(
              "p-4 rounded-xl border transition-all duration-300",
              muted 
                ? "bg-zinc-50 text-zinc-400 border-zinc-100" 
                : "bg-primary/10 text-primary border-primary/20 shadow-lg shadow-primary/5"
            )}
            title={muted ? 'Enable notification sound' : 'Mute notifications'}
          >
            {muted ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 p-1.5 rounded-[0.75rem] shadow-sm">
            <button
              onClick={() => toggleView('grid')}
              className={cn(
                "p-2.5 rounded-xl transition-all",
                view === 'grid' ? "bg-zinc-950 text-white shadow-lg" : "text-zinc-400 hover:text-zinc-900"
              )}
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button
              onClick={() => toggleView('list')}
              className={cn(
                "p-2.5 rounded-xl transition-all",
                view === 'list' ? "bg-zinc-950 text-white shadow-lg" : "text-zinc-400 hover:text-zinc-900"
              )}
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 pb-2 overflow-x-auto no-scrollbar">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.value}
            onClick={() => selectFilter(chip.value)}
            className={cn(
              "flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-6 py-3 rounded-full border transition-all active:scale-95",
              activeFilter === chip.value
                ? "bg-zinc-950 text-white border-zinc-950 shadow-lg shadow-zinc-950/10"
                : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Order type filter */}
      <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar">
        <span className="flex-shrink-0 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Type</span>
        {(['all', 'dine_in', 'pickup', 'delivery'] as const).map(type => (
          <button
            key={type}
            onClick={() => setOrderTypeFilter(type)}
            className={cn(
              "flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-5 py-2 rounded-full border transition-all active:scale-95",
              orderTypeFilter === type
                ? "bg-zinc-950 text-white border-zinc-950 shadow-lg shadow-zinc-950/10"
                : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
            )}
          >
            {type === 'all' ? 'All' : type === 'dine_in' ? 'Dine-In' : type === 'pickup' ? 'Pick-Up' : 'Delivery'}
          </button>
        ))}
      </div>

      {/* Location filter — only shown when 2+ locations */}
      {locations.length >= 2 && (
        <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar">
          <Building2 className="flex-shrink-0 w-3.5 h-3.5 text-zinc-400" />
          <span className="flex-shrink-0 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Branch</span>
          <button
            onClick={() => setLocationFilter('all')}
            className={cn(
              "flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-5 py-2 rounded-full border transition-all active:scale-95",
              locationFilter === 'all'
                ? "bg-zinc-950 text-white border-zinc-950 shadow-lg shadow-zinc-950/10"
                : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
            )}
          >
            All
          </button>
          {locations.map(loc => (
            <button
              key={loc.id}
              onClick={() => setLocationFilter(loc.id)}
              className={cn(
                "flex-shrink-0 text-[10px] font-black uppercase tracking-widest px-5 py-2 rounded-full border transition-all active:scale-95",
                locationFilter === loc.id
                  ? "bg-zinc-950 text-white border-zinc-950 shadow-lg shadow-zinc-950/10"
                  : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-300"
              )}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-50 rounded-[1.5rem] border border-dashed border-zinc-200">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6">
            <Package className="w-10 h-10 text-zinc-200" />
          </div>
          <h3 className="text-xl font-black text-zinc-950 mb-2">Queue is clear</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto font-medium">All caught up! New orders will appear here automatically.</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
          {filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              loadingId={loadingId}
              onAdvance={(id, status) => updateStatus(id, status)}
              onCancel={(id) => updateStatus(id, 'cancelled')}
              amberMinutes={amberThreshold}
              redMinutes={redThreshold}
              onClick={() => setSelectedOrder(order)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white border border-zinc-100 rounded-[1.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-zinc-400">Order ID</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-zinc-400">Customer</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-center">Volume</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-zinc-400">Total</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-zinc-400">Status</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {filteredOrders.map((order) => {
                  const colors = STATUS_COLORS[order.status] ?? STATUS_COLORS['pending']
                  const StatusIcon = colors.icon
                  return (
                    <tr
                      key={order.id}
                      className="group hover:bg-zinc-50/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <td className="px-8 py-6">
                        <span className="font-mono text-xs font-black text-zinc-400 group-hover:text-primary transition-colors">#{order.id.slice(0, 8)}</span>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-zinc-950 tracking-tight">{order.customer_name}</p>
                        <p className="text-[10px] font-bold text-zinc-500">{order.customer_phone}</p>
                      </td>
                      <td className="px-8 py-6 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-zinc-100 text-xs font-black text-zinc-950">
                          {order.order_items?.length ?? 0}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-zinc-950 tracking-tight">R$ {order.total.toFixed(2)}</span>
                      </td>
                      <td className="px-8 py-6">
                        <div className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest", colors.badge)}>
                          <StatusIcon className="w-3 h-3" />
                          {colors.label}
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button className="p-3 rounded-full bg-zinc-950 text-white hover:bg-primary hover:text-zinc-950 transition-all shadow-lg shadow-zinc-950/10">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4" onClick={() => setSelectedOrder(null)}>
          <div className="w-full max-w-2xl bg-white rounded-[1.5rem] border border-zinc-200 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-10 py-8 border-b border-zinc-100 bg-zinc-50/50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-[1.25rem] bg-zinc-950 flex items-center justify-center text-primary shadow-xl shadow-zinc-950/10">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Order Details</h2>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-0.5">Reference #{selectedOrder.id.slice(0, 8)}</p>
                </div>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-3 hover:bg-zinc-100 rounded-full transition-colors"><X className="w-6 h-6 text-zinc-400" /></button>
            </div>
            
            <div className="p-10 space-y-10 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 block">Customer</label>
                    <p className="text-lg font-black text-zinc-950 tracking-tight">{selectedOrder.customer_name}</p>
                    <p className="text-xs font-bold text-zinc-500">{selectedOrder.customer_phone}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 block">Timeline</label>
                    <div className="flex items-center gap-2 text-sm font-bold text-zinc-600">
                      <Clock className="w-4 h-4" />
                      {new Date(selectedOrder.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {(selectedOrder as any).table_name && (
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 block">Table</label>
                      <p className="text-sm font-bold text-zinc-900">{(selectedOrder as any).table_name}</p>
                    </div>
                  )}
                  {(selectedOrder as any).order_type === 'delivery' && (() => {
                    const street = (selectedOrder as any).delivery_street
                    const complement = (selectedOrder as any).delivery_complement
                    const zip = (selectedOrder as any).delivery_zipcode
                    const city = (selectedOrder as any).delivery_city
                    const notes = (selectedOrder as any).delivery_notes
                    const fallback = (selectedOrder as any).delivery_address
                    if (!street && !fallback) return null
                    return (
                      <div>
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 block">Delivery Address</label>
                        <div className="space-y-0.5 text-sm font-bold text-zinc-700">
                          {street ? (
                            <>
                              <p>{street}{complement ? `, ${complement}` : ''}</p>
                              {(zip || city) && <p className="text-xs text-zinc-500">{[zip, city].filter(Boolean).join(' — ')}</p>}
                            </>
                          ) : (
                            <p>{fallback}</p>
                          )}
                          {notes && <p className="text-xs text-zinc-400 italic">{notes}</p>}
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 block">Status</label>
                    <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm", STATUS_COLORS[selectedOrder.status]?.badge)}>
                      {selectedOrder.status}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 block">Total Value</label>
                    <p className="text-2xl font-black text-zinc-950 tracking-tighter">R$ {selectedOrder.total.toFixed(2)}</p>
                    {(selectedOrder as any).tip_cents > 0 && (
                      <p className="text-xs font-bold text-zinc-500 mt-0.5">incl. tip R$ {((selectedOrder as any).tip_cents / 100).toFixed(2)}</p>
                    )}
                  </div>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="bg-amber-50 border border-amber-100 rounded-[1rem] p-6 flex gap-4">
                  <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Global Instructions</p>
                    <p className="text-sm font-medium text-amber-900 leading-relaxed">{selectedOrder.notes}</p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 block">Order Composition</label>
                <div className="space-y-3">
                  {selectedOrder.order_items?.map((item, idx) => (
                    <div key={idx} className="bg-zinc-50 rounded-[1rem] p-6 border border-zinc-100 group hover:border-primary/30 transition-all">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-xl bg-white border border-zinc-200 flex items-center justify-center text-xs font-black text-zinc-950">{item.quantity}x</span>
                          <span className="text-base font-black text-zinc-950 tracking-tight">{item.product_name}</span>
                        </div>
                        <span className="text-sm font-black text-zinc-950 tracking-tight">R$ {(item.unit_price * item.quantity).toFixed(2)}</span>
                      </div>
                      
                      {item.notes && (
                        <div className="flex items-start gap-2 bg-white rounded-xl p-3 border border-zinc-100 mb-3">
                          <MessageSquare className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                          <p className="text-[11px] font-medium text-zinc-500 italic">{item.notes}</p>
                        </div>
                      )}

                      {item.ingredient_modifications && (() => {
                        const mods = item.ingredient_modifications
                        if (mods.removed.length === 0 && mods.extras.length === 0 && mods.added.length === 0) return null
                        return (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {mods.removed.map(r => (
                              <span key={r.ingredient_id} className="text-[9px] font-black uppercase px-2.5 py-1 bg-red-50 text-red-600 rounded-lg border border-red-100 flex items-center gap-1.5"><X className="w-3 h-3" /> NO {r.name}</span>
                            ))}
                            {mods.extras.map(e => (
                              <span key={e.ingredient_id} className="text-[9px] font-black uppercase px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg border border-amber-100 flex items-center gap-1.5"><Plus className="w-3 h-3" /> {e.qty}x {e.name}</span>
                            ))}
                            {mods.added.map(a => (
                              <span key={a.ingredient_id} className="text-[9px] font-black uppercase px-2.5 py-1 bg-green-50 text-green-600 rounded-lg border border-green-100 flex items-center gap-1.5"><Check className="w-3 h-3" /> ADD {a.name}</span>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-10 bg-zinc-50/50 border-t border-zinc-100 flex gap-4">
              <div className="flex-1 flex gap-3">
                {selectedOrder.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'preparing')}
                    className="flex-1 py-5 bg-zinc-950 text-white rounded-full text-sm font-black uppercase tracking-widest hover:bg-primary hover:text-zinc-950 transition-all shadow-xl shadow-zinc-950/10"
                  >
                    Start preparing
                  </button>
                )}
                {selectedOrder.status === 'preparing' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'ready')}
                    className="flex-1 py-5 bg-primary text-zinc-950 rounded-full text-sm font-black uppercase tracking-widest hover:bg-zinc-950 hover:text-white transition-all shadow-xl shadow-primary/20"
                  >
                    Mark as ready
                  </button>
                )}
                {selectedOrder.status === 'ready' && (selectedOrder as any).order_type === 'delivery' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'out_for_delivery')}
                    className="flex-1 py-5 bg-indigo-600 text-white rounded-full text-sm font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20"
                  >
                    Out for Delivery
                  </button>
                )}
                {selectedOrder.status === 'ready' && (selectedOrder as any).order_type !== 'delivery' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'done')}
                    className="flex-1 py-5 bg-green-500 text-white rounded-full text-sm font-black uppercase tracking-widest hover:bg-green-600 transition-all shadow-xl shadow-green-500/20"
                  >
                    Complete Fulfillment
                  </button>
                )}
                {selectedOrder.status === 'out_for_delivery' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'done')}
                    className="flex-1 py-5 bg-green-500 text-white rounded-full text-sm font-black uppercase tracking-widest hover:bg-green-600 transition-all shadow-xl shadow-green-500/20"
                  >
                    Mark Delivered
                  </button>
                )}
              </div>
              <button 
                onClick={() => updateStatus(selectedOrder.id, 'cancelled')}
                className="px-10 py-5 rounded-full text-sm font-black uppercase tracking-widest text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
