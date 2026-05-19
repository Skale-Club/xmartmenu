'use client'

import { useState, useEffect } from 'react'
import { MapPin, Plus, Trash2, Edit2, X } from 'lucide-react'
import type { DeliveryZone } from '@/types/database'
import { cn } from '@/lib/utils'

interface ZoneDraft {
  name: string
  fee_cents: number
  zipcode_prefixes: string[]
  is_active: boolean
}

const EMPTY: ZoneDraft = { name: '', fee_cents: 0, zipcode_prefixes: [], is_active: true }

export default function DeliveryZonesSection() {
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [loading, setLoading] = useState(true)
  // mode: 'idle' | 'creating' | <zone-id>
  const [mode, setMode] = useState<string>('idle')
  const [draft, setDraft] = useState<ZoneDraft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [prefixInput, setPrefixInput] = useState('')

  useEffect(() => {
    fetch('/api/admin/delivery-zones')
      .then(r => r.json())
      .then(data => { setZones(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function saveNew() {
    if (!draft.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/admin/delivery-zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name.trim(), fee_cents: draft.fee_cents, zipcode_prefixes: draft.zipcode_prefixes }),
    })
    if (res.ok) {
      setZones(prev => [...prev, await res.json()])
      setMode('idle'); setDraft(EMPTY); setPrefixInput('')
    }
    setSaving(false)
  }

  async function saveEdit() {
    if (!draft.name.trim()) return
    const id = mode
    setSaving(true)
    const res = await fetch(`/api/admin/delivery-zones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name.trim(), fee_cents: draft.fee_cents, zipcode_prefixes: draft.zipcode_prefixes, is_active: draft.is_active }),
    })
    if (res.ok) {
      const zone = await res.json()
      setZones(prev => prev.map(z => z.id === id ? zone : z))
      setMode('idle'); setDraft(EMPTY); setPrefixInput('')
    }
    setSaving(false)
  }

  async function deleteZone(id: string) {
    if (!confirm('Delete this delivery zone?')) return
    const res = await fetch(`/api/admin/delivery-zones/${id}`, { method: 'DELETE' })
    if (res.ok) setZones(prev => prev.filter(z => z.id !== id))
  }

  function startEdit(zone: DeliveryZone) {
    setMode(zone.id)
    setDraft({ name: zone.name, fee_cents: zone.fee_cents, zipcode_prefixes: zone.zipcode_prefixes, is_active: zone.is_active })
    setPrefixInput('')
  }

  function cancel() { setMode('idle'); setDraft(EMPTY); setPrefixInput('') }

  function addPrefix() {
    const p = prefixInput.trim()
    if (!p || draft.zipcode_prefixes.includes(p)) return
    setDraft(d => ({ ...d, zipcode_prefixes: [...d.zipcode_prefixes, p] }))
    setPrefixInput('')
  }

  const inputCls = "w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  const labelCls = "block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1"

  const isCreating = mode === 'creating'
  const isEditing = mode !== 'idle' && mode !== 'creating'

  const zoneForm = (
    <div className="space-y-4 bg-zinc-50 border border-zinc-200 rounded-2xl p-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Zone Name</label>
          <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Downtown" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Delivery Fee</label>
          <input
            type="number" min={0} step={0.01} placeholder="0.00"
            value={(draft.fee_cents / 100).toFixed(2)}
            onChange={e => setDraft(d => ({ ...d, fee_cents: Math.round(Number(e.target.value) * 100) }))}
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Zipcode Prefixes</label>
        <div className="flex gap-2">
          <input
            value={prefixInput}
            onChange={e => setPrefixInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPrefix() } }}
            placeholder="e.g. 1010"
            className={cn(inputCls, 'flex-1')}
          />
          <button type="button" onClick={addPrefix} className="px-4 py-3 bg-zinc-950 text-white rounded-xl text-sm font-black hover:bg-primary hover:text-zinc-950 transition-all">
            Add
          </button>
        </div>
        {draft.zipcode_prefixes.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {draft.zipcode_prefixes.map(p => (
              <span key={p} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-xs font-black rounded-full">
                {p}
                <button type="button" onClick={() => setDraft(d => ({ ...d, zipcode_prefixes: d.zipcode_prefixes.filter(x => x !== p) }))} className="hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-[10px] font-medium text-zinc-400 ml-1 mt-2">Prefix "1010" matches any zipcode starting with 1010</p>
      </div>
      {isEditing && (
        <div
          className="flex items-center justify-between p-4 rounded-xl bg-white border border-zinc-200 cursor-pointer"
          onClick={() => setDraft(d => ({ ...d, is_active: !d.is_active }))}
        >
          <span className="text-sm font-black text-zinc-700">Active</span>
          <button
            type="button"
            className={cn("relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none", draft.is_active ? "bg-primary" : "bg-zinc-200")}
          >
            <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300", draft.is_active ? "translate-x-4" : "translate-x-1")} />
          </button>
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={isCreating ? saveNew : saveEdit} disabled={!draft.name.trim() || saving}
          className="px-6 py-3 bg-zinc-950 text-white rounded-full text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-zinc-950 transition-all disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Zone'}
        </button>
        <button type="button" onClick={cancel}
          className="px-6 py-3 border border-zinc-200 text-zinc-600 rounded-full text-xs font-black uppercase tracking-widest hover:bg-zinc-50 transition-all">
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className={labelCls}>Delivery Zones</label>
        {mode === 'idle' && (
          <button type="button" onClick={() => { setMode('creating'); setDraft(EMPTY); setPrefixInput('') }}
            className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-zinc-950 text-white rounded-full hover:bg-primary hover:text-zinc-950 transition-all">
            <Plus className="w-3 h-3" /> New Zone
          </button>
        )}
      </div>

      {loading && <p className="text-xs text-zinc-400 font-medium">Loading zones...</p>}
      {isCreating && zoneForm}
      {zones.length === 0 && !loading && !isCreating && (
        <p className="text-xs text-zinc-400 font-medium py-2">No delivery zones configured — using the flat fee above. Add zones to set different fees by area.</p>
      )}

      <div className="space-y-3">
        {zones.map(zone => (
          isEditing && mode === zone.id ? (
            <div key={zone.id}>{zoneForm}</div>
          ) : (
            <div key={zone.id} className="flex items-center gap-4 bg-zinc-50 border border-zinc-200 rounded-xl px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-black text-zinc-950">{zone.name}</p>
                  {!zone.is_active && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-zinc-200 text-zinc-500 rounded-full">Inactive</span>}
                </div>
                <div className="flex items-center gap-4 text-[10px] font-bold text-zinc-500">
                  <span>Fee: R$ {(zone.fee_cents / 100).toFixed(2)}</span>
                  {zone.zipcode_prefixes.length > 0 && (
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{zone.zipcode_prefixes.join(', ')}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => startEdit(zone)} className="p-2 hover:bg-white rounded-lg transition-all text-zinc-400 hover:text-zinc-900">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => deleteZone(zone.id)} className="p-2 hover:bg-red-50 rounded-lg transition-all text-zinc-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  )
}
