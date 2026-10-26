'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { notifyPublicMenuChanged } from '@/lib/menu/revalidate-client'
import { Plus, Trash2, ChevronUp, ChevronDown, Link2, QrCode, Check } from 'lucide-react'
import { tableMenuUrl } from '@/lib/service-modes'
import type { RestaurantTable } from '@/types/database'

interface Props {
  tenantId: string
  tenantSlug?: string
  /** Guests can order from table links (self-service plan). */
  tableLinksEnabled?: boolean
}

export default function TablesSection({ tenantId, tenantSlug, tableLinksEnabled = false }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // The table's own menu link: printed as a QR code or written to an NFC tag.
  // Orders placed from it arrive marked with this table.
  function linkFor(table: RestaurantTable): string | null {
    if (!tenantSlug || typeof window === 'undefined') return null
    return tableMenuUrl(`${window.location.origin}/${tenantSlug}`, table.id)
  }

  async function copyLink(table: RestaurantTable) {
    const url = linkFor(table)
    if (!url) return
    await navigator.clipboard.writeText(url).catch(() => {})
    setCopiedId(table.id)
    setTimeout(() => setCopiedId(current => (current === table.id ? null : current)), 2000)
  }

  async function downloadQr(table: RestaurantTable) {
    const url = linkFor(table)
    if (!url) return
    const QRCode = (await import('qrcode')).default
    const dataUrl = await QRCode.toDataURL(url, { width: 800, margin: 2, errorCorrectionLevel: 'M' })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${table.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'table'}-qr.png`
    a.click()
  }
const supabase = createClient()
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    const { data } = await supabase
      .from('restaurant_tables')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('position')
    setTables((data ?? []) as RestaurantTable[])
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setAdding(true)
    setError(null)
    const nextPos = tables.length > 0 ? Math.max(...tables.map(t => t.position)) + 1 : 0
    const { data: inserted, error: err } = await supabase
      .from('restaurant_tables')
      .insert({ tenant_id: tenantId, name: newName.trim(), position: nextPos })
      .select()
      .single()
    if (err) { setError(err.message) } else if (inserted) {
      notifyPublicMenuChanged()
      setTables(prev => [...prev, inserted as RestaurantTable])
      setNewName('')
    }
    setAdding(false)
  }

  async function handleDelete(id: string) {
    const { error: delError } = await supabase.from('restaurant_tables').delete().eq('id', id)
    if (!delError) notifyPublicMenuChanged()
    setTables(prev => prev.filter(t => t.id !== id))
  }

  async function handleMove(table: RestaurantTable, direction: 'up' | 'down') {
    const sorted = [...tables].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex(t => t.id === table.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const current = sorted[idx]
    const swap = sorted[swapIdx]
    const results = await Promise.all([
      supabase.from('restaurant_tables').update({ position: swap.position }).eq('id', current.id),
      supabase.from('restaurant_tables').update({ position: current.position }).eq('id', swap.id),
    ])
    if (results.every(r => !r.error)) notifyPublicMenuChanged()
    setTables(prev =>
      prev.map(t => {
        if (t.id === current.id) return { ...t, position: swap.position }
        if (t.id === swap.id) return { ...t, position: current.position }
        return t
      })
    )
  }

  const sorted = [...tables].sort((a, b) => a.position - b.position)

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Tables</p>
      <p className="text-xs text-zinc-500">
        {tableLinksEnabled
          ? 'Each table has its own menu link. Print its QR code or write the link to an NFC tag on the table: guests ordering from it are served at that table, and the order shows the table name.'
          : 'Tables used by the waiter app. Table links for guests to order (QR / NFC) come with the Menu + Payments plan.'}
      </p>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((table, idx) => (
            <div key={table.id} className="flex items-center gap-2 bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3">
              <span className="flex-1 text-sm font-semibold text-zinc-900">{table.name}</span>
              {tableLinksEnabled && tenantSlug && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => copyLink(table)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200"
                    aria-label={`Copy the menu link for ${table.name}`}
                  >
                    {copiedId === table.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Link2 className="w-3.5 h-3.5" />}
                    {copiedId === table.id ? 'Copied' : 'Link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadQr(table)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-200"
                    aria-label={`Download the QR code for ${table.name}`}
                  >
                    <QrCode className="w-3.5 h-3.5" /> QR
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => handleMove(table, 'up')}
                  className="p-1.5 rounded hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                >
                  <ChevronUp className="w-4 h-4 text-zinc-500" />
                </button>
                <button
                  type="button"
                  disabled={idx === sorted.length - 1}
                  onClick={() => handleMove(table, 'down')}
                  className="p-1.5 rounded hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                >
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(table.id)}
                  className="p-1.5 rounded hover:bg-red-100 text-zinc-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {tables.length === 0 && (
            <p className="text-sm text-zinc-400 italic">No tables yet. Add your first table below.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
          placeholder="Table name (e.g. Mesa 1, Bar 2)"
          className="flex-1 px-4 py-2 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        <button
          type="button"
          disabled={adding || !newName.trim()}
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white text-sm font-semibold rounded-xl hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
    </div>
  )
}
