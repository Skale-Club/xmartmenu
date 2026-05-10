'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { QRCode as QRCodeType } from '@/types/database'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { QrCode, Download, Trash2, Plus, ArrowRight, ShieldCheck, AlertCircle, Info, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  qrcodes: QRCodeType[]
  tenantId: string
  menuUrl: string
  tenantName: string
  activeMenuName: string | null
  canManage: boolean
}

export default function QRCodeClient({ qrcodes: initial, tenantId, menuUrl, tenantName, activeMenuName, canManage }: Props) {
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
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  }

  async function handleCreate() {
    if (!label.trim()) return
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

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"

  return (
    <div className="p-8 w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <QrCode className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Distribution</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">QR Codes</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">
            Access gateways for {tenantName} {activeMenuName ? `(${activeMenuName})` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* QR Preview Section */}
        <div className="bg-zinc-950 rounded-[1.5rem] p-10 flex flex-col items-center gap-8 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -mr-32 -mt-32" />
          
          <div className="relative z-10 bg-white p-6 rounded-[1.25rem] shadow-xl group-hover:scale-[1.02] transition-transform duration-500">
            <canvas ref={canvasRef} className="rounded-xl max-w-full" />
          </div>

          <div className="w-full space-y-6 relative z-10">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Target URL</p>
                <p className="text-xs font-mono text-zinc-300 truncate">{selectedUrl}</p>
              </div>
              <a href={selectedUrl} target="_blank" className="p-2 bg-white/10 rounded-xl text-primary hover:bg-primary hover:text-zinc-950 transition-all">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            <button
              onClick={downloadPNG}
              className="w-full bg-primary text-zinc-950 py-5 rounded-full text-lg font-black hover:bg-white transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
            >
              <Download className="w-5 h-5" />
              Download PNG Asset
            </button>
            <p className="text-center text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              High resolution asset for print and media
            </p>
          </div>
        </div>

        {/* Management Section */}
        <div className="space-y-8">
          {canManage ? (
            <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Plus className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-xl font-black text-zinc-950 tracking-tight">New Instance</h2>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="Label (e.g. Table 1, Front Window)"
                  className={inputClassName}
                />
                <button
                  onClick={handleCreate}
                  disabled={loading || !label.trim()}
                  className="bg-zinc-950 text-white px-8 py-3.5 rounded-xl text-sm font-black hover:bg-primary hover:text-zinc-950 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {loading ? '...' : 'Generate'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[10px] font-medium text-zinc-400 mt-4 ml-1 flex items-center gap-2">
                <Info className="w-3 h-3" />
                This will create a unique tracking URL for this location.
              </p>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-6 py-4 text-sm font-bold text-blue-700 flex items-center gap-3">
              <ShieldCheck className="w-5 h-5" />
              Staff access: view and download only.
            </div>
          )}

          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-8 shadow-sm">
            <h2 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-6">Generated Codes</h2>
            {qrcodes.length === 0 ? (
              <div className="text-center py-10 border-2 border-dashed border-zinc-50 rounded-xl">
                <p className="text-sm font-bold text-zinc-300 italic">No custom codes generated yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {qrcodes.map(qr => {
                  const isActive = selectedUrl === qr.target_url
                  return (
                    <div
                      key={qr.id}
                      className={cn(
                        "group flex items-center gap-4 px-6 py-5 rounded-xl border transition-all duration-300",
                        isActive 
                          ? "border-primary bg-primary/5 ring-2 ring-primary/10 shadow-lg shadow-primary/5" 
                          : "border-zinc-50 hover:border-zinc-200 bg-zinc-50/30 hover:bg-white"
                      )}
                    >
                      <button
                        onClick={() => setSelectedUrl(qr.target_url)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-black text-zinc-950 tracking-tight truncate mr-4">{qr.label ?? 'Main Instance'}</span>
                          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 shrink-0">{qr.scans} Scans</span>
                        </div>
                        <p className="text-[10px] font-mono text-zinc-400 truncate opacity-60 group-hover:opacity-100 transition-opacity">{qr.target_url}</p>
                      </button>
                      {canManage && (
                        <button
                          onClick={() => setDeleteId(qr.id)}
                          className="text-zinc-200 hover:text-red-500 p-2 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          title="Delete Instance"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={canManage && !!deleteId}
        title="Destroy Instance"
        message="Are you sure you want to delete this QR Code? Any existing physical prints will stop working."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        confirmLabel={deleting ? 'Processing...' : 'Delete Permanently'}
      />
    </div>
  )
}
