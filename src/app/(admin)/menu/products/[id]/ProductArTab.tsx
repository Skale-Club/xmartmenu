'use client'

/**
 * 3D & augmented reality for one dish (product_ar_models).
 *
 * The restaurant uploads a GLB. Right after, this page converts it to the iOS
 * file (USDZ, src/lib/ar/usdz-export.ts) and uploads that too, so the dish
 * opens on Android (Scene Viewer) and iPhone (Quick Look) alike. A hand-made
 * USDZ can replace the generated one.
 *
 * Guests tap "View in 3D" in the dish detail and the phone's camera opens with
 * the dish on their table (src/components/ar/ArButton.tsx). The preview here is
 * only for the restaurant to check the model.
 */

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Box, Smartphone, Trash2, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { notifyPublicMenuChanged } from '@/lib/menu/revalidate-client'
import { AR_MODEL_ACCEPT, AR_MODEL_CONTENT_TYPES, RECOMMENDED_AR_MODEL_BYTES, formatModelSize, type ArModelFormat } from '@/lib/ar/model-file'
import type { ProductArModel } from '@/types/database'

const ModelViewer = dynamic(() => import('@/components/ar/ModelViewer'), { ssr: false })

interface Props {
  productId: string
  tenantId: string
  canManage: boolean
  /** Owned database: read and write through the product catalog API. */
  ownedSource?: boolean
}

type UploadResult = { url: string; storage_path: string; bytes: number; heavy: boolean }
type ArPatch = Partial<Pick<ProductArModel, 'glb_url' | 'glb_storage_path' | 'glb_bytes' | 'usdz_url' | 'usdz_storage_path' | 'usdz_bytes' | 'poster_url' | 'real_scale'>>

/** Where the model is stored: the owned catalog API, or Supabase (legacy). */
interface ArStore {
  load(): Promise<ProductArModel | null>
  save(current: ProductArModel | null, patch: ArPatch): Promise<ProductArModel | null>
  remove(current: ProductArModel): Promise<void>
}

