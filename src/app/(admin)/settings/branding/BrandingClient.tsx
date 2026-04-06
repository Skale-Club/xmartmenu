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
    address: settings?.address ?? '',
    phone: settings?.phone ?? '',
    instagram: settings?.instagram ?? '',
    whatsapp: settings?.whatsapp ?? '',
  })
  const [logoUrl, setLogoUrl] = useState(settings?.logo_url ?? '')
  const [loading, setLoading] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [saved, setSaved] = useState(false)

  const supabase = createClient()
  const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/${tenantSlug}`

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)

    const ext = file.name.split('.').pop()
    const filename = `${tenantId}/logo.${ext}`

    const { data, error } = await supabase.storage
      .from('tenant-assets')
      .upload(filename, file, { upsert: true })

    if (!error && data) {
      const { data: { publicUrl } } = supabase.storage
        .from('tenant-assets')
        .getPublicUrl(data.path)
      setLogoUrl(publicUrl)
    }
    setUploadingLogo(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const payload = { ...form, logo_url: logoUrl || null, tenant_id: tenantId }

    await supabase
      .from('tenant_settings')
      .upsert(payload, { onConflict: 'tenant_id' })

    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">Branding</h1>
      <p className="text-sm text-zinc-500 mb-8">Personalize a identidade visual do seu cardápio</p>

      <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 mb-6 text-sm">
        <p className="text-zinc-500">Link do seu cardápio público:</p>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-900 font-medium hover:underline"
        >
          {publicUrl}
        </a>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Logo */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Logo</h2>
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-center overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-3xl">🏪</span>
              )}
            </div>
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="text-sm text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
              />
              {uploadingLogo && <p className="text-xs text-zinc-400 mt-1">Enviando...</p>}
              <p className="text-xs text-zinc-400 mt-1">PNG ou SVG recomendado. Máx 2MB.</p>
            </div>
          </div>
        </div>

        {/* Cores */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Cores</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-600 mb-2">Cor primária</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.primary_color}
                  onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-zinc-300 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={form.primary_color}
                  onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-zinc-600 mb-2">Cor de destaque</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.accent_color}
                  onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-zinc-300 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={form.accent_color}
                  onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Contato */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Informações de contato</h2>
          <div className="space-y-3">
            {[
              { key: 'address', label: 'Endereço', placeholder: 'Rua das Flores, 123 — São Paulo/SP' },
              { key: 'phone', label: 'Telefone', placeholder: '(11) 99999-0000' },
              { key: 'whatsapp', label: 'WhatsApp (número)', placeholder: '5511999990000' },
              { key: 'instagram', label: 'Instagram (@ sem o @)', placeholder: 'meurestaurante' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-sm text-zinc-600 mb-1">{field.label}</label>
                <input
                  value={(form as any)[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar configurações'}
        </button>
      </form>
    </div>
  )
}
