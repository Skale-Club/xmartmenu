'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderItem } from '@/types/database'

type OrderWithItems = Order & { order_items: OrderItem[] }

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

interface OrdersClientProps {
  initialOrders: OrderWithItems[]
}

export default function OrdersClient({ initialOrders }: OrdersClientProps) {
  const [orders, setOrders] = useState(initialOrders)
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function updateStatus(orderId: string, status: string) {
    setLoading(true)
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
        setSelectedOrder({ ...selectedOrder, status: data.status })
      }
    }
    setLoading(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Orders</h1>
        <p className="text-sm text-zinc-500">{orders.length} order(s)</p>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">No orders yet</div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Total</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="hover:bg-zinc-50 cursor-pointer"
                  onClick={() => setSelectedOrder(order)}
                >
                  <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{order.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-900">{order.customer_name}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{order.customer_phone}</td>
                  <td className="px-4 py-3 text-sm text-zinc-900 font-medium">R$ {order.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
                      {order.status}
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
              <h2 className="font-semibold text-zinc-900">Order Details</h2>
              <button onClick={() => setSelectedOrder(null)} className="text-zinc-400 hover:text-zinc-600">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Customer</p>
                <p className="text-zinc-900">{selectedOrder.customer_name}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Phone</p>
                <p className="text-zinc-900">{selectedOrder.customer_phone}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase mb-1">Items</p>
                <div className="space-y-2">
                  {selectedOrder.order_items?.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-zinc-700">{item.quantity}x {item.product_name}</span>
                      <span className="text-zinc-900 font-medium">R$ {(item.unit_price * item.quantity).toFixed(2)}</span>
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
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedOrder.status]}`}>
                  {selectedOrder.status}
                </span>
              </div>
              <div className="flex gap-2 pt-2">
                {selectedOrder.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'confirmed')}
                    disabled={loading}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                )}
                {selectedOrder.status === 'confirmed' && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'completed')}
                    disabled={loading}
                    className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    Complete
                  </button>
                )}
                {(selectedOrder.status === 'pending' || selectedOrder.status === 'confirmed') && (
                  <button
                    onClick={() => updateStatus(selectedOrder.id, 'cancelled')}
                    disabled={loading}
                    className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    Cancel
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