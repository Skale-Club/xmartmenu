'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { QRCode } from '@/types/database'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Props {
  qrcodes: QRCode[]
  tenantId: string
  menuUrl: string
  tenantName: string
  activeMenuName: string | null
}

export default function QRCodeClient({ qrcodes: initial, tenantId, menuUrl, tenantName, activeMenuName }: Props) {
  const [qrcodes, setQrcodes] = useState(initial)
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedUrl, setSelectedUrl] = useState(menuUrl)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const supabase = createClient()

  useEffect(() => {
    setQrcodes(initial)
    setSelectedUrl(menuUrl)
    setDeleteId(null)
  }, [initial, menuUrl])

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

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    const { error } = await supabase.from('qr_codes').delete().eq('id', deleteId)
    if (!error) {
      setQrcodes(qrcodes.filter(qr => qr.id !== deleteId))
      if (qrcodes.find(qr => qr.id === deleteId)?.target_url === selectedUrl) {
        setSelectedUrl(menuUrl)
      }
    }
    setDeleteId(null)
    setDeleting(false)
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-zinc-900 mb-1">QR Code</h1>
      <p className="text-sm text-zinc-500 mb-8">
        Generate and download your menu QR Code{activeMenuName ? ` · Menu: ${activeMenuName}` : ''}
      </p>

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
                  <div
                    key={qr.id}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      selectedUrl === qr.target_url
                        ? 'border-zinc-900 bg-zinc-50'
                        : 'border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedUrl(qr.target_url)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-zinc-800">{qr.label ?? 'Main menu'}</span>
                        <span className="text-xs text-zinc-400">{qr.scans} scans</span>
                      </div>
                    </button>
                    <button
                      onClick={() => setDeleteId(qr.id)}
                      className="text-zinc-400 hover:text-red-600 p-1 transition-colors"
                      title="Delete QR Code"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete QR Code"
        message="Are you sure you want to delete this QR Code? This action cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
      />
    </div>
  )
}
