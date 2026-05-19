'use client'

import { useState } from 'react'
import { MapPin, Plus, Pencil, Building2, ToggleLeft, ToggleRight, AlertCircle, X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Location } from '@/types/database'

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

const EMPTY_HOURS = Object.fromEntries(DAYS.map(d => [d.key, '']))

const inputClassName = "w-full px-5 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
const labelClassName = "block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1"

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface FormState {
  name: string
  slug: string
  address: string
  city: string
  phone: string
  hours: Record<string, string>
}

const EMPTY_FORM: FormState = { name: '', slug: '', address: '', city: '', phone: '', hours: { ...EMPTY_HOURS } }

function LocationModal({
  open, title, form, setForm, loading, error, onClose, onSave,
}: {
  open: boolean
  title: string
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  loading: boolean
  error: string | null
  onClose: () => void
  onSave: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-[1.5rem] w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-8 py-6 border-b border-zinc-100">
          <h2 className="text-lg font-black text-zinc-950 tracking-tight">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-8 py-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-3 text-sm font-bold text-red-600 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClassName}>Branch Name</label>
              <input
                value={form.name}
                onChange={e => {
                  const name = e.target.value
                  setForm(f => ({ ...f, name, slug: f.slug || slugify(name) }))
                }}
                placeholder="Downtown, Airport, Zona Sul..."
                className={inputClassName}
              />
            </div>

            <div className="col-span-2">
              <label className={labelClassName}>URL Slug</label>
              <input
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                placeholder="downtown"
                className={inputClassName}
              />
              <p className="text-[10px] font-medium text-zinc-400 mt-1 ml-1">Lowercase letters, numbers and hyphens only</p>
            </div>

            <div>
              <label className={labelClassName}>Address</label>
              <input
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="123 Main St"
                className={inputClassName}
              />
            </div>

            <div>
              <label className={labelClassName}>City</label>
              <input
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="São Paulo"
                className={inputClassName}
              />
            </div>

            <div className="col-span-2">
              <label className={labelClassName}>Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+55 (11) 99999-0000"
                className={inputClassName}
              />
            </div>
          </div>

          {/* Business hours */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-zinc-400" />
              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Business Hours</span>
            </div>
            <div className="space-y-2">
              {DAYS.map(day => (
                <div key={day.key} className="flex items-center gap-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 w-20 shrink-0">{day.label}</span>
                  <input
                    value={form.hours[day.key] ?? ''}
                    onChange={e => setForm(f => ({ ...f, hours: { ...f.hours, [day.key]: e.target.value } }))}
                    placeholder="Closed"
                    className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-900 font-medium placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                  />
                </div>
              ))}
              <p className="text-[10px] font-medium text-zinc-400 ml-1">Example: 09:00 - 22:00</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-5 border-t border-zinc-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-full border border-zinc-200 text-sm font-black text-zinc-500 hover:bg-zinc-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={loading}
            className="flex-1 py-3 rounded-full bg-primary text-zinc-950 text-sm font-black hover:bg-zinc-950 hover:text-white transition-all disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Location'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LocationsClient({ initialLocations, tenantId }: {
  initialLocations: Location[]
  tenantId: string
}) {
  const [locations, setLocations] = useState<Location[]>(initialLocations)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowModal(true)
  }

  function openEdit(loc: Location) {
    setEditingId(loc.id)
    setForm({
      name: loc.name,
      slug: loc.slug,
      address: loc.address ?? '',
      city: loc.city ?? '',
      phone: loc.phone ?? '',
      hours: { ...EMPTY_HOURS, ...(loc.business_hours ?? {}) },
    })
    setError(null)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setError(null)
  }

  async function handleSave() {
    setLoading(true)
    setError(null)

    const filteredHours = Object.fromEntries(
      Object.entries(form.hours).filter(([, v]) => v.trim() !== '')
    )

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      phone: form.phone.trim() || null,
      business_hours: Object.keys(filteredHours).length > 0 ? filteredHours : null,
    }

    const url = editingId ? `/api/admin/locations/${editingId}` : '/api/admin/locations'
    const method = editingId ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to save location')
      setLoading(false)
      return
    }

    if (editingId) {
      setLocations(prev => prev.map(l => l.id === editingId ? data : l))
    } else {
      setLocations(prev => [...prev, data])
    }

    setLoading(false)
    closeModal()
  }

  async function handleToggleActive(loc: Location) {
    setTogglingId(loc.id)
    const res = await fetch(`/api/admin/locations/${loc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !loc.is_active }),
    })
    const data = await res.json()
    if (res.ok) {
      setLocations(prev => prev.map(l => l.id === loc.id ? data : l))
    }
    setTogglingId(null)
  }

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Administration</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Locations</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Manage your restaurant branches and locations</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-zinc-950 rounded-full text-sm font-black uppercase tracking-widest hover:bg-zinc-950 hover:text-white transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Location
        </button>
      </div>

      {/* Empty state */}
      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-zinc-50 rounded-[1.5rem] border border-dashed border-zinc-200">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6">
            <MapPin className="w-10 h-10 text-zinc-200" />
          </div>
          <h3 className="text-xl font-black text-zinc-950 mb-2">No locations yet</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto font-medium mb-8">
            Add your first branch location to start managing multiple venues.
          </p>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-8 py-4 bg-primary text-zinc-950 rounded-full text-sm font-black uppercase tracking-widest hover:bg-zinc-950 hover:text-white transition-all"
          >
            <Plus className="w-4 h-4" />
            Add Location
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {locations.map(loc => (
            <div
              key={loc.id}
              className={cn(
                "bg-white border rounded-[1.25rem] p-8 space-y-4 shadow-sm transition-all",
                loc.is_active ? "border-zinc-100" : "border-zinc-200 opacity-60"
              )}
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-zinc-950 tracking-tight">{loc.name}</h3>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">/{loc.slug}</p>
                  </div>
                </div>
                <span className={cn(
                  "shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  loc.is_active ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"
                )}>
                  {loc.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Details */}
              <div className="space-y-1.5 text-sm text-zinc-500 font-medium">
                {(loc.address || loc.city) && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-zinc-300" />
                    <span className="truncate">{[loc.address, loc.city].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {loc.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300 text-xs">📞</span>
                    <span>{loc.phone}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-zinc-50">
                <button
                  onClick={() => openEdit(loc)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-zinc-200 text-xs font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-50 transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  onClick={() => handleToggleActive(loc)}
                  disabled={togglingId === loc.id}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50",
                    loc.is_active
                      ? "border-red-100 text-red-500 hover:bg-red-50"
                      : "border-green-100 text-green-600 hover:bg-green-50"
                  )}
                >
                  {loc.is_active ? <ToggleLeft className="w-3.5 h-3.5" /> : <ToggleRight className="w-3.5 h-3.5" />}
                  {loc.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <LocationModal
        open={showModal}
        title={editingId ? 'Edit Location' : 'Add Location'}
        form={form}
        setForm={setForm}
        loading={loading}
        error={error}
        onClose={closeModal}
        onSave={handleSave}
      />
    </div>
  )
}
