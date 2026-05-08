'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderItem } from '@/types/database'
import { useElapsedTime } from './useElapsedTime'
import { Bell, BellOff, LayoutGrid, List, MessageSquare } from 'lucide-react'

type OrderWithItems = Order & { order_items: OrderItem[] }

const STATUS_COLORS: Record<string, {
  border: string
  bg: string
  badge: string
  label: string
}> = {
  pending:   { border: 'border-l-blue-500',   bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-800',    label: 'Pendente' },
  preparing: { border: 'border-l-yellow-500', bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800', label: 'Em preparo' },
  ready:     { border: 'border-l-green-500',  bg: 'bg-green-50',  badge: 'bg-green-100 text-green-800',   label: 'Pronto' },
  done:      { border: 'border-l-zinc-400',   bg: 'bg-zinc-50',   badge: 'bg-zinc-100 text-zinc-600',     label: 'Concluído' },
  cancelled: { border: 'border-l-red-500',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-800',       label: 'Cancelado' },
}

const NEXT_STATUS: Record<string, string | null> = {
  pending:   'preparing',
  preparing: 'ready',
  ready:     'done',
  done:      null,
  cancelled: null,
}

const ADVANCE_LABEL: Record<string, string> = {
  pending:   'Iniciar preparo',
  preparing: 'Marcar pronto',
  ready:     'Concluir',
}

const KDS_VIEW_KEY    = (tenantId: string) => `kds_view_${tenantId}`
const KDS_FILTER_KEY  = (tenantId: string) => `kds_filter_${tenantId}`
const KDS_MUTE_KEY    = (tenantId: string) => `kds_mute_${tenantId}`

type FilterValue = 'active' | 'pending' | 'preparing' | 'ready' | 'all'

const FILTER_CHIPS: { value: FilterValue; label: string }[] = [
  { value: 'active',    label: 'Ativos' },      // pending + preparing (default)
  { value: 'pending',   label: 'Pendentes' },
  { value: 'preparing', label: 'Em preparo' },
  { value: 'ready',     label: 'Prontos' },
  { value: 'all',       label: 'Todos' },
]

const DEFAULT_FILTER: FilterValue = 'active'

interface OrdersClientProps {
  initialOrders: OrderWithItems[]
  tenantId: string
  amberThreshold: number
  redThreshold: number
}

function OrderCard({
  order,
  loadingId,
  onAdvance,
  onCancel,
  amberMinutes,
  redMinutes,
}: {
  order: OrderWithItems
  loadingId: string | null
  onAdvance: (id: string, status: string) => void
  onCancel: (id: string) => void
  amberMinutes: number
  redMinutes: number
}) {
  const { minutes, chipClass } = useElapsedTime(order.created_at, amberMinutes, redMinutes)
  const colors = STATUS_COLORS[order.status] ?? STATUS_COLORS['pending']
  const nextStatus = NEXT_STATUS[order.status]
  const isLoading = loadingId === order.id

  return (
    <div className={`rounded-lg border border-zinc-200 border-l-4 ${colors.border} ${colors.bg} p-4 flex flex-col gap-3`}>
      {/* Header: ID + status badge */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-500">#{order.id.slice(0, 8)}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}>
          {colors.label}
        </span>
      </div>

      {/* Customer */}
      <div>
        <p className="text-sm font-semibold text-zinc-900">{order.customer_name}</p>
        <p className="text-xs text-zinc-500">{order.customer_phone}</p>
      </div>

      {/* Items summary */}
      <ul className="text-xs text-zinc-700 space-y-0.5">
        {order.order_items.map((item, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span>{item.quantity}x {item.product_name}</span>
            {item.notes && (
              <span className="text-xs text-zinc-500 italic flex items-center gap-1">
                <MessageSquare size={10} className="flex-shrink-0" />
                {item.notes}
              </span>
            )}
            {item.ingredient_modifications && (() => {
              const mods = item.ingredient_modifications
              const hasAny =
                mods.removed.length > 0 || mods.extras.length > 0 || mods.added.length > 0
              if (!hasAny) return null
              return (
                <span className="flex flex-col gap-0.5 mt-0.5">
                  {mods.removed.map(r => (
                    <span key={r.ingredient_id} className="text-xs text-red-600 line-through">
                      SEM {r.name}
                    </span>
                  ))}
                  {mods.extras.map(e => (
                    <span key={e.ingredient_id} className="text-xs text-amber-600">
                      +{e.qty} {e.name}
                    </span>
                  ))}
                  {mods.added.map(a => (
                    <span key={a.ingredient_id} className="text-xs text-green-600">
                      +{a.qty} {a.name}
                    </span>
                  ))}
                </span>
              )
            })()}
          </li>
        ))}
      </ul>

      {/* Footer: total + elapsed-time chip */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-zinc-200">
        <span className="text-sm font-bold text-zinc-900">R$ {order.total.toFixed(2)}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${chipClass}`}>
          {minutes}min
        </span>
      </div>

      {/* Actions — advance button + cancel */}
      {nextStatus && (
        <button
          onClick={() => onAdvance(order.id, nextStatus)}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
        >
          {isLoading ? '...' : ADVANCE_LABEL[order.status]}
        </button>
      )}
      {(order.status === 'pending' || order.status === 'preparing') && (
        <button
          onClick={() => onCancel(order.id)}
          disabled={isLoading}
          className="w-full text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      )}
    </div>
  )
}

export default function OrdersClient({ initialOrders, tenantId, amberThreshold, redThreshold }: OrdersClientProps) {
  const [orders, setOrders] = useState(initialOrders)
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  // view toggle state — persisted to localStorage per tenant
  const [view, setView] = useState<'grid' | 'list'>('grid')
  // filter chips — default shows pending + preparing (one active chip, mutually exclusive)
  const [activeFilter, setActiveFilter] = useState<FilterValue>(DEFAULT_FILTER)
  // mute state — persisted to localStorage per tenant
  const [muted, setMuted] = useState(false)
  // lazy AudioContext ref — created on first user interaction to satisfy browser autoplay policy
  const audioCtxRef = useRef<AudioContext | null>(null)
  // mutedRef mirrors muted state so Realtime closure reads current value without re-subscribing
  const mutedRef = useRef(false)
  const supabase = createClient()

  // SSR-safe: read saved view preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(KDS_VIEW_KEY(tenantId))
    if (saved === 'grid' || saved === 'list') setView(saved)
  }, [tenantId])

  // SSR-safe: restore active filter from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(KDS_FILTER_KEY(tenantId))
    if (saved === 'pending' || saved === 'preparing' || saved === 'ready' || saved === 'all') {
      setActiveFilter(saved)
    }
  }, [tenantId])

  // SSR-safe: restore muted state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(KDS_MUTE_KEY(tenantId))
    if (saved === 'true') setMuted(true)
  }, [tenantId])

  // Keep mutedRef in sync with muted state so Realtime closure reads current value
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  // Beep via Web Audio API — oscillator at 880Hz for 0.1s
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
    } catch {
      // AudioContext creation may fail in non-interactive contexts — ignore silently
    }
  }

  // Realtime subscription — primary path for KDS-06
  // KDS-12: beep fires only on INSERT of pending orders (not status updates)
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
          // Pitfall 1: payload.new does NOT include order_items — must fetch full order
          const { data: fullOrder } = await supabase
            .from('orders')
            .select('*, order_items(*)')
            .eq('id', (payload.new as { id: string }).id)
            .single()
          if (fullOrder) {
            setOrders((prev) => {
              // Idempotent: ignore if already present (handles polling race)
              if (prev.some((o) => o.id === fullOrder.id)) return prev
              return [fullOrder as OrderWithItems, ...prev]
            })
            // KDS-12: beep only for new pending orders; check muted via ref to avoid stale closure
            const newOrder = fullOrder as OrderWithItems
            if (newOrder.status === 'pending' && !mutedRef.current) {
              playBeep()
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tenantId, supabase])

  // Polling fallback — 15s safety net covers Realtime gaps and status refreshes
  useEffect(() => {
    const id = setInterval(async () => {
      const res = await fetch(`/api/orders?tenant_id=${tenantId}`)
      if (res.ok) {
        const data = await res.json()
        setOrders(data.orders)
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

  // KDS-10: filter applied locally; 'active' = pending+preparing (default); 'all' = everything
  const filteredOrders = activeFilter === 'all'
    ? orders
    : activeFilter === 'active'
      ? orders.filter((o) => o.status === 'pending' || o.status === 'preparing')
      : orders.filter((o) => o.status === activeFilter)

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
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-zinc-900">Pedidos</h1>
        <div className="flex items-center gap-3">
          <p className="text-sm text-zinc-500">
            {filteredOrders.length !== orders.length
              ? `${filteredOrders.length} / ${orders.length} pedido(s)`
              : `${orders.length} pedido(s)`}
          </p>
          {/* KDS-13: mute/unmute button */}
          <button
            onClick={toggleMute}
            className={`p-1.5 rounded-lg border border-zinc-200 ${muted ? 'text-zinc-400 hover:text-zinc-600' : 'text-zinc-700 hover:text-zinc-900'}`}
            aria-label={muted ? 'Ativar som' : 'Silenciar som'}
            title={muted ? 'Som silenciado — clique para ativar' : 'Som ativo — clique para silenciar'}
          >
            {muted ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-0.5">
            <button
              onClick={() => toggleView('grid')}
              className={`p-1.5 rounded ${view === 'grid' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'}`}
              aria-label="Visualização em grade"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => toggleView('list')}
              className={`p-1.5 rounded ${view === 'list' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'}`}
              aria-label="Visualização em lista"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* KDS-10: filter chips — mutually exclusive, default pending */}
      <div className="flex items-center gap-2 mb-6">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.value}
            onClick={() => selectFilter(chip.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              activeFilter === chip.value
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500 hover:text-zinc-900'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          {orders.length === 0 ? 'Nenhum pedido ainda' : 'Nenhum pedido com este filtro'}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              loadingId={loadingId}
              onAdvance={(id, status) => updateStatus(id, status)}
              onCancel={(id) => updateStatus(id, 'cancelled')}
              amberMinutes={amberThreshold}
              redMinutes={redThreshold}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Telefone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Itens</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Total</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className="hover:bg-zinc-50 cursor-pointer"
                  onClick={() => setSelectedOrder(order)}
                >
                  <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{order.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-900">{order.customer_name}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{order.customer_phone}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">
                    {(order.order_items?.length ?? 0) === 1
                      ? '1 item'
                      : `${order.order_items?.length ?? 0} itens`}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-900 font-medium">R$ {order.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]?.badge}`}>
                      {STATUS_COLORS[order.status]?.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedOrder(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Detalhes do Pedido</h2>
              <button onClick={() => setSelectedOrder(null)} className="text-zinc-400 hover:text-zinc-600">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Cliente</p>
                <p className="text-zinc-900">{selectedOrder.customer_name}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Telefone</p>
                <p className="text-zinc-900">{selectedOrder.customer_phone}</p>
              </div>
              {selectedOrder.notes && (
                <div>
                  <p className="text-xs text-zinc-500 uppercase mb-1">Observações</p>
                  <p className="text-sm text-zinc-700">{selectedOrder.notes}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Itens</p>
                <div className="space-y-2">
                  {selectedOrder.order_items?.map((item, idx) => (
                    <div key={idx} className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-700">{item.quantity}x {item.product_name}</span>
                        <span className="text-zinc-900 font-medium">R$ {(item.unit_price * item.quantity).toFixed(2)}</span>
                      </div>
                      {item.selected_options &&
                        typeof item.selected_options === 'object' &&
                        Object.keys(item.selected_options).length > 0 && (
                          <span className="text-xs text-zinc-500">
                            {Object.values(item.selected_options as Record<string, unknown>)
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      {item.notes && (
                        <span className="text-xs text-zinc-500 italic flex items-center gap-1 mt-0.5">
                          <MessageSquare size={10} className="flex-shrink-0" />
                          {item.notes}
                        </span>
                      )}
                      {item.ingredient_modifications && (() => {
                        const mods = item.ingredient_modifications
                        const hasAny =
                          mods.removed.length > 0 || mods.extras.length > 0 || mods.added.length > 0
                        if (!hasAny) return null
                        return (
                          <span className="flex flex-col gap-0.5 mt-0.5">
                            {mods.removed.map(r => (
                              <span key={r.ingredient_id} className="text-xs text-red-600 line-through">
                                SEM {r.name}
                              </span>
                            ))}
                            {mods.extras.map(e => (
                              <span key={e.ingredient_id} className="text-xs text-amber-600">
                                +{e.qty} {e.name}
                              </span>
                            ))}
                            {mods.added.map(a => (
                              <span key={a.ingredient_id} className="text-xs text-green-600">
                                +{a.qty} {a.name}
                              </span>
                            ))}
                          </span>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-zinc-200 pt-3 flex justify-between">
                <span className="font-semibold text-zinc-900">Total</span>
                <span className="font-bold text-zinc-900">R$ {selectedOrder.total.toFixed(2)}</span>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Status</p>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[selectedOrder.status]?.badge}`}>
                  {STATUS_COLORS[selectedOrder.status]?.label}
                </span>
              </div>
              <div className="flex gap-2 pt-2">
                {selectedOrder.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'preparing')}
                    disabled={loadingId === selectedOrder.id}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Iniciar preparo
                  </button>
                )}
                {selectedOrder.status === 'preparing' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'ready')}
                    disabled={loadingId === selectedOrder.id}
                    className="flex-1 px-3 py-2 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 disabled:opacity-50"
                  >
                    Marcar pronto
                  </button>
                )}
                {selectedOrder.status === 'ready' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'done')}
                    disabled={loadingId === selectedOrder.id}
                    className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    Concluir
                  </button>
                )}
                {(selectedOrder.status === 'pending' || selectedOrder.status === 'preparing') && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'cancelled')}
                    disabled={loadingId === selectedOrder.id}
                    className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
