'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { TenantSettings } from '@/types/database'
import { Search, Save, Globe, Image as ImageIcon, EyeOff, CheckCircle2, AlertCircle, Tag } from 'lucide-react'

interface Props {
  settings: TenantSettings | null
  tenantId: string
  tenantName: string
  canonicalUrl: string
  isCustomDomain: boolean
}

const TITLE_MAX = 70
const TITLE_IDEAL = 60
const DESC_MAX = 200
const DESC_IDEAL = 160

export default function SeoClient({ settings, tenantName, canonicalUrl, isCustomDomain }: Props) {
  const [form, setForm] = useState({
    seo_title: settings?.seo_title ?? '',
    seo_description: settings?.seo_description ?? '',
    seo_keywords: settings?.seo_keywords ?? '',
    seo_noindex: settings?.seo_noindex ?? false,
  })
  const [ogImage, setOgImage] = useState(settings?.seo_og_image_url ?? '')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Derived (what the public page would actually render after fallbacks)
  const tagline = settings?.tagline ?? ''
  const about = settings?.about ?? ''
  const effectiveTitle = form.seo_title.trim() || tenantName
  const effectiveDescription =
    form.seo_description.trim() || tagline.trim() || about.trim().slice(0, 160) || `View the full menu of ${tenantName}`
  const displayUrl = canonicalUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const keywordList = form.seo_keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 12)

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', 'seo')
    const res = await fetch('/api/admin/branding/upload', { method: 'POST', body: formData })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setUploadError((json as { error?: string }).error ?? 'Upload failed')
    else setOgImage((json as { url: string }).url)
    setUploading(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const payload = { ...form, seo_og_image_url: ogImage || null }
    const res = await fetch('/api/admin/seo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      alert((json as { error?: string }).error ?? 'Error saving SEO settings')
      setLoading(false)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setLoading(false)
  }

  const inputClassName =
    'w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all'
  const labelClassName = 'block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1'

  function counterColor(len: number, ideal: number, max: number) {
    if (len === 0) return 'text-zinc-400'
    if (len > max - 5) return 'text-red-500'
    if (len > ideal) return 'text-amber-500'
    return 'text-emerald-500'
  }

  return (
    <form onSubmit={handleSave} className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Discoverability</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">SEO</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Control how your menu appears on Google and social media</p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-black uppercase tracking-widest disabled:opacity-50 transition-all hover:opacity-90"
        >
          {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved' : loading ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Indexing status */}
      <div className="bg-zinc-950 rounded-lg p-6 flex items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex-shrink-0">
            <Globe className="w-5 h-5 text-zinc-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">Canonical URL</p>
            <p className="text-base font-black text-white tracking-tight truncate">{displayUrl}</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
              {isCustomDomain ? 'Indexed on your custom domain' : 'Indexed on your XmartMenu address'}
            </p>
          </div>
        </div>
        <div
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
            form.seo_noindex ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
          }`}
        >
          {form.seo_noindex ? 'Hidden from search' : 'Search visible'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Left: form fields */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <label className={labelClassName}>Page title</label>
              <span className={`text-[10px] font-bold ${counterColor(form.seo_title.length, TITLE_IDEAL, TITLE_MAX)}`}>
                {form.seo_title.length}/{TITLE_MAX}
              </span>
            </div>
            <input
              className={inputClassName}
              maxLength={TITLE_MAX}
              placeholder={tenantName}
              value={form.seo_title}
              onChange={(e) => setForm({ ...form, seo_title: e.target.value })}
            />
            <p className="text-[11px] text-zinc-400 mt-1.5 ml-1">Leave empty to use your restaurant name. ~{TITLE_IDEAL} chars is ideal.</p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className={labelClassName}>Meta description</label>
              <span className={`text-[10px] font-bold ${counterColor(form.seo_description.length, DESC_IDEAL, DESC_MAX)}`}>
                {form.seo_description.length}/{DESC_MAX}
              </span>
            </div>
            <textarea
              className={`${inputClassName} min-h-[96px] resize-y`}
              maxLength={DESC_MAX}
              placeholder={tagline || `View the full menu of ${tenantName}`}
              value={form.seo_description}
              onChange={(e) => setForm({ ...form, seo_description: e.target.value })}
            />
            <p className="text-[11px] text-zinc-400 mt-1.5 ml-1">Falls back to your tagline. ~{DESC_IDEAL} chars is ideal.</p>
          </div>

          <div>
            <label className={labelClassName}>
              <span className="inline-flex items-center gap-1.5"><Tag className="w-3 h-3" /> Keywords</span>
            </label>
            <input
              className={inputClassName}
              placeholder="sushi, japanese restaurant, delivery"
              value={form.seo_keywords}
              onChange={(e) => setForm({ ...form, seo_keywords: e.target.value })}
            />
            {keywordList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                {keywordList.map((k) => (
                  <span key={k} className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[11px] font-bold">{k}</span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-zinc-400 mt-1.5 ml-1">Comma-separated. Up to 12 are used.</p>
          </div>

          {/* OG image */}
          <div>
            <label className={labelClassName}>
              <span className="inline-flex items-center gap-1.5"><ImageIcon className="w-3 h-3" /> Social share image</span>
            </label>
            <div className="flex items-center gap-4">
              <div className="relative w-32 h-[68px] flex-shrink-0 rounded-lg overflow-hidden border border-zinc-200 bg-zinc-50">
                {ogImage ? (
                  <Image src={ogImage} alt="Social preview" fill className="object-cover" sizes="128px" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-zinc-400 text-center px-2">
                    Auto-generated card
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-xs font-bold text-zinc-700 cursor-pointer transition-colors">
                  {uploading ? 'Uploading…' : 'Upload image'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleUpload(f)
                    }}
                  />
                </label>
                {ogImage && (
                  <button type="button" onClick={() => setOgImage('')} className="block text-[11px] font-bold text-red-500 ml-1">
                    Remove (use auto card)
                  </button>
                )}
              </div>
            </div>
            {uploadError && (
              <p className="text-[11px] text-red-500 mt-1.5 ml-1 inline-flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {uploadError}
              </p>
            )}
            <p className="text-[11px] text-zinc-400 mt-1.5 ml-1">1200×630 recommended. Leave empty for an auto-generated branded card.</p>
          </div>

          {/* noindex toggle */}
          <label className="flex items-start gap-3 p-4 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={form.seo_noindex}
              onChange={(e) => setForm({ ...form, seo_noindex: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-primary"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-black text-zinc-950">
                <EyeOff className="w-3.5 h-3.5" /> Hide from search engines
              </span>
              <span className="block text-[11px] text-zinc-500 mt-0.5">
                Adds <code className="text-zinc-700">noindex,nofollow</code>. Use only if you don&apos;t want this menu found on Google.
              </span>
            </span>
          </label>
        </div>

        {/* Right: live previews */}
        <div className="space-y-8">
          {/* Google SERP preview */}
          <div>
            <p className={labelClassName}>Google preview</p>
            <div className="border border-zinc-200 rounded-lg p-5 bg-white">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center text-[10px] font-black text-zinc-500">
                  {tenantName.slice(0, 1).toUpperCase()}
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-medium text-zinc-800">{tenantName}</p>
                  <p className="text-[11px] text-zinc-500">{displayUrl}</p>
                </div>
              </div>
              <p className="text-[#1a0dab] text-lg leading-tight truncate hover:underline cursor-pointer">{effectiveTitle}</p>
              <p className="text-[13px] text-zinc-600 mt-1 line-clamp-2">{effectiveDescription}</p>
              {form.seo_noindex && (
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-red-500 inline-flex items-center gap-1">
                  <EyeOff className="w-3 h-3" /> Not shown — noindex enabled
                </p>
              )}
            </div>
          </div>

          {/* Social card preview */}
          <div>
            <p className={labelClassName}>Social share preview</p>
            <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white max-w-md">
              <div className="relative w-full aspect-[1200/630] bg-zinc-100">
                {ogImage ? (
                  <Image src={ogImage} alt="Social preview" fill className="object-cover" sizes="448px" />
                ) : (
                  <div
                    className="w-full h-full flex flex-col items-center justify-center text-center px-6"
                    style={{ background: settings?.primary_color ?? '#F52323' }}
                  >
                    <p className="text-2xl font-black text-white truncate max-w-full">{tenantName}</p>
                    {tagline && <p className="text-sm font-medium text-white/80 mt-1 line-clamp-2">{tagline}</p>}
                    <p className="text-[10px] font-black uppercase tracking-[3px] text-white/60 mt-3">Digital Menu</p>
                  </div>
                )}
              </div>
              <div className="p-3 border-t border-zinc-100">
                <p className="text-[11px] text-zinc-400 uppercase">{displayUrl}</p>
                <p className="text-sm font-bold text-zinc-800 truncate">{effectiveTitle}</p>
                <p className="text-[12px] text-zinc-500 line-clamp-1">{effectiveDescription}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