function ownedStore(productId: string): ArStore {
  async function request(action: 'list' | 'patch' | 'delete', values?: ArPatch): Promise<ProductArModel | null> {
    const response = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/catalog`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values ? { entity: 'ar', action, values } : { entity: 'ar', action }),
    })
    const result = await response.json().catch(() => ({})) as (ProductArModel & { error?: string }) | null
    if (!response.ok) throw new Error(result?.error || '3D model update failed')
    return result && 'id' in result ? result : null
  }
  return {
    load: () => request('list'),
    save: (_current, patch) => request('patch', patch),
    remove: async () => { await request('delete') },
  }
}

function legacyStore(productId: string, tenantId: string): ArStore {
  const supabase = createClient()
  return {
    async load() {
      const { data, error } = await supabase.from('product_ar_models').select('*').eq('product_id', productId).maybeSingle()
      if (error) throw new Error('3D models are not available yet (database not migrated).')
      return (data as ProductArModel | null) ?? null
    },
    async save(current, patch) {
      const { data, error } = current
        ? await supabase.from('product_ar_models').update(patch).eq('id', current.id).select().single()
        : await supabase.from('product_ar_models').insert({ product_id: productId, tenant_id: tenantId, ...patch }).select().single()
      if (error) throw new Error(error.message)
      return data as ProductArModel
    },
    async remove(current) {
      const { error } = await supabase.from('product_ar_models').delete().eq('id', current.id)
      if (error) throw new Error(error.message)
    },
  }
}

const message = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback

export default function ProductArTab({ productId, tenantId, canManage, ownedSource = false }: Props) {
  const [store] = useState<ArStore>(() => ownedSource ? ownedStore(productId) : legacyStore(productId, tenantId))
  const [model, setModel] = useState<ProductArModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<ArModelFormat | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const glbInputRef = useRef<HTMLInputElement>(null)
  const usdzInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    store.load()
      .then(loaded => { if (!cancelled) setModel(loaded) })
      .catch(err => { if (!cancelled) setError(message(err, 'Failed to load the 3D model')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [store])

  async function upload(file: File, format: ArModelFormat): Promise<UploadResult | null> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('format', format)
    const res = await fetch('/api/admin/products/upload-ar-model', { method: 'POST', body: fd })
    const json = await res.json().catch(() => ({})) as Partial<UploadResult> & { error?: string }
    if (!res.ok || !json.url) {
      setError(json.error ?? 'Upload failed')
      return null
    }
    return json as UploadResult
  }

  async function save(patch: ArPatch): Promise<boolean> {
    try {
      setModel(await store.save(model, patch))
      notifyPublicMenuChanged()
      return true
    } catch (err) {
      setError(message(err, 'Failed to save the 3D model'))
      return false
    }
  }

  /** The iOS file made from the GLB and uploaded; null (with the reason shown) when that fails. */
  async function generatedUsdz(glb: ArrayBuffer): Promise<ArPatch | null> {
    try {
      const { glbToUsdz } = await import('@/lib/ar/usdz-export')
      const usdz = await glbToUsdz(glb)
      const uploaded = await upload(new File([usdz.slice().buffer], 'model.usdz', { type: AR_MODEL_CONTENT_TYPES.usdz }), 'usdz')
      return uploaded ? { usdz_url: uploaded.url, usdz_storage_path: uploaded.storage_path, usdz_bytes: uploaded.bytes } : null
    } catch {
      setNotice('The iOS file could not be made from this model; iPhones will convert it when a guest opens it, which is slower. You can upload a .usdz made in Reality Converter instead.')
      return null
    }
  }

  async function handleFile(file: File | undefined, format: ArModelFormat) {
    if (!file) return
    setBusy(format)
    setError(null)
    setNotice(null)
    const uploaded = await upload(file, format)
    if (!uploaded) { setBusy(null); return }

    let patch: ArPatch
    if (format === 'glb') {
      // A new model replaces the iOS file too: the old one would show the old dish.
      const usdz = await generatedUsdz(await file.arrayBuffer())
      patch = {
        glb_url: uploaded.url, glb_storage_path: uploaded.storage_path, glb_bytes: uploaded.bytes,
        ...(usdz ?? { usdz_url: null, usdz_storage_path: null, usdz_bytes: null }),
      }
    } else {
      patch = { usdz_url: uploaded.url, usdz_storage_path: uploaded.storage_path, usdz_bytes: uploaded.bytes }
    }

    if (await save(patch)) {
      setPreviewFailed(false)
      if (uploaded.heavy) {
        setNotice(`This file is ${formatModelSize(uploaded.bytes)}. Models above ${formatModelSize(RECOMMENDED_AR_MODEL_BYTES)} take a while to open on mobile data; reduce triangles and textures (gltf-transform simplify + resize).`)
      }
    }
    setBusy(null)
  }

  async function rebuildUsdz() {
    if (!model) return
    setBusy('usdz')
    setError(null)
    setNotice(null)
    try {
      const glb = await fetch(model.glb_url).then(res => {
        if (!res.ok) throw new Error(`Could not download the model (${res.status})`)
        return res.arrayBuffer()
      })
      const usdz = await generatedUsdz(glb)
      if (usdz) await save(usdz)
    } catch (err) {
      setError(message(err, 'Could not rebuild the iOS file'))
    }
    setBusy(null)
  }

  async function update(patch: ArPatch) {
    if (!model) return
    setBusy('save')
    setError(null)
    await save(patch)
    setBusy(null)
  }

  async function removeModel() {
    if (!model) return
    if (!window.confirm('Remove the 3D model from this dish? Guests will no longer see "View in 3D".')) return
    setBusy('save')
    setError(null)
    try {
      await store.remove(model)
      setModel(null)
      setNotice(null)
      notifyPublicMenuChanged()
    } catch (err) {
      setError(message(err, 'Failed to remove the 3D model'))
    }
    setBusy(null)
  }

  const disabled = !canManage || busy !== null

  return (
    <div className="mt-6 bg-white border border-zinc-200 rounded-lg shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Box className="w-4 h-4" /> 3D &amp; augmented reality
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-xl">
            Upload a 3D model of the dish (.glb, modelled in metres at its real size, ideally under {formatModelSize(RECOMMENDED_AR_MODEL_BYTES)}).
            Guests tap &ldquo;View in 3D&rdquo; and their phone&rsquo;s camera shows the dish on their table. Use a plain glTF 2.0 file (no Draco or meshopt compression, up to 100k triangles, textures up to 2048 px): Android&rsquo;s AR viewer cannot open compressed models.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => glbInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {busy === 'glb' ? 'Uploading…' : model ? 'Replace model' : 'Upload model (.glb)'}
            </button>
            <input
              ref={glbInputRef}
              type="file"
              accept={AR_MODEL_ACCEPT.glb}
              className="hidden"
              onChange={e => { void handleFile(e.target.files?.[0], 'glb'); e.target.value = '' }}
            />
          </div>
        )}
      </div>

      {notice && <p className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>}
      {error && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : !model ? (
        <div className="border-2 border-dashed border-zinc-200 rounded-xl py-10 flex flex-col items-center gap-2 text-zinc-400">
          <Box className="w-8 h-8" />
          <p className="text-sm">No 3D model yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative aspect-square rounded-xl overflow-hidden bg-gradient-to-b from-zinc-50 to-zinc-200">
            {previewFailed ? (
              <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-600">
                The model could not be displayed. Check that the file opens in a glTF viewer, and that the storage bucket allows cross-origin reads (CORS).
              </p>
            ) : (
              <ModelViewer
                key={model.glb_url}
                src={model.glb_url}
                iosSrc={model.usdz_url}
                poster={model.poster_url}
                alt="3D preview"
                realScale={model.real_scale}
                arLabel="View on a table"
                onError={() => setPreviewFailed(true)}
                className="block h-full w-full"
              />
            )}
          </div>

          <div className="space-y-4 text-sm">
            <dl className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Model (GLB)</dt>
                <dd className="text-zinc-900 font-medium">{formatModelSize(model.glb_bytes) || 'Uploaded'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" /> iOS file (USDZ)</dt>
                <dd className="text-zinc-900 font-medium">
                  {model.usdz_url ? formatModelSize(model.usdz_bytes) || 'Uploaded' : <span className="text-zinc-400 font-normal">Made on the guest&rsquo;s iPhone (slower)</span>}
                </dd>
              </div>
            </dl>

            <label className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={model.real_scale}
                disabled={disabled}
                onChange={e => void update({ real_scale: e.target.checked })}
              />
              <span>
                <span className="block font-medium text-zinc-900">Show at real size</span>
                <span className="block text-xs text-zinc-500">Guests see the true portion on their table. Turn off to let them resize the dish.</span>
              </span>
            </label>

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => usdzInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                >
                  <Smartphone className="w-4 h-4" />
                  {busy === 'usdz' ? 'Uploading…' : model.usdz_url ? 'Replace iOS file' : 'Add iOS file (.usdz)'}
                </button>
                <input
                  ref={usdzInputRef}
                  type="file"
                  accept={AR_MODEL_ACCEPT.usdz}
                  className="hidden"
                  onChange={e => { void handleFile(e.target.files?.[0], 'usdz'); e.target.value = '' }}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void rebuildUsdz()}
                  className="px-3 py-1.5 text-sm text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-50"
                >
                  Rebuild iOS file from the model
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void removeModel()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove 3D model
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
