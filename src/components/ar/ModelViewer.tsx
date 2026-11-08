'use client'

/**
 * A dish's 3D model: turn it around on the page, and on a phone place it on
 * the table through the camera.
 *
 * Built on Google's <model-viewer>, which picks the AR route per device:
 *   Android   WebXR in Chrome, else Scene Viewer (Google app)
 *   iOS       Quick Look, with the USDZ file when there is one, else a USDZ
 *             it converts from the GLB on the fly
 *   desktop   3D only; `onArAvailability(false)` lets the caller say so
 *
 * The library (~1 MB with three.js) is imported only when this component
 * mounts, so menus without 3D models never download it.
 *
 * Give it `key={src}` when the model can change, so loading state resets.
 */

import { useEffect, useRef, useState } from 'react'
import { Box, Loader2 } from 'lucide-react'

let libraryLoad: Promise<unknown> | null = null
function loadModelViewer(): Promise<unknown> {
  libraryLoad ??= import('@google/model-viewer').catch(err => {
    libraryLoad = null // allow a retry on the next open
    throw err
  })
  return libraryLoad
}

export interface ModelViewerProps {
  /** glTF binary (.glb). */
  src: string
  /** Optional USDZ for iOS Quick Look. */
  iosSrc?: string | null
  poster?: string | null
  alt: string
  /** AR at the modelled size (metres): guests see the real portion. */
  realScale?: boolean
  /** Text of the "place it on the table" button. */
  arLabel: string
  /** Called when the guest taps the AR button (any AR route). */
  onArLaunch?: () => void
  /** Whether this device can open AR, known once the model has loaded. */
  onArAvailability?: (available: boolean) => void
  onError?: () => void
  className?: string
}

type ModelViewerElement = HTMLElement & { canActivateAR?: boolean }

export default function ModelViewer({
  src,
  iosSrc,
  poster,
  alt,
  realScale = true,
  arLabel,
  onArLaunch,
  onArAvailability,
  onError,
  className,
}: ModelViewerProps) {
  const [libraryReady, setLibraryReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const viewerRef = useRef<ModelViewerElement | null>(null)

  // Callbacks change on every parent render; the listeners read the latest.
  const callbacks = useRef({ onArLaunch, onArAvailability, onError })
  useEffect(() => {
    callbacks.current = { onArLaunch, onArAvailability, onError }
  })

  useEffect(() => {
    let cancelled = false
    loadModelViewer()
      .then(() => { if (!cancelled) setLibraryReady(true) })
      .catch(() => { if (!cancelled) callbacks.current.onError?.() })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const el = viewerRef.current
    if (!libraryReady || !el) return
    const handleProgress = (e: Event) => {
      const total = (e as CustomEvent<{ totalProgress?: number }>).detail?.totalProgress
      if (typeof total === 'number') setProgress(total)
    }
    const handleLoad = () => {
      setLoaded(true)
      callbacks.current.onArAvailability?.(el.canActivateAR === true)
    }
    const handleError = () => callbacks.current.onError?.()
    el.addEventListener('progress', handleProgress)
    el.addEventListener('load', handleLoad)
    el.addEventListener('error', handleError)
    return () => {
      el.removeEventListener('progress', handleProgress)
      el.removeEventListener('load', handleLoad)
      el.removeEventListener('error', handleError)
    }
  }, [libraryReady, src])

  if (!libraryReady) {
    return (
      <div className={`flex items-center justify-center bg-zinc-100 ${className ?? ''}`}>
        <Loader2 className="size-6 animate-spin text-zinc-400" aria-hidden />
      </div>
    )
  }

  return (
    <model-viewer
      ref={viewerRef}
      src={src}
      ios-src={iosSrc ?? undefined}
      poster={poster ?? undefined}
      alt={alt}
      ar
      ar-modes="webxr scene-viewer quick-look"
      ar-scale={realScale ? 'fixed' : 'auto'}
      ar-placement="floor"
      camera-controls
      touch-action="pan-y"
      auto-rotate
      rotation-per-second="20deg"
      interaction-prompt="none"
      shadow-intensity="1"
      shadow-softness="0.8"
      environment-image="neutral"
      exposure="1"
      loading="eager"
      className={className}
      style={{ backgroundColor: 'transparent' }}
    >
      {/* Shown by model-viewer only on devices that can open AR. */}
      <button
        type="button"
        slot="ar-button"
        onClick={() => callbacks.current.onArLaunch?.()}
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-float transition-[scale] active:scale-95"
      >
        <Box className="size-4" aria-hidden />
        {arLabel}
      </button>
      {!loaded && (
        <div slot="progress-bar" className="absolute inset-x-0 top-0 h-1 bg-zinc-200">
          <div className="h-full bg-zinc-900 transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </model-viewer>
  )
}
