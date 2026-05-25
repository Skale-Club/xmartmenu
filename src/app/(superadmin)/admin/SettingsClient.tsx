'use client'

import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Settings,
  Globe,
  Palette,
  Layout,
  ListChecks,
  Star,
  Zap,
  MousePointer2,
  ExternalLink,
  Save,
  CheckCircle2,
  XCircle,
  Upload,
  ImageIcon,
  Video,
  Loader2,
  RefreshCw,
  Trash2,
  ClipboardList,
  Smartphone,
  QrCode,
  Link2,
  MessageCircle,
  BarChart2,
  Search,
  ChefHat,
  UtensilsCrossed,
  BookOpen,
  Coffee,
  ShoppingCart,
  CreditCard,
  Bell,
  Sandwich,
  CupSoda,
  type LucideIcon,
} from 'lucide-react'

type BgType = 'color' | 'image' | 'video'

const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
  { name: 'ClipboardList', icon: ClipboardList },
  { name: 'Palette', icon: Palette },
  { name: 'QrCode', icon: QrCode },
  { name: 'Smartphone', icon: Smartphone },
  { name: 'Link2', icon: Link2 },
  { name: 'MessageCircle', icon: MessageCircle },
  { name: 'BarChart2', icon: BarChart2 },
  { name: 'Search', icon: Search },
  { name: 'ChefHat', icon: ChefHat },
  { name: 'UtensilsCrossed', icon: UtensilsCrossed },
  { name: 'Globe', icon: Globe },
  { name: 'Zap', icon: Zap },
  { name: 'Star', icon: Star },
  { name: 'CreditCard', icon: CreditCard },
  { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'Bell', icon: Bell },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'Coffee', icon: Coffee },
  { name: 'Sandwich', icon: Sandwich },
  { name: 'CupSoda', icon: CupSoda },
]

function getIcon(name: string): LucideIcon {
  return ICON_OPTIONS.find(o => o.name === name)?.icon ?? ClipboardList
}

function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const Icon = getIcon(value)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-12 h-12 flex items-center justify-center bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors"
        title="Change icon"
      >
        <Icon className="w-5 h-5 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute top-14 left-0 z-20 bg-white border border-zinc-200 rounded-2xl p-2 shadow-xl grid grid-cols-5 gap-1 w-[208px]">
          {ICON_OPTIONS.map(({ name, icon: Opt }) => (
            <button
              key={name}
              type="button"
              onClick={() => { onChange(name); setOpen(false) }}
              className={`p-2 rounded-xl flex items-center justify-center transition-colors ${
                name === value ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
              }`}
              title={name}
            >
              <Opt className="w-4 h-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface HeroAssetUploaderProps {
  type: 'image' | 'video'
  url: string
  onUpload: (url: string) => void
  dest?: string
}

function HeroAssetUploader({ type, url, onUpload, dest }: HeroAssetUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    const maxBytes = type === 'image' ? 5 * 1024 * 1024 : 50 * 1024 * 1024
    if (file.size > maxBytes) {
      setUploadError(`File too large. Max ${type === 'image' ? '5 MB' : '50 MB'}.`)
      return
    }
    setUploading(true)
    setUploadError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('type', type)
    if (dest) form.append('dest', dest)
    const res = await fetch('/api/superadmin/platform/upload', { method: 'POST', body: form })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setUploadError(data.error ?? 'Upload failed'); return }
    onUpload(data.url)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const accept = type === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/webm,video/quicktime'

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />

      {/* Preview */}
      {url ? (
        <div className="relative rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-50 group">
          {type === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Hero background" className="w-full h-40 object-cover" />
          ) : (
            <video src={url} className="w-full h-40 object-cover" muted playsInline preload="metadata" />
          )}
          {/* Overlay actions */}
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 bg-white text-zinc-900 px-4 py-2 rounded-xl text-xs font-bold hover:bg-zinc-100 transition-colors"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {uploading ? 'Uploading...' : `Replace ${type}`}
            </button>
            <button
              type="button"
              onClick={() => onUpload('')}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Remove
            </button>
          </div>
        </div>
      ) : (
        /* Drop zone */
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-zinc-200 rounded-2xl p-8 flex flex-col items-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
        >
          {uploading ? (
            <>
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-sm font-medium text-zinc-500">Uploading...</p>
            </>
          ) : (
            <>
              {type === 'image'
                ? <ImageIcon className="w-8 h-8 text-zinc-300 group-hover:text-indigo-400 transition-colors" />
                : <Video className="w-8 h-8 text-zinc-300 group-hover:text-indigo-400 transition-colors" />
              }
              <div className="text-center">
                <p className="text-sm font-semibold text-zinc-600">
                  Click to upload {type === 'image' ? 'image' : 'video'}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  {type === 'image' ? 'PNG, JPG, WebP · max 5MB' : 'MP4, WebM · max 50MB'}
                </p>
              </div>
              <div className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold">
                <Upload className="w-3.5 h-3.5" /> Choose {type === 'image' ? 'Image' : 'Video'}
              </div>
            </>
          )}
        </button>
      )}

      {uploadError && (
        <p className="text-xs text-red-600 font-medium flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5" /> {uploadError}
        </p>
      )}
    </div>
  )
}

