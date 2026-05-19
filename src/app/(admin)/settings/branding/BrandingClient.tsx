'use client'

import { useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { getInitials } from '@/lib/utils'
import type { TenantSettings } from '@/types/database'
import { Palette, ExternalLink, Camera, Image as ImageIcon, Share2, MessageCircle, Instagram, ShoppingBag, CheckCircle2, AlertCircle, Save, Info, Type } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  settings: TenantSettings | null
  tenantId: string
  tenantSlug: string
  tenantName: string
}

const CUISINE_PRESETS = [
  { name: 'Pizza',     primary: '#E74C3C', accent: '#FFFFFF' },
  { name: 'Japanese',  primary: '#C0392B', accent: '#1A1A1A' },
  { name: 'Burger',    primary: '#F39C12', accent: '#2C3E50' },
  { name: 'Cafe',      primary: '#6F4E37', accent: '#FDF5E6' },
  { name: 'Churrasco', primary: '#27AE60', accent: '#F39C12' },
  { name: 'Default',   primary: '#EEFF00', accent: '#09090b' },
]

export default function BrandingClient({ settings, tenantId, tenantSlug, tenantName }: Props) {
  const [form, setForm] = useState({
    primary_color: settings?.primary_color ?? '#000000',
    accent_color: settings?.accent_color ?? '#FF5722',
    instagram: settings?.instagram ?? '',
    whatsapp: settings?.whatsapp ?? '',
    whatsapp_orders_enabled: settings?.whatsapp_orders_enabled ?? false,
    orders_enabled: settings?.orders_enabled ?? true,
    direct_orders_enabled: settings?.direct_orders_enabled ?? false,
    tagline: settings?.tagline ?? '',
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
    
    const { error } = result
    
    if (error) {
      console.error('Error saving tenant settings:', error)
      alert('Error saving settings')
      setLoading(false)
      return
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setLoading(false)
  }

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  const labelClassName = "block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1"

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Palette className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Identity</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Branding</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Define the visual DNA of your digital menu</p>
        </div>
      </div>

      {/* Public Link Card */}
      <div className="bg-zinc-950 rounded-lg p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -mr-32 -mt-32 transition-opacity group-hover:opacity-100 opacity-50" />
        <div className="relative z-10">
          <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-2">Live Public Menu</p>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/5 rounded-lg border border-white/10">
              <Share2 className="w-5 h-5 text-zinc-400" />
            </div>
            <div>
              <p className="text-lg font-black text-white tracking-tight leading-tight">{publicMenuUrl}</p>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Your unique gateway</p>
            </div>
          </div>
        </div>
        <a href={publicMenuUrl} target="_blank" rel="noopener noreferrer"
          className="relative z-10 bg-primary text-primary-foreground px-10 py-5 rounded-full text-sm font-black hover:bg-white transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest shadow-lg shadow-primary/20 shrink-0">
          <ExternalLink className="w-4 h-4" />
          Preview Live
        </a>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="space-y-10">
          {/* Logo & Banner */}
          <div className="bg-white border border-zinc-100 rounded-lg p-10 space-y-10 shadow-sm">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Logotype</h2>
              </div>
              <div className="flex items-center gap-8">
                <div className="w-32 h-32 rounded-sm border border-zinc-100 bg-zinc-50 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-inner group relative">
                  {logoUrl ? (
                    <Image src={logoUrl} alt="Logo" width={128} height={128} className="object-contain" />
                  ) : (
                    <span className="text-3xl font-black tracking-tighter text-zinc-300">{getInitials(tenantName)}</span>
                  )}
                  {uploading === 'logo' && <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm flex items-center justify-center text-[10px] text-white font-black uppercase tracking-widest">Uploading...</div>}
                </div>
                <div className="flex-1 space-y-4">
                  <input 
                    type="file" 
                    id="logo-upload"
                    accept="image/*" 
                    onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'logo')}
                    className="hidden" 
                  />
                  <label htmlFor="logo-upload" className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-950 text-white rounded-lg text-xs font-black uppercase tracking-widest cursor-pointer hover:bg-primary hover:text-zinc-950 transition-all shadow-lg shadow-zinc-950/10">
                    Choose Logo
                  </label>
                  {logoUrl && (
                    <button type="button" onClick={() => setLogoUrl('')} className="block text-[10px] font-black text-red-500 uppercase tracking-widest hover:text-red-700 transition-colors ml-1">Remove Asset</button>
                  )}
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-2 leading-relaxed">PNG or SVG · 1:1 Aspect · Max 2MB</p>
                </div>
              </div>
            </div>

            <div className="pt-10 border-t border-zinc-50">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Hero Banner</h2>
              </div>
              {bannerUrl && (
                <div className="relative w-full h-40 rounded-sm border border-zinc-100 overflow-hidden mb-6 shadow-md group">
                  <Image src={bannerUrl} alt="Banner" fill sizes="100vw" className="object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/40 to-transparent" />
                </div>
              )}
              <div className="flex items-center gap-4">
                <input 
                  type="file" 
                  id="banner-upload"
                  accept="image/*" 
                  onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'banner')}
                  className="hidden" 
                />
                <label htmlFor="banner-upload" className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-50 text-zinc-950 border border-zinc-200 rounded-lg text-xs font-black uppercase tracking-widest cursor-pointer hover:bg-zinc-100 transition-all">
                  Change Banner
                </label>
                {bannerUrl && (
                  <button type="button" onClick={() => setBannerUrl('')} className="text-[10px] font-black text-red-500 uppercase tracking-widest hover:text-red-700 transition-colors">Delete Banner</button>
                )}
              </div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-4 leading-relaxed">3:1 Aspect recommended for optimal display on mobile devices.</p>
            </div>
          </div>

          {/* Tagline */}
          <div className="bg-white border border-zinc-100 rounded-lg p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Type className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">Tagline</h2>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-0.5">Shown on your public menu below the restaurant name</p>
              </div>
            </div>
            <label className={labelClassName}>Description</label>
            <input
              type="text"
              value={form.tagline}
              onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
              placeholder="e.g. Italian restaurant · Wood-fired oven · Great wine"
              maxLength={120}
              className={inputClassName}
            />
            <p className="text-[9px] font-medium text-zinc-400 mt-2 ml-1">Use · to separate descriptors. Keep it under 80 characters for best display.</p>
          </div>

          {/* Colors */}
          <div className="bg-white border border-zinc-100 rounded-lg p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Palette className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Color Palette</h2>
            </div>

            {/* Preset chips */}
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Quick Presets</p>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 mb-6">
              {CUISINE_PRESETS.map(preset => {
                const isSelected = form.primary_color === preset.primary && form.accent_color === preset.accent
                return (
                  <button
                    key={preset.name}
                    type="button"
                    aria-label={`Apply ${preset.name} palette`}
                    onClick={() => setForm(f => ({ ...f, primary_color: preset.primary, accent_color: preset.accent }))}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all active:scale-95 min-w-[56px]',
                      isSelected
                        ? 'border-zinc-900 bg-zinc-50'
                        : 'border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50'
                    )}
                  >
                    <div
                      aria-hidden="true"
                      className="w-8 h-8 rounded-full border border-zinc-200 shadow-sm flex-shrink-0"
                      style={{ backgroundColor: preset.primary }}
                    />
                    <span className={cn(
                      'text-[10px] font-black uppercase tracking-widest whitespace-nowrap',
                      isSelected ? 'text-zinc-900' : 'text-zinc-500'
                    )}>
                      {preset.name}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-zinc-100 mb-8" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              {[
                { key: 'primary_color', label: 'Primary Brand Color', desc: 'Used for headers and core UI' },
                { key: 'accent_color', label: 'Interactive Accent', desc: 'Used for prices and highlights' },
              ].map(field => (
                <div key={field.key} className="space-y-3">
                  <label className={labelClassName}>{field.label}</label>
                  <div className="flex items-center gap-4">
                    <div className="relative group">
                      <input 
                        type="color" 
                        value={(form as any)[field.key]}
                        onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                        className="w-14 h-14 rounded-lg border-2 border-zinc-100 cursor-pointer p-1.5 bg-white shadow-sm transition-transform group-hover:scale-105" 
                      />
                    </div>
                    <div className="flex-1">
                      <input 
                        type="text" 
                        value={(form as any)[field.key]}
                        onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                        className={cn(inputClassName, "font-mono uppercase text-[10px] py-2.5")} 
                      />
                      <p className="text-[9px] font-medium text-zinc-400 mt-1.5 ml-1">{field.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-10">
          {/* Social & Ordering */}
          <div className="bg-white border border-zinc-100 rounded-lg p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Share2 className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Connections</h2>
            </div>
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="relative">
                  <label className={labelClassName}>WhatsApp Integration</label>
                  <div className="absolute left-5 top-11 text-zinc-400">
                    <MessageCircle className="w-5 h-5" />
                  </div>
                  <input 
                    value={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                    placeholder="e.g. 15550000000"
                    className={cn(inputClassName, "pl-14")} 
                  />
                  <p className="text-[9px] font-medium text-zinc-400 mt-2 ml-1 flex items-center gap-1.5">
                    <Info className="w-3 h-3" />
                    Format: Country Code + Area Code + Number
                  </p>
                </div>

                <div className="relative">
                  <label className={labelClassName}>Instagram Handle</label>
                  <div className="absolute left-5 top-11 text-zinc-400">
                    <Instagram className="w-5 h-5" />
                  </div>
                  <div className="relative">
                    <span className="absolute left-11 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">@</span>
                    <input 
                      value={form.instagram}
                      onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))}
                      placeholder="username"
                      className={cn(inputClassName, "pl-14")} 
                    />
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-zinc-50 space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <ShoppingBag className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="text-xl font-black text-zinc-950 tracking-tight">Ordering System</h2>
                </div>

                {[
                  { key: 'orders_enabled', label: 'Master Order Control', desc: 'Global switch to enable/disable all order features' },
                  { key: 'whatsapp_orders_enabled', label: 'Direct WhatsApp Checkout', desc: 'Let customers send their cart details via WhatsApp message' },
                  { key: 'direct_orders_enabled', label: 'Native Ordering System', desc: 'Enable full checkout and payment processing (Add-on)' },
                ].map(field => (
                  <div key={field.key} className="flex items-center justify-between group p-4 rounded-lg hover:bg-zinc-50 transition-all cursor-pointer" onClick={() => setForm(f => ({ ...f, [field.key]: !(f as any)[field.key] }))}>
                    <div className="max-w-[70%]">
                      <p className="text-sm font-black text-zinc-950 uppercase tracking-tight">{(field as any).label}</p>
                      <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mt-0.5">{(field as any).desc}</p>
                    </div>
                    <button 
                      type="button" 
                      className={cn(
                        "relative inline-flex h-7 w-12 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-300 focus:outline-none",
                        (form as any)[field.key] ? "bg-primary" : "bg-zinc-200"
                      )}
                    >
                      <span className={cn(
                        "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300",
                        (form as any)[field.key] ? "translate-x-5" : "translate-x-0"
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sticky/Bottom Save Bar */}
          <div className="bg-zinc-950 rounded-lg p-8 shadow-2xl flex items-center justify-between gap-6 border border-white/5">
            <div className="hidden sm:block">
              <p className="text-white font-black tracking-tight text-lg">Ready to sync?</p>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Changes are updated in real-time.</p>
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className={cn(
                "flex-1 sm:flex-none bg-primary text-primary-foreground px-12 py-5 rounded-full text-lg font-black transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg shadow-primary/20",
                saved ? "bg-green-500 text-white" : "hover:bg-white"
              )}
            >
              {loading ? 'Processing...' : saved ? (
                <>
                  <CheckCircle2 className="w-6 h-6" />
                  Settings Updated
                </>
              ) : (
                <>
                  <Save className="w-6 h-6" />
                  Deploy Changes
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
