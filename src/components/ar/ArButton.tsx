'use client'

/**
 * "See it on your table" on a dish: opens the phone's camera with the dish on the table
 * at its real size, through the phone's own AR viewer (src/lib/ar/launch.ts).
 * There is no 3D view in the page.
 *
 *   Android   Scene Viewer (AR only). Without Google Play Services for AR the
 *             browser comes back with AR_UNAVAILABLE_HASH and a notice shows.
 *   iPhone    AR Quick Look with the dish's USDZ; an old model without one is
 *             converted on the phone first (three.js, loaded only then).
 *   other     no button: a computer (or an iPhone in-app browser) has no AR camera.
 */

import { useEffect, useState } from 'react'
import { Box, Loader2 } from 'lucide-react'
import type { PublicProductArModel } from '@/types/database'
import {
  AR_UNAVAILABLE_HASH,
  arFallbackUrl,
  arPlatform,
  currentArEnvironment,
  openQuickLook,
  quickLookUrl,
  sceneViewerIntentUrl,
  type ArPlatform,
} from '@/lib/ar/launch'
import { getArCopy } from './ar-copy'

export interface ArButtonProps {
  model: Pick<PublicProductArModel, 'glb_url' | 'usdz_url' | 'real_scale'>
  /** Dish name: Scene Viewer's title. */
  name: string
  lang: string
  /** The guest tapped the button. */
  onOpen?: () => void
  /** The phone's AR viewer was launched. */
  onArLaunch?: () => void
  className?: string
  /** Only the cube, named for screen readers (the feed's round buttons). */
  iconOnly?: boolean
}

/** The phone's AR viewer, known only in the browser: null on the server, on a computer or without an AR camera. */
export function useArPlatform(): ArPlatform | null {
  const [platform, setPlatform] = useState<ArPlatform | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device is only known after mount
    setPlatform(arPlatform(currentArEnvironment()))
  }, [])
  return platform
}

/**
 * The small cube on a dish card's photo: "this dish can be seen on your table".
 * Not a button (the card opens the dish, where the AR button is); hidden where AR cannot open.
 */
export function ArBadge({ lang, className }: { lang: string; className?: string }) {
  const platform = useArPlatform()
  if (!platform) return null
  return (
    <span role="img" aria-label={getArCopy(lang).available} title={getArCopy(lang).available} className={className}>
      <Box className="size-3.5" strokeWidth={2} aria-hidden />
    </span>
  )
}

export default function ArButton({ model, name, lang, onOpen, onArLaunch, className, iconOnly = false }: ArButtonProps) {
  const copy = getArCopy(lang)
  // Nothing renders on the server or without an AR camera.
  const platform = useArPlatform()
  const [notice, setNotice] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)

  // Android without Google Play Services for AR comes back to the menu with the hash.
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== AR_UNAVAILABLE_HASH) return
      setNotice(copy.arUnavailable)
      history.replaceState(history.state, '', window.location.href.split('#')[0])
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [copy.arUnavailable])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function openOnIphone() {
    if (model.usdz_url) {
      onArLaunch?.()
      openQuickLook(quickLookUrl(model.usdz_url, model.real_scale))
      return
    }
    setPreparing(true)
    try {
      const { glbToUsdz } = await import('@/lib/ar/usdz-export')
      const glb = await fetch(model.glb_url).then(res => {
        if (!res.ok) throw new Error(`GLB ${res.status}`)
        return res.arrayBuffer()
      })
      const usdz = await glbToUsdz(glb)
      const url = URL.createObjectURL(new Blob([usdz.slice().buffer], { type: 'model/vnd.usdz+zip' }))
      onArLaunch?.()
      openQuickLook(quickLookUrl(url, model.real_scale))
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setNotice(copy.arUnavailable)
    } finally {
      setPreparing(false)
    }
  }

  async function handleClick() {
    if (preparing || !platform) return
    onOpen?.()
    if (platform === 'scene-viewer') {
      onArLaunch?.()
      window.location.href = sceneViewerIntentUrl({
        glbUrl: model.glb_url,
        title: name,
        fallbackUrl: arFallbackUrl(window.location.href),
        realScale: model.real_scale,
      })
      return
    }
    await openOnIphone()
  }

  if (!platform) return notice ? <ArNotice text={notice} /> : null

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-busy={preparing}
        aria-label={iconOnly ? (preparing ? copy.preparing : copy.viewOnTable) : undefined}
        className={className ?? 'inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-sm backdrop-blur'}
      >
        {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Box className="size-4" aria-hidden />}
        {iconOnly ? null : preparing ? copy.preparing : copy.viewOnTable}
      </button>

      {notice && <ArNotice text={notice} />}
    </>
  )
}

function ArNotice({ text }: { text: string }) {
  return (
    <div role="status" className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto max-w-sm rounded-2xl bg-zinc-900 px-4 py-3 text-center text-sm text-white shadow-float">
      {text}
    </div>
  )
}