const DEFAULT_LANDING = {
  hero: { badge: 'Digital menu for restaurants', heading: 'Your menu on your phone', heading_highlight: 'with a QR Code', subheading: 'Run a digital menu built for restaurant service, QR codes, and WhatsApp ordering. No app, no hassle.', cta_primary: 'Get started free', cta_secondary: 'See how it works', bg_type: 'color' as BgType, bg_color: '#09090b', bg_image_url: '', bg_video_url: '' },
  how_it_works: { title: 'How it works', subtitle: 'Up and running in 3 simple steps', steps: [{ step: '01', icon: 'ClipboardList', title: 'Build your menu', desc: 'Create categories and add your products with photos, descriptions and prices in the dashboard.' }, { step: '02', icon: 'Palette', title: 'Customize the look', desc: 'Add your logo, restaurant colors and contact information to make it your own.' }, { step: '03', icon: 'QrCode', title: 'Generate & print the QR Code', desc: 'Generate your unique QR Code with one click. Place it on tables and let customers access it instantly.' }] },
  features: { title: 'Everything you need', subtitle: 'Features designed for restaurants', items: [{ icon: 'Link2', title: 'Unique link per restaurant', desc: 'Each customer has their own digital menu address.' }, { icon: 'MessageCircle', title: 'Order via WhatsApp', desc: 'Customers tap a product and WhatsApp opens ready to order.' }, { icon: 'Palette', title: 'Custom branding', desc: 'Logo, colors and visual identity for your restaurant.' }, { icon: 'BarChart2', title: 'Scan counter', desc: 'See how many times your QR Code has been scanned.' }, { icon: 'Search', title: 'Menu search', desc: 'Customers find any product in seconds.' }, { icon: 'Zap', title: 'No app required', desc: 'Everything opens directly in the phone browser, zero friction.' }] },
  pricing: { title: 'Simple plans', subtitle: 'Start free, scale when you need', plans: [{ name: 'Free', price: '$0', period: '/mo', desc: 'To get started', features: ['Digital menu', 'QR Code generated', 'Up to 20 products', 'Basic branding'], cta: 'Get started free', highlight: false }, { name: 'Pro', price: '$49', period: '/mo', desc: 'To grow', features: ['Everything in Free', 'Unlimited products', 'Full branding', 'Scan analytics', 'Priority support'], cta: 'Subscribe to Pro', highlight: true }, { name: 'Enterprise', price: '$149', period: '/mo', desc: 'For chains', features: ['Everything in Pro', 'Multiple locations', 'Custom domain', 'Dedicated onboarding', 'Guaranteed SLA'], cta: 'Talk to sales', highlight: false }] },
  cta: { heading: 'Ready to digitize\nyour menu?', text: 'Create your account and build a menu that works for daily service.', button: 'Create free account', bg_image_url: '' },
  footer: { copyright: 'XmartMenu. All rights reserved.' },
}

