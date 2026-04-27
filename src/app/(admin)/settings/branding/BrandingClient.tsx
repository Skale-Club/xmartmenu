'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TenantSettings } from '@/types/database'

interface Props {
  settings: TenantSettings | null
  tenantId: string
  tenantSlug: string
}

export default function BrandingClient({ settings, tenantId, tenantSlug }: Props) {
  const [form, setForm] = useState({
    primary_color: settings?.primary_color ?? '#000000',
    accent_color: settings?.accent_color ?? '#FF5722',
    instagram: settings?.instagram ?? '',
    whatsapp: settings?.whatsapp ?? '',
    whatsapp_orders_enabled: settings?.whatsapp_orders_enabled ?? false,
    orders_enabled: settings?.orders_enabled ?? true,
    direct_orders_enabled: settings?.direct_orders_enabled ?? false,
  })
  const [logoUrl, setLogoUrl] = useState(settings?.logo_url ?? '')
  const [bannerUrl, setBannerUrl] = useState(settings?.banner_url ?? '')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState<'logo' | 'banner' | null>(null)
  const [saved, setSaved] = useState(false)

  const supabase = createClient()
  
  const publicMenuUrl = `${process.env.NEXT_PUBLIC_APP_URL}/${tenantSlug}`

  async function handleUpload(file: File, type: 'logo' | 'banner') {
    setUploading(type)
    const ext = file.name.split('.').pop()
    const filename = `${tenantId}/${type}.${ext}`

    const { data, error } = await supabase.storage
      .from('tenant-assets')
      .upload(filename, file, { upsert: true })

    if (!error && data) {
      const { data: { publicUrl } } = supabase.storage.from('tenant-assets').getPublicUrl(data.path)
      if (type === 'logo') setLogoUrl(publicUrl)
      else setBannerUrl(publicUrl)
    }
    setUploading(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const payload = { ...form, logo_url: logoUrl || null, banner_url: bannerUrl || null, tenant_id: tenantId }
    console.log('Saving payload:', payload)
    
    const { data: existing } = await supabase
      .from('tenant_settings')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    
    let result
    if (existing?.id) {
      result = await supabase
        .from('tenant_settings')
        .update({ ...payload, id: existing.id })
        .eq('id', existing.id)
        .select()
    } else {
      result = await supabase
        .from('tenant_settings')
        .insert(payload)
        .select()
    }
    
    const { data, error } = result
    console.log('Save result:', { data, error })
    
    if (error) {
      console.error('Error saving tenant settings:', error?.message, error?.code, error?.details, error)
      alert('Error saving: ' + (error.message ?? JSON.stringify(error)))
      setLoading(false)
      return
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">Branding</h1>
      <p className="text-sm text-zinc-500 mb-6">Customize the visual identity of your menu</p>

      <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 mb-6 text-sm flex items-center justify-between">
        <div>
          <p className="text-zinc-500">Public menu link:</p>
          <a href={publicMenuUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-900 font-medium hover:underline">{publicMenuUrl}</a>
        </div>
        <a href={publicMenuUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors flex-shrink-0 ml-4">
          View menu
        </a>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Logo */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Logo</h2>
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" /> : <span className="text-3xl">🏪</span>}
            </div>
            <div>
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'logo')}
                className="text-sm text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200" />
              {uploading === 'logo' && <p className="text-xs text-zinc-400 mt-1">Uploading...</p>}
              {logoUrl && uploading !== 'logo' && (
                <button type="button" onClick={() => setLogoUrl('')} className="text-xs text-red-500 hover:text-red-700 mt-1 block">Remove logo</button>
              )}
              <p className="text-xs text-zinc-400 mt-1">PNG or SVG recommended. Max 2MB.</p>
            </div>
          </div>
        </div>

        {/* Banner */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Menu banner</h2>
          {bannerUrl && (
            <div className="w-full h-28 rounded-xl border border-zinc-200 overflow-hidden mb-3">
              <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" />
            </div>
          )}
          <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'banner')}
            className="text-sm text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200" />
          {uploading === 'banner' && <p className="text-xs text-zinc-400 mt-1">Uploading...</p>}
          {bannerUrl && uploading !== 'banner' && (
            <button type="button" onClick={() => setBannerUrl('')} className="text-xs text-red-500 hover:text-red-700 mt-1 block">Remove banner</button>
          )}
          <p className="text-xs text-zinc-400 mt-1">Appears just below the header in the menu. 3:1 ratio recommended.</p>
        </div>

        {/* Cores */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Colors</h2>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'primary_color', label: 'Primary color (header)' },
              { key: 'accent_color', label: 'Accent color (prices)' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-sm text-zinc-600 mb-2">{field.label}</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={(form as any)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-zinc-300 cursor-pointer p-0.5" />
                  <input type="text" value={(form as any)[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Social & Ordering */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Social & ordering</h2>
          <div className="space-y-3">
            {[
              { key: 'whatsapp', label: 'WhatsApp (full number)', placeholder: '15550000000' },
              { key: 'instagram', label: 'Instagram (without @)', placeholder: 'myrestaurant' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-sm text-zinc-600 mb-1">{field.label}</label>
                <input value={(form as any)[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900" />
              </div>
            ))}
          </div>
          {/* General orders toggle */}
          <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-800">Enable orders</p>
              <p className="text-xs text-zinc-400 mt-0.5">Show all order buttons on the public menu</p>
            </div>
            <button type="button" onClick={() => setForm(f => ({ ...f, orders_enabled: !f.orders_enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.orders_enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${form.orders_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {/* WhatsApp orders toggle */}
          <div className="mt-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-800">Enable WhatsApp orders</p>
              <p className="text-xs text-zinc-400 mt-0.5">Show the "Order via WhatsApp" button on the public menu</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, whatsapp_orders_enabled: !f.whatsapp_orders_enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.whatsapp_orders_enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${form.whatsapp_orders_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {/* Direct orders toggle */}
          <div className="mt-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-800">Enable direct orders</p>
              <p className="text-xs text-zinc-400 mt-0.5">Allow customers to order directly from the menu</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, direct_orders_enabled: !f.direct_orders_enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.direct_orders_enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${form.direct_orders_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <p className="text-xs text-zinc-400 mt-3">Address and phone are managed in <a href="/settings/store" className="underline hover:text-zinc-600">Store Settings</a>.</p>
        </div>

        <button type="submit" disabled={loading}
          className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors">
          {loading ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
        </button>
      </form>
    </div>
  )
}
