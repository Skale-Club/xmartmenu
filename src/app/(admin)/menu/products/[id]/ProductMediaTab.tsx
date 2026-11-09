'use client'

import { useState, useEffect, useRef } from 'react'
import { compressImageForUpload } from '@/lib/media/client-compress'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { notifyPublicMenuChanged } from '@/lib/menu/revalidate-client'
import { ChevronUp, ChevronDown, Trash2, Upload, Plus, Film } from 'lucide-react'
import type { ProductMedia } from '@/types/database'

interface Props {
  productId: string
  tenantId: string
  ownedSource?: boolean
  canManage?: boolean
}

async function ownedMediaRequest(productId: string, payload: Record<string, unknown>): Promise<ProductMedia[]> {
  const response = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/catalog`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as ProductMedia[] & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Media update failed')
  return result as ProductMedia[]
}

function isYouTube(url: string) {
  return /youtu\.?be/.test(url)
}

function isVimeo(url: string) {
  return /vimeo\.com/.test(url)
}

function VideoThumbnail({ url }: { url: string }) {
  if (isYouTube(url)) {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    const vid = match?.[1]
    if (vid) {
      return <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt="YouTube thumbnail" className="w-full h-full object-cover" />
    }
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-200">
      <span className="text-xs text-zinc-500">Video</span>
    </div>
  )
}

export default function ProductMediaTab({ productId, tenantId, ownedSource = false, canManage = true }: Props) {
  let supabaseClient: ReturnType<typeof createClient> | undefined
  const legacyClient = () => (supabaseClient ??= createClient())
  const [media, setMedia] = useState<ProductMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [addingVideo, setAddingVideo] = useState(false)
  const [savingVideo, setSavingVideo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [videoNote, setVideoNote] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    if (ownedSource) {
      try { setMedia(await ownedMediaRequest(productId, { entity: 'media', action: 'list' })) }
      catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Failed to load media') }
      finally { setLoading(false) }
      return
    }
    const { data } = await legacyClient()
      .from('product_media')
      .select('*')
      .eq('product_id', productId)
      .order('display_order')
    setMedia((data ?? []) as ProductMedia[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, ownedSource])

  async function handleUpload(files: FileList | null) {
    if (!canManage || !files || files.length === 0) return
    setUploading(true)
    setError(null)

    const MAX = 8
    const remaining = MAX - media.filter(m => m.type === 'image').length
    const toUpload = Array.from(files).slice(0, remaining)
    // `media` is this render's snapshot; count on from it for every file.
    let nextOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) + 1 : 0
    let wrote = false

    for (const file of toUpload) {
      const fd = new FormData()
      fd.append('file', await compressImageForUpload(file))
      const res = await fetch('/api/admin/products/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        setError('Upload failed for one or more images')
        continue
      }
      const { url } = await res.json()
      if (ownedSource) {
        try {
          setMedia(await ownedMediaRequest(productId, { entity: 'media', action: 'create', values: [{ type: 'image', url }] }))
          wrote = true
        } catch (insertError) {
          setError(insertError instanceof Error ? insertError.message : 'Failed to save image')
          break
        }
      } else {
        const { data: inserted } = await legacyClient().from('product_media')
          .insert({ product_id: productId, tenant_id: tenantId, type: 'image', url, display_order: nextOrder++ })
          .select().single()
        if (inserted) {
          wrote = true
          setMedia(prev => [...prev, inserted as ProductMedia])
        }
      }
    }
    setUploading(false)
    // Sync products.image_url to the lowest display_order image
    if (!ownedSource) await syncPrimaryImage()
    if (wrote) notifyPublicMenuChanged()
  }

  async function handleAddVideo() {
    if (!canManage || !videoUrl.trim()) return
    setSavingVideo(true)
    setError(null)
    try {
      if (ownedSource) setMedia(await ownedMediaRequest(productId, { entity: 'media', action: 'create', values: [{ type: 'video', url: videoUrl.trim() }] }))
      else {
        const nextOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) + 1 : 0
        const { data: inserted } = await legacyClient().from('product_media')
          .insert({ product_id: productId, tenant_id: tenantId, type: 'video', url: videoUrl.trim(), display_order: nextOrder }).select().single()
        if (!inserted) throw new Error('Failed to save video')
        setMedia(prev => [...prev, inserted as ProductMedia])
      }
      notifyPublicMenuChanged()
      setVideoUrl('')
      setAddingVideo(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save video')
    } finally {
      setSavingVideo(false)
    }
  }

  // A video file is re-encoded on the server (720p MP4, no audio) and gets a
  // poster frame, which also becomes the dish photo when it has none.
  async function handleVideoFile(file: File | undefined) {
    if (!canManage || !file) return
    setSavingVideo(true)
    setError(null)
    setVideoNote(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/admin/products/upload-video', { method: 'POST', body: fd })
    const json = await res.json().catch(() => ({})) as { url?: string; poster_url?: string | null; bytes?: number; original_bytes?: number; error?: string }
    if (!res.ok || !json.url) {
      setError(json.error ?? 'Video upload failed')
      setSavingVideo(false)
      return
    }
    try {
      if (ownedSource) {
        const values = []
        if (json.poster_url && imageCount === 0) values.push({ type: 'image', url: json.poster_url })
        values.push({ type: 'video', url: json.url })
        setMedia(await ownedMediaRequest(productId, { entity: 'media', action: 'create', values }))
      } else {
        let nextOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) + 1 : 0
        const rows: Array<Record<string, unknown>> = []
        if (json.poster_url && imageCount === 0) rows.push({ product_id: productId, tenant_id: tenantId, type: 'image', url: json.poster_url, display_order: nextOrder++ })
        rows.push({ product_id: productId, tenant_id: tenantId, type: 'video', url: json.url, display_order: nextOrder })
        const { data: inserted, error: insertError } = await legacyClient().from('product_media').insert(rows).select()
        if (insertError) throw new Error('Failed to save video')
        setMedia(prev => [...prev, ...((inserted ?? []) as ProductMedia[])])
        if (json.poster_url && imageCount === 0) await syncPrimaryImage()
      }
      if (json.bytes && json.original_bytes && json.bytes < json.original_bytes) {
        setVideoNote(`Video compressed from ${(json.original_bytes / 1024 / 1024).toFixed(1)} MB to ${(json.bytes / 1024 / 1024).toFixed(1)} MB.`)
      }
      notifyPublicMenuChanged()
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : 'Failed to save video')
    }
    setSavingVideo(false)
  }

  async function handleDelete(item: ProductMedia) {
    if (!canManage) return
    try {
      if (ownedSource) setMedia(await ownedMediaRequest(productId, { entity: 'media', action: 'delete', id: item.id }))
      else {
        const { error: delError } = await legacyClient().from('product_media').delete().eq('id', item.id)
        if (delError) throw new Error(delError.message)
        setMedia(prev => prev.filter(m => m.id !== item.id))
        await syncPrimaryImage({ clearWhenNone: item.type === 'image' })
      }
      notifyPublicMenuChanged()
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete media') }
  }

  async function handleMove(item: ProductMedia, direction: 'up' | 'down') {
    if (!canManage) return
    const sorted = [...media].sort((a, b) => a.display_order - b.display_order)
    const idx = sorted.findIndex(m => m.id === item.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    const current = sorted[idx]
    const swap = sorted[swapIdx]
    if (ownedSource) {
      try {
        setMedia(await ownedMediaRequest(productId, { entity: 'media', action: 'reorder', firstId: current.id, secondId: swap.id }))
        notifyPublicMenuChanged()
      } catch (moveError) { setError(moveError instanceof Error ? moveError.message : 'Failed to reorder media') }
      return
    }
    const newOrder = current.display_order
    const swapOrder = swap.display_order

    const results = await Promise.all([
      legacyClient().from('product_media').update({ display_order: swapOrder }).eq('id', current.id),
      legacyClient().from('product_media').update({ display_order: newOrder }).eq('id', swap.id),
    ])
    setMedia(prev =>
      prev.map(m => {
        if (m.id === current.id) return { ...m, display_order: swapOrder }
        if (m.id === swap.id) return { ...m, display_order: newOrder }
        return m
      })
    )
    await syncPrimaryImage()
    if (results.every(r => !r.error)) notifyPublicMenuChanged()
  }

  // Points products.image_url at the first gallery image. Reads the gallery
  // from the database: the `media` state is stale right after a change.
  // Without gallery images the existing image_url is kept, unless the last
  // image was just deleted.
  async function syncPrimaryImage({ clearWhenNone = false } = {}) {
    if (ownedSource) return
    const { data } = await legacyClient()
      .from('product_media')
      .select('url')
      .eq('product_id', productId)
      .eq('type', 'image')
      .order('display_order')
      .limit(1)
    const primary = data?.[0]?.url ?? null
    if (!primary && !clearWhenNone) return
    await legacyClient().from('products').update({ image_url: primary }).eq('id', productId)
  }

  const sorted = [...media].sort((a, b) => a.display_order - b.display_order)
  const imageCount = media.filter(m => m.type === 'image').length

  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Media</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Up to 8 images. Videos: upload a file (compressed automatically) or paste a YouTube/Vimeo link.</p>
        </div>
        <div className="flex gap-2">
          {canManage && <button
            type="button"
            onClick={() => setAddingVideo(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Video link
          </button>}
          {canManage && <button
            type="button"
            disabled={savingVideo}
            onClick={() => videoInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            <Film className="w-4 h-4" />
            {savingVideo ? 'Processing video…' : 'Upload video'}
          </button>}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/3gpp"
            className="hidden"
            onChange={e => { void handleVideoFile(e.target.files?.[0]); e.target.value = '' }}
          />
          {canManage && <button
            type="button"
            disabled={uploading || imageCount >= 8}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading…' : 'Upload image'}
          </button>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {addingVideo && (
        <div className="mb-4 flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-[14px] font-medium text-zinc-700 mb-1">Video URL (YouTube, Vimeo, or .mp4)</label>
            <input
              type="url"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
              {canManage && <button
            type="button"
            disabled={savingVideo || !videoUrl.trim()}
            onClick={handleAddVideo}
            className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 disabled:opacity-50"
          >
            {savingVideo ? 'Saving…' : 'Save'}
              </button>}
          <button
            type="button"
            onClick={() => setAddingVideo(false)}
            className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded-lg"
          >
            Cancel
          </button>
        </div>
      )}

      {videoNote && (
        <p className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{videoNote}</p>
      )}

      {error && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : sorted.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-200 rounded-xl py-10 flex flex-col items-center gap-2 text-zinc-400">
          <Upload className="w-8 h-8" />
          <p className="text-sm">No media yet. Upload an image or add a video URL.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-3 bg-zinc-50 rounded-xl p-2 border border-zinc-100">
              <div className="w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-200 relative">
                {item.type === 'image' ? (
                  <Image src={item.url} alt="" fill className="object-cover" sizes="64px" />
                ) : (
                  <VideoThumbnail url={item.url} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.type === 'video' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {item.type}
                  </span>
                  {idx === 0 && item.type === 'image' && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">Primary</span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 truncate mt-0.5">{item.url}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {canManage && <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => handleMove(item, 'up')}
                  className="p-1.5 rounded hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4 text-zinc-600" />
                </button>}
                {canManage && <button
                  type="button"
                  disabled={idx === sorted.length - 1}
                  onClick={() => handleMove(item, 'down')}
                  className="p-1.5 rounded hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4 text-zinc-600" />
                </button>}
                {canManage && <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  className="p-1.5 rounded hover:bg-red-100 text-zinc-400 hover:text-red-600 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