function FaviconUploader({ url, onUpload }: { url: string; onUpload: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('type', 'image')
    form.append('dest', 'favicon')
    const res = await fetch('/api/superadmin/platform/upload', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) setError(data.error ?? 'Upload failed')
    else onUpload(data.url)
    setUploading(false)
  }

  return (
    <div className="flex items-center gap-3">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-xs font-bold rounded-xl hover:bg-zinc-700 transition-colors disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {uploading ? 'Uploading...' : url ? 'Replace' : 'Upload favicon'}
      </button>
      {url && (
        <button type="button" onClick={() => onUpload('')} className="text-xs text-zinc-400 hover:text-red-500 transition-colors">
          Remove
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

interface Props { settings: any }

export default function SettingsClient({ settings }: Props) {
  const s = settings ?? {}
  const l = { ...DEFAULT_LANDING, ...(s.landing ?? {}) }

  const [platform, setPlatform] = useState({
    app_name: s.app_name ?? 'XmartMenu',
    brand_name: s.brand_name ?? 'XmartMenu',
    default_primary_color: s.default_primary_color ?? '#000000',
    default_accent_color: s.default_accent_color ?? '#FF5722',
    cta_color: s.cta_color ?? '#F52323',
    menu_footer_brand: s.menu_footer_brand ?? 'XmartMenu',
    favicon_url: s.favicon_url ?? '',
  })

  const [hero, setHero] = useState({ ...DEFAULT_LANDING.hero, ...(l.hero ?? {}) })
  const [howItWorks, setHowItWorks] = useState({ ...DEFAULT_LANDING.how_it_works, ...(l.how_it_works ?? {}) })
  const [features, setFeatures] = useState({ ...DEFAULT_LANDING.features, ...(l.features ?? {}) })
  const [pricing, setPricing] = useState({ ...DEFAULT_LANDING.pricing, ...(l.pricing ?? {}) })
  const [cta, setCta] = useState({ ...DEFAULT_LANDING.cta, ...(l.cta ?? {}) })
  const [footer, setFooter] = useState({ ...DEFAULT_LANDING.footer, ...(l.footer ?? {}) })

  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/superadmin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...platform,
        landing: { hero, how_it_works: howItWorks, features, pricing, cta, footer },
      }),
    })

    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { const d = await res.json(); setError(d.error ?? 'Erro ao salvar') }
    setLoading(false)
  }

  function updateStep(i: number, key: string, val: string) {
    const steps = [...howItWorks.steps]
    steps[i] = { ...steps[i], [key]: val }
    setHowItWorks({ ...howItWorks, steps })
  }

  function updateFeature(i: number, key: string, val: string) {
    const items = [...features.items]
    items[i] = { ...items[i], [key]: val }
    setFeatures({ ...features, items })
  }

  function updatePlan(i: number, key: string, val: any) {
    const plans = [...pricing.plans]
    plans[i] = { ...plans[i], [key]: val }
    setPricing({ ...pricing, plans })
  }

  const input = 'w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-zinc-400'
  const textarea = input + ' resize-none min-h-[100px]'
  const label = 'block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 ml-1'
  const section = 'bg-white border border-zinc-200 rounded-3xl p-8 shadow-sm space-y-6'
  const sectionTitle = 'flex items-center gap-2 text-lg font-bold text-zinc-900'

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <div className="flex items-center gap-3 mb-1">
          <Settings className="w-5 h-5 text-zinc-500" />
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Platform Settings</h1>
        </div>
        <p className="text-sm text-zinc-500 font-medium">Global configuration and landing page content management</p>
      </motion.div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 mb-8 text-sm text-red-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-10">

        {/* Plataforma */}
        <div className={section}>
          <h2 className={sectionTitle}><Globe className="w-5 h-5 text-zinc-500" /> Core Platform</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div><label className={label}>App Name</label><input className={input} value={platform.app_name} onChange={e => setPlatform({ ...platform, app_name: e.target.value })} /></div>
            <div><label className={label}>Brand Name</label><input className={input} value={platform.brand_name} onChange={e => setPlatform({ ...platform, brand_name: e.target.value })} /></div>
            <div><label className={label}>Menu Footer Text</label><input className={input} value={platform.menu_footer_brand} onChange={e => setPlatform({ ...platform, menu_footer_brand: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-4 border-t border-zinc-50 items-end">
            <div className="space-y-3">
              <label className={label}>Default Primary Color</label>
              <div className="flex items-center gap-2 bg-zinc-50 px-3 py-2 rounded-2xl border border-zinc-200 overflow-hidden">
                <label className="relative w-9 h-9 rounded-lg flex-shrink-0 cursor-pointer border border-zinc-200 overflow-hidden" style={{ backgroundColor: platform.default_primary_color }}>
                  <input type="color" value={platform.default_primary_color} onChange={e => setPlatform({ ...platform, default_primary_color: e.target.value })} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
                <input className="flex-1 bg-transparent border-0 focus:ring-0 text-sm font-mono uppercase min-w-0" value={platform.default_primary_color} onChange={e => setPlatform({ ...platform, default_primary_color: e.target.value })} />
              </div>
            </div>
            <div className="space-y-3">
              <label className={label}>Default Accent Color</label>
              <div className="flex items-center gap-2 bg-zinc-50 px-3 py-2 rounded-2xl border border-zinc-200 overflow-hidden">
                <label className="relative w-9 h-9 rounded-lg flex-shrink-0 cursor-pointer border border-zinc-200 overflow-hidden" style={{ backgroundColor: platform.default_accent_color }}>
                  <input type="color" value={platform.default_accent_color} onChange={e => setPlatform({ ...platform, default_accent_color: e.target.value })} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
                <input className="flex-1 bg-transparent border-0 focus:ring-0 text-sm font-mono uppercase min-w-0" value={platform.default_accent_color} onChange={e => setPlatform({ ...platform, default_accent_color: e.target.value })} />
              </div>
            </div>
            <div className="space-y-3">
              <label className={label}>CTA Color</label>
              <div className="flex items-center gap-2 bg-zinc-50 px-3 py-2 rounded-2xl border border-zinc-200 overflow-hidden">
                <label className="relative w-9 h-9 rounded-lg flex-shrink-0 cursor-pointer border border-zinc-200 overflow-hidden" style={{ backgroundColor: platform.cta_color }}>
                  <input type="color" value={platform.cta_color} onChange={e => setPlatform({ ...platform, cta_color: e.target.value })} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
                <input className="flex-1 bg-transparent border-0 focus:ring-0 text-sm font-mono uppercase min-w-0" value={platform.cta_color} onChange={e => setPlatform({ ...platform, cta_color: e.target.value })} />
              </div>
            </div>
          </div>
        </div>

        {/* Favicon */}
        <div className={section}>
          <h2 className={sectionTitle}><ImageIcon className="w-5 h-5 text-zinc-500" /> Favicon</h2>
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {platform.favicon_url
                ? <img src={platform.favicon_url} alt="favicon preview" className="w-12 h-12 object-contain" />
                : <ImageIcon className="w-6 h-6 text-zinc-300" />
              }
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-zinc-700">Browser tab icon</p>
              <p className="text-xs text-zinc-400">PNG, JPG or WebP · Recommended 64×64px or larger</p>
              <FaviconUploader url={platform.favicon_url} onUpload={url => setPlatform({ ...platform, favicon_url: url })} />
            </div>
          </div>
        </div>

        {/* Hero */}
        <div className={section}>
          <div className="flex items-center justify-between border-b border-zinc-100 pb-4 mb-2">
            <h2 className={sectionTitle}><Layout className="w-5 h-5 text-zinc-500" /> Hero Section</h2>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-50 px-3 py-1 rounded-full">Landing Page</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div><label className={label}>Top Badge Text</label><input className={input} value={hero.badge} onChange={e => setHero({ ...hero, badge: e.target.value })} /></div>
            <div><label className={label}>Gradient Highlight</label><input className={input} value={hero.heading_highlight} onChange={e => setHero({ ...hero, heading_highlight: e.target.value })} /></div>
          </div>
          <div><label className={label}>Main Headline</label><input className={input} value={hero.heading} onChange={e => setHero({ ...hero, heading: e.target.value })} /></div>
          <div><label className={label}>Subheadline Description</label><textarea rows={3} className={textarea} value={hero.subheading} onChange={e => setHero({ ...hero, subheading: e.target.value })} /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div><label className={label}>Primary CTA Button</label><input className={input} value={hero.cta_primary} onChange={e => setHero({ ...hero, cta_primary: e.target.value })} /></div>
            <div><label className={label}>Secondary CTA Button</label><input className={input} value={hero.cta_secondary} onChange={e => setHero({ ...hero, cta_secondary: e.target.value })} /></div>
          </div>

          {/* Hero Background */}
          <div className="space-y-4 border-t border-zinc-100 pt-6">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-zinc-400" />
              <span className={label} style={{ marginBottom: 0, marginLeft: 0 }}>Hero Background</span>
            </div>

            {/* Type selector */}
            <div className="flex items-center gap-2">
              {(['color', 'image', 'video'] as BgType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setHero({ ...hero, bg_type: t })}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    hero.bg_type === t
                      ? 'bg-zinc-900 text-white shadow-sm'
                      : 'bg-zinc-50 text-zinc-500 hover:bg-zinc-100 border border-zinc-200'
                  }`}
                >
                  {t === 'color' && <Palette className="w-3.5 h-3.5" />}
                  {t === 'image' && <ImageIcon className="w-3.5 h-3.5" />}
                  {t === 'video' && <Video className="w-3.5 h-3.5" />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Color */}
            {hero.bg_type === 'color' && (
              <div className="space-y-2">
                <label className={label}>Background Color</label>
                <div className="flex items-center gap-3 bg-zinc-50 p-2 rounded-2xl border border-zinc-100">
                  <input
                    type="color"
                    value={hero.bg_color ?? '#09090b'}
                    onChange={e => setHero({ ...hero, bg_color: e.target.value })}
                    className="w-12 h-12 rounded-xl border-0 cursor-pointer p-0.5 bg-transparent"
                  />
                  <input
                    className="flex-1 bg-transparent border-0 focus:ring-0 text-sm font-mono uppercase"
                    value={hero.bg_color ?? '#09090b'}
                    onChange={e => setHero({ ...hero, bg_color: e.target.value })}
                  />
                  {/* Preview swatch */}
                  <div
                    className="w-20 h-10 rounded-xl border border-zinc-200"
                    style={{ background: hero.bg_color ?? '#09090b' }}
                  />
                </div>
              </div>
            )}

            {/* Image */}
            {hero.bg_type === 'image' && (
              <HeroAssetUploader
                type="image"
                url={hero.bg_image_url ?? ''}
                onUpload={url => setHero({ ...hero, bg_image_url: url })}
              />
            )}

            {/* Video */}
            {hero.bg_type === 'video' && (
              <div className="space-y-4">
                <HeroAssetUploader
                  type="video"
                  url={hero.bg_video_url ?? ''}
                  onUpload={url => setHero({ ...hero, bg_video_url: url })}
                />
                <div className="space-y-2">
                  <label className={label}>
                    Image Fallback
                    <span className="ml-1.5 font-normal text-zinc-400">— shown while video loads or on unsupported browsers</span>
                  </label>
                  <HeroAssetUploader
                    type="image"
                    url={hero.bg_image_url ?? ''}
                    onUpload={url => setHero({ ...hero, bg_image_url: url })}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Como funciona */}
        <div className={section}>
          <h2 className={sectionTitle}><ListChecks className="w-5 h-5 text-zinc-500" /> Workflow Section</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-zinc-50">
            <div><label className={label}>Section Headline</label><input className={input} value={howItWorks.title} onChange={e => setHowItWorks({ ...howItWorks, title: e.target.value })} /></div>
            <div><label className={label}>Section Subtitle</label><input className={input} value={howItWorks.subtitle} onChange={e => setHowItWorks({ ...howItWorks, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {howItWorks.steps.map((step: any, i: number) => (
              <div key={i} className="bg-zinc-50/50 border border-zinc-100 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xl font-black text-zinc-200">0{i+1}</span>
                  <IconPicker value={step.icon} onChange={v => updateStep(i, 'icon', v)} />
                </div>
                <div><label className={label}>Step Title</label><input className={input} value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} /></div>
                <div><label className={label}>Step Description</label><textarea rows={2} className={textarea} value={step.desc} onChange={e => updateStep(i, 'desc', e.target.value)} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Funcionalidades */}
        <div className={section}>
          <h2 className={sectionTitle}><Star className="w-5 h-5 text-zinc-500" /> Features Grid</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-zinc-50">
            <div><label className={label}>Grid Title</label><input className={input} value={features.title} onChange={e => setFeatures({ ...features, title: e.target.value })} /></div>
            <div><label className={label}>Grid Subtitle</label><input className={input} value={features.subtitle} onChange={e => setFeatures({ ...features, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.items.map((item: any, i: number) => (
              <div key={i} className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3 hover:border-amber-200 transition-colors group">
                <div className="flex items-center gap-3">
                  <IconPicker value={item.icon} onChange={v => updateFeature(i, 'icon', v)} />
                  <div className="flex-1">
                    <label className={label}>Title</label>
                    <input className={input} value={item.title} onChange={e => updateFeature(i, 'title', e.target.value)} />
                  </div>
                </div>
                <div><label className={label}>Short Description</label><input className={input} value={item.desc} onChange={e => updateFeature(i, 'desc', e.target.value)} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Planos */}
        <div className={section}>
          <h2 className={sectionTitle}><Zap className="w-5 h-5 text-zinc-500" /> Pricing Architecture</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-zinc-50">
            <div><label className={label}>Section Header</label><input className={input} value={pricing.title} onChange={e => setPricing({ ...pricing, title: e.target.value })} /></div>
            <div><label className={label}>Section Subtext</label><input className={input} value={pricing.subtitle} onChange={e => setPricing({ ...pricing, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {pricing.plans.map((plan: any, i: number) => (
              <div key={i} className={`rounded-3xl p-8 space-y-6 border transition-all ${plan.highlight ? 'bg-zinc-900 text-white border-zinc-800 shadow-xl' : 'bg-zinc-50/50 border-zinc-100 text-zinc-900'}`}>
                <div className="flex items-center justify-between">
                  <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${plan.highlight ? 'text-indigo-400' : 'text-zinc-400'}`}>{plan.name} Tier</p>
                  <input type="checkbox" checked={plan.highlight} onChange={e => updatePlan(i, 'highlight', e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                </div>
                
                <div className="space-y-4">
                  <div><label className={label}>Plan Name</label><input className={`${input} ${plan.highlight ? 'bg-zinc-800 border-zinc-700 text-white' : ''}`} value={plan.name} onChange={e => updatePlan(i, 'name', e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={label}>Price</label><input className={`${input} ${plan.highlight ? 'bg-zinc-800 border-zinc-700 text-white' : ''}`} value={plan.price} onChange={e => updatePlan(i, 'price', e.target.value)} /></div>
                    <div><label className={label}>Period</label><input className={`${input} ${plan.highlight ? 'bg-zinc-800 border-zinc-700 text-white' : ''}`} value={plan.period} onChange={e => updatePlan(i, 'period', e.target.value)} /></div>
                  </div>
                  <div><label className={label}>Internal Desc</label><input className={`${input} ${plan.highlight ? 'bg-zinc-800 border-zinc-700 text-white' : ''}`} value={plan.desc} onChange={e => updatePlan(i, 'desc', e.target.value)} /></div>
                  <div><label className={label}>CTA Text</label><input className={`${input} ${plan.highlight ? 'bg-zinc-800 border-zinc-700 text-white' : ''}`} value={plan.cta} onChange={e => updatePlan(i, 'cta', e.target.value)} /></div>
                  <div>
                    <label className={label}>Key Features (Enter separated)</label>
                    <textarea rows={5} className={`${textarea} ${plan.highlight ? 'bg-zinc-800 border-zinc-700 text-white' : ''}`} value={plan.features.join('\n')} onChange={e => updatePlan(i, 'features', e.target.value.split('\n').filter(Boolean))} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Final */}
        <div className={section}>
          <h2 className={sectionTitle}><MousePointer2 className="w-5 h-5 text-zinc-500" /> Final Call to Action</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2"><label className={label}>Main Headline</label><input className={input} value={cta.heading} onChange={e => setCta({ ...cta, heading: e.target.value })} /></div>
            <div><label className={label}>Supportive Text</label><input className={input} value={cta.text} onChange={e => setCta({ ...cta, text: e.target.value })} /></div>
            <div><label className={label}>Button Label</label><input className={input} value={cta.button} onChange={e => setCta({ ...cta, button: e.target.value })} /></div>
            <div className="md:col-span-2">
              <label className={label}>Background Image</label>
              <HeroAssetUploader
                type="image"
                dest="cta-bg"
                url={cta.bg_image_url ?? ''}
                onUpload={url => setCta({ ...cta, bg_image_url: url })}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={section}>
          <h2 className={sectionTitle}><ExternalLink className="w-5 h-5 text-zinc-500" /> Platform Footer</h2>
          <div><label className={label}>Copyright Text (Use {'{year}'} for dynamic year)</label><input className={input} value={footer.copyright} onChange={e => setFooter({ ...footer, copyright: e.target.value })} /></div>
        </div>

        <div className="sticky bottom-0 flex justify-end px-6 py-4 pointer-events-none">
          <button
            type="submit"
            disabled={loading}
            style={!saved ? { backgroundColor: platform.cta_color } : undefined}
            className={`pointer-events-auto flex items-center gap-2 px-8 py-3 rounded-2xl text-sm font-bold transition-all shadow-lg ${
              saved ? 'bg-green-600 text-white' : 'text-zinc-950 hover:opacity-90'
            }`}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {loading ? 'Saving...' : saved ? 'Changes Saved!' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
