'use client'

/**
 * Full-screen 3D view of a dish, opened from the dish detail ("View in 3D").
 * Guests turn the model around; on a phone that supports it, "View on your
 * table" opens the camera and places the dish at its real size.
 */

import { useState } from 'react'
import { X } from 'lucide-react'
import ModalPortal from '@/components/ui/ModalPortal'
import type { PublicProductArModel } from '@/types/database'
import ModelViewer from './ModelViewer'
import { getArCopy } from './ar-copy'

export interface ArViewerSheetProps {
  model: Pick<PublicProductArModel, 'glb_url' | 'usdz_url' | 'poster_url' | 'real_scale'>
  /** Dish name, for the title and the model's alt text. */
  name: string
  /** Fallback poster when the model has none (the dish photo). */
  fallbackPoster?: string | null
  lang: string
  closeLabel: string
  onClose: () => void
  onArLaunch?: () => void
}

export default function ArViewerSheet({ model, name, fallbackPoster, lang, closeLabel, onClose, onArLaunch }: ArViewerSheetProps) {
  const copy = getArCopy(lang)
  const [arAvailable, setArAvailable] = useState<boolean | null>(null)
  const [failed, setFailed] = useState(false)

  return (
    <ModalPortal onClose={onClose}>
      <div className="menu-root fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-zinc-50 to-zinc-200" role="dialog" aria-modal="true" aria-label={`${name} · ${copy.view3d}`}>
        <div className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{copy.view3d}</p>
            <h2 className="truncate text-lg font-semibold text-zinc-900">{name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 shadow-sm"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          {failed ? (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-600">{copy.loadError}</div>
          ) : (
            <ModelViewer
              key={model.glb_url}
              src={model.glb_url}
              iosSrc={model.usdz_url}
              poster={model.poster_url ?? fallbackPoster}
              alt={name}
              realScale={model.real_scale}
              arLabel={copy.viewOnTable}
              onArLaunch={onArLaunch}
              onArAvailability={setArAvailable}
              onError={() => setFailed(true)}
              className="block h-full w-full"
            />
          )}
        </div>

        {!failed && (
          <p className="px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-zinc-500">
            {arAvailable === false ? copy.noAr : copy.gestures}
          </p>
        )}
      </div>
    </ModalPortal>
  )
}
