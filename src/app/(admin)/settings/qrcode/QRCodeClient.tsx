'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { QRCode } from '@/types/database'

interface Props {
  qrcodes: QRCode[]
  tenantId: string
  menuUrl: string
  tenantName: string
}

export default function QRCodeClient({ qrcodes: initial, tenantId, menuUrl, tenantName }: Props) {
  const [qrcodes, setQrcodes] = useState(initial)
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedUrl, setSelectedUrl] = useState(menuUrl)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const supabase = createClient()

  useEffect(() => {
    generateQROnCanvas(selectedUrl)
  }, [selectedUrl])

  async function generateQROnCanvas(url: string) {
    const QRCode = (await import('qrcode')).default
    if (canvasRef.current) {
      await QRCode.toCanvas(canvasRef.current, url, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  }

  async function handleCreate() {
    setLoading(true)
    const targetUrl = menuUrl + (label ? `?source=${encodeURIComponent(label)}` : '')
    const { data } = await supabase
      .from('qr_codes')
      .insert({ tenant_id: tenantId, label: label || null, target_url: targetUrl })
      .select()
      .single()

    if (data) {
      setQrcodes([data, ...qrcodes])
      setSelectedUrl(targetUrl)
    }
    setLabel('')
    setLoading(false)
  }

  function downloadPNG() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `qrmenu-${tenantName.toLowerCase().replace(/\s+/g, '-')}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">QR Code</h1>
      <p className="text-sm text-zinc-500 mb-8">Generate and download your menu QR Code</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Preview do QR */}
        <div className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col items-center gap-4">
          <canvas ref={canvasRef} className="rounded-lg" />
          <p className="text-xs text-zinc-400 text-center break-all">{selectedUrl}</p>
          <button
            onClick={downloadPNG}
            className="w-full bg-zinc-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            Download PNG
          </button>
        </div>

        {/* Gerenciar QR codes */}
        <div className="space-y-4">
          <div className="bg-white border border-zinc-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">Create new QR Code</h2>
            <div className="flex gap-2">
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Label (e.g. Table 1, Counter)"
                className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
              <button
                onClick={handleCreate}
                disabled={loading}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {loading ? '...' : '+ Create'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">Generated QR Codes</h2>
            {qrcodes.length === 0 ? (
              <p className="text-sm text-zinc-400">No QR Codes generated yet.</p>
            ) : (
              <div className="space-y-2">
                {qrcodes.map(qr => (
                  <button
                    key={qr.id}
                    onClick={() => setSelectedUrl(qr.target_url)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      selectedUrl === qr.target_url
                        ? 'border-zinc-900 bg-zinc-50'
                        : 'border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-800">{qr.label ?? 'Main menu'}</span>
                      <span className="text-xs text-zinc-400">{qr.scans} scans</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
