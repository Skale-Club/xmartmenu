'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { ChevronUp, ChevronDown, Trash2, Upload, Plus } from 'lucide-react'
import type { ProductMedia } from '@/types/database'

interface Props {
  productId: string
  tenantId: string
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

export default function ProductMediaTab({ productId, tenantId }: Props) {
  const supabase = createClient()
  const [media, setMedia] = useState<ProductMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [addingVideo, setAddingVideo] = useState(false)
  const [savingVideo, setSavingVideo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('product_media')
      .select('*')
      .eq('product_id', productId)
      .order('display_order')
    setMedia((data ?? []) as ProductMedia[])
    setLoading(false)
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)

    const MAX = 8
    const remaining = MAX - media.filter(m => m.type === 'image').length
    const toUpload = Array.from(files).slice(0, remaining)

    for (const file of toUpload) {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/products/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        setError('Upload failed for one or more images')
        continue
      }
      const { url } = await res.json()
      const nextOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) + 1 : 0
      const { data: inserted } = await supabase
        .from('product_media')
        .insert({ product_id: productId, tenant_id: tenantId, type: 'image', url, display_order: nextOrder })
        .select()
        .single()
      if (inserted) setMedia(prev => [...prev, inserted as ProductMedia])
    }
    setUploading(false)
    // Sync products.image_url to the lowest display_order image
    await syncPrimaryImage()
  }

  async function handleAddVideo() {
    if (!videoUrl.trim()) return
    setSavingVideo(true)
    setError(null)
    const nextOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) + 1 : 0
    const { data: inserted } = await supabase
      .from('product_media')
      .insert({ product_id: productId, tenant_id: tenantId, type: 'video', url: videoUrl.trim(), display_order: nextOrder })
      .select()
      .single()
    if (inserted) {
      setMedia(prev => [...prev, inserted as ProductMedia])
      setVideoUrl('')
      setAddingVideo(false)
    } else {
      setError('Failed to save video')
    }
    setSavingVideo(false)
  }

  async function handleDelete(item: ProductMedia) {
    const { error: delError } = await supabase.from('product_media').delete().eq('id', item.id)
    if (delError) { setError(delError.message); return }
    setMedia(prev => prev.filter(m => m.id !== item.id))
    await syncPrimaryImage()
  }

  async function handleMove(item: ProductMedia, direction: 'up' | 'down') {
    const sorted = [...media].sort((a, b) => a.display_order - b.display_order)
    const idx = sorted.findIndex(m => m.id === item.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    const current = sorted[idx]
    const swap = sorted[swapIdx]
    const newOrder = current.display_order
    const swapOrder = swap.display_order

    await Promise.all([
      supabase.from('product_media').update({ display_order: swapOrder }).eq('id', current.id),
      supabase.from('product_media').update({ display_order: newOrder }).eq('id', swap.id),
    ])
    setMedia(prev =>
      prev.map(m => {
        if (m.id === current.id) return { ...m, display_order: swapOrder }
        if (m.id === swap.id) return { ...m, display_order: newOrder }
        return m
      })
    )
    await syncPrimaryImage()
  }

  async function syncPrimaryImage() {
    const images = media
      .filter(m => m.type === 'image')
      .sort((a, b) => a.display_order - b.display_order)
    const primary = images[0]?.url ?? null
    await supabase.from('products').update({ image_url: primary }).eq('id', productId)
  }

  const sorted = [...media].sort((a, b) => a.display_order - b.display_order)
  const imageCount = media.filter(m => m.type === 'image').length

  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Media</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Up to 8 images. One video (YouTube, Vimeo, or .mp4).</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddingVideo(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Video
          </button>
          <button
            type="button"
            disabled={uploading || imageCount >= 8}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading…' : 'Upload image'}
          </button>
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
            <label className="block text-xs font-medium text-zinc-600 mb-1">Video URL (YouTube, Vimeo, or .mp4)</label>
            <input
              type="url"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <button
            type="button"
            disabled={savingVideo || !videoUrl.trim()}
            onClick={handleAddVideo}
            className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 disabled:opacity-50"
          >
            {savingVideo ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setAddingVideo(false)}
            className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded-lg"
          >
            Cancel
          </button>
        </div>
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
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => handleMove(item, 'up')}
                  className="p-1.5 rounded hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4 text-zinc-600" />
                </button>
                <button
                  type="button"
                  disabled={idx === sorted.length - 1}
                  onClick={() => handleMove(item, 'down')}
                  className="p-1.5 rounded hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4 text-zinc-600" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  className="p-1.5 rounded hover:bg-red-100 text-zinc-400 hover:text-red-600 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
