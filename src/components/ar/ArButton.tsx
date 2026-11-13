'use client'

/**
 * "See it on your table" on a dish: opens the phone's camera with the dish on the table
 * at its real size, through the phone's own AR viewer (src/lib/ar/launch.ts).
 * There is no 3D view in the page.
 *
 *   Android   WebXR in the browser with our own viewer
 *             (src/lib/ar/webxr-dish-session.ts + WebXrDishViewer.tsx): the
 *             camera looks for the table first, a ring shows where the dish
 *             will go, a tap places it at real size; drag, twist and pinch move,
 *             turn and resize it, and the order bar adds it to the cart. The
 *             module and the model load while the dish is open, so the tap
 *             starts the session at once (WebXR needs the tap).
 *             Without WebXR AR, the Scene Viewer intent through the Google app;
 *             without the Google app the browser comes back with
 *             AR_UNAVAILABLE_HASH and a notice shows.
 *             (Scene Viewer only flashed and returned on a Galaxy S24, where
 *             WebXR works: 2026-11-09.)
 *   iPhone    AR Quick Look with the dish's USDZ (Quick Look finds the table,
 *             places the dish at real size and lets the guest resize it); an
 *             old model without a USDZ is converted on the phone first. With a
 *             cart, Quick Look shows its own "Add to order" button: a dish
 *             without choices is added, one with choices comes back to them.
 *   other     no button: a computer (or an iPhone in-app browser) has no AR camera.
 *             On a computer the dish sheet offers its 3D viewer instead
 *             (useIsComputer, ProductModal + ModelViewer).
 */

import { useEffect, useRef, useState } from 'react'
import { Box, Loader2 } from 'lucide-react'
import type { PublicProductArModel } from '@/types/database'
import {
  AR_UNAVAILABLE_HASH,
  arFallbackUrl,
  arPlatform,
  currentArEnvironment,
  isComputer,
  openQuickLook,
  quickLookUrl,
  sceneViewerIntentUrl,
  sceneViewerModelUrl,
  type ArPlatform,
} from '@/lib/ar/launch'
import { getArCopy } from './ar-copy'
import WebXrDishViewer, { type ArCart, type ArDishDetails, type ArTheme } from './WebXrDishViewer'
import { measureArZones } from './ar-zones'
import { mayPreload, neighbours, stepDish } from '@/lib/ar/dish-sequence'
import type { DishSession, DishStage } from '@/lib/ar/webxr-dish-session'

export type { ArCart, ArDishDetails, ArTheme } from './WebXrDishViewer'

export interface ArButtonProps {
  model: Pick<PublicProductArModel, 'glb_url' | 'usdz_url' | 'real_scale'> & { scale?: number | null }
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
  /** Ordering from the camera (Android); absent on a browse-only menu. */
  cart?: ArCart | null
  /** Unit price for the camera's price capsule (every menu type). */
  priceLabel?: string
  /** Description and ingredients for the camera's details sheet. */
  details?: ArDishDetails | null
  /** The store's primary and secondary colours. */
  theme?: ArTheme
  /**
   * The menu's 3D dishes in menu order, to walk through inside the camera
   * (Android WebXR). `startId` is this button's dish; the others bring their
   * own name, model, price, details and cart actions.
   */
  sequence?: { items: ArSequenceItem[]; startId: string } | null
}

/** One dish of the AR carousel. */
export interface ArSequenceItem {
  id: string
  name: string
  model: ArButtonProps['model']
  priceLabel?: string
  details?: ArDishDetails | null
  cart?: ArCart | null
}

type DishSessionModule = typeof import('@/lib/ar/webxr-dish-session')

let sessionModuleLoad: Promise<DishSessionModule> | null = null
function loadSessionModule(): Promise<DishSessionModule> {
  sessionModuleLoad ??= import('@/lib/ar/webxr-dish-session').catch(error => {
    sessionModuleLoad = null
    throw error
  })
  return sessionModuleLoad
}

/** Android: how the tap opens AR, known once the module and the model are ready. */
type AndroidRoute = 'loading' | 'webxr' | 'intent'

/** The phone's AR viewer, known only in the browser: null on the server, on a computer or without an AR camera. */
export function useArPlatform(): ArPlatform | null {
  const [platform, setPlatform] = useState<ArPlatform | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device is only known after mount
    setPlatform(arPlatform(currentArEnvironment()))
  }, [])
  return platform
}

/** True on a computer (no phone or tablet), known only in the browser: the dish sheet shows a 3D viewer. */
export function useIsComputer(): boolean {
  const [computer, setComputer] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device is only known after mount
    setComputer(isComputer(currentArEnvironment()))
  }, [])
  return computer
}

/**
 * The small cube on a dish card's photo: "this dish can be seen on your table"
 * (on a computer: "in 3D", in the dish sheet's viewer). Not a button (the card
 * opens the dish); hidden where neither AR nor the viewer is available.
 */
export function ArBadge({ lang, className }: { lang: string; className?: string }) {
  const platform = useArPlatform()
  const computer = useIsComputer()
  if (!platform && !computer) return null
  const label = platform ? getArCopy(lang).available : getArCopy(lang).view3d
  return (
    <span role="img" aria-label={label} title={label} className={className}>
      <Box className="size-3.5" strokeWidth={2} aria-hidden />
    </span>
  )
}

export default function ArButton({ model, name, lang, onOpen, onArLaunch, className, iconOnly = false, cart = null, priceLabel, details = null, theme, sequence = null }: ArButtonProps) {
  const copy = getArCopy(lang)
  // Nothing renders on the server or without an AR camera.
  const platform = useArPlatform()
  const [notice, setNotice] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  // Android: the WebXR viewer, ready before the tap.
  const [route, setRoute] = useState<AndroidRoute>('loading')
  const [arActive, setArActive] = useState(false)
  const [stage, setStage] = useState<DishStage>('scanning')
  const [trackingLost, setTrackingLost] = useState(false)
  // The carousel: which dish is on the table, and its model's download.
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loadingPercent, setLoadingPercent] = useState<number | null | undefined>(undefined)
  const moduleRef = useRef<DishSessionModule | null>(null)
  const sessionRef = useRef<DishSession | null>(null)
  const sessionAbortRef = useRef<AbortController | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const gestureLayerRef = useRef<HTMLDivElement | null>(null)

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

  // Android: as soon as the dish is open, load the viewer and the model and
  // check WebXR AR, so the tap starts the camera at once.
  useEffect(() => {
    if (platform !== 'scene-viewer') return
    let cancelled = false
    loadSessionModule()
      .then(async loaded => {
        moduleRef.current = loaded
        const supported = await loaded.webXrArSupported()
        if (!supported) return 'intent' as const
        await loaded.preloadDish(model.glb_url)
        return 'webxr' as const
      })
      .catch(() => 'intent' as const)
      .then(next => { if (!cancelled) setRoute(next) })
    return () => { cancelled = true }
  }, [platform, model.glb_url])

  // Leaving the dish (or the menu) ends a running session.
  useEffect(() => () => {
    sessionAbortRef.current?.abort()
    sessionRef.current?.end()
  }, [])

  function stopWebXr() {
    sessionAbortRef.current?.abort()
    sessionRef.current?.end()
    setArActive(false)
  }

  function startWebXr() {
    const viewer = moduleRef.current
    const overlay = overlayRef.current
    const gestureLayer = gestureLayerRef.current
    if (!viewer || !overlay || !gestureLayer || sessionAbortRef.current) return false
    const controller = new AbortController()
    sessionAbortRef.current = controller
    setStage('scanning')
    setTrackingLost(false)
    setCurrentId(sequence?.startId ?? null)
    setLoadingPercent(undefined)
    setArActive(true)
    if (sequence) preloadAround(sequence.startId)
    // startDishSession requests the session first thing, inside this tap.
    viewer.startDishSession({
      glbUrl: model.glb_url,
      modelScale: model.scale ?? 1,
      overlay,
      gestureLayer,
      // Gesture zoning: only touches that start in the scene reach the dish.
      zones: () => measureArZones(overlay),
      signal: controller.signal,
      onStage: setStage,
      onTracking: setTrackingLost,
      onEnd: () => {
        if (sessionAbortRef.current !== controller) return
        sessionAbortRef.current = null
        sessionRef.current = null
        if (!controller.signal.aborted) setArActive(false)
      },
    }).then(session => {
      if (controller.signal.aborted || sessionAbortRef.current !== controller) session.end()
      else sessionRef.current = session
    }).catch(() => {
      if (controller.signal.aborted || (sessionAbortRef.current && sessionAbortRef.current !== controller)) return
      if (sessionAbortRef.current === controller) sessionAbortRef.current = null
      setArActive(false)
      setNotice(copy.arUnavailable)
    })
    return true
  }

  // The dish on screen: this button's own, or another one picked in the carousel.
  const sequenceItem = sequence && currentId && currentId !== sequence.startId
    ? sequence.items.find(item => item.id === currentId) ?? null
    : null
  const shown = sequenceItem
    ? { name: sequenceItem.name, model: sequenceItem.model, priceLabel: sequenceItem.priceLabel, details: sequenceItem.details ?? null, cart: sequenceItem.cart ?? null }
    : { name, model, priceLabel, details, cart }

  /** Downloads the dishes next to `id` in the background (not in data-saving mode). */
  function preloadAround(id: string) {
    const viewer = moduleRef.current
    if (!viewer || !sequence) return
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (!mayPreload(connection)) return
    for (const item of neighbours(sequence.items, id)) viewer.preloadDish(item.model.glb_url).catch(() => {})
  }

  /** Swipe / chevron: show the next or previous 3D dish on the same spot. */
  function stepCarousel(direction: 'next' | 'prev') {
    if (!sequence) return
    const next = stepDish(sequence.items, currentId ?? sequence.startId, direction)
    const session = sessionRef.current
    if (!next || !session) return
    setCurrentId(next.id)
    session.swapDish(next.model.glb_url, next.model.scale ?? 1, percent => {
      setLoadingPercent(percent === 100 ? undefined : percent)
    }).then(shownNow => {
      if (shownNow) setLoadingPercent(undefined)
    }).catch(() => setLoadingPercent(undefined))
    preloadAround(next.id)
  }

  const carouselIndex = sequence ? sequence.items.findIndex(item => item.id === (currentId ?? sequence.startId)) : -1
  const carousel = sequence && sequence.items.length > 1 && carouselIndex >= 0
    ? { index: carouselIndex, total: sequence.items.length, onPrev: () => stepCarousel('prev'), onNext: () => stepCarousel('next') }
    : null

  /** "Choose options": leave the camera, then let the sheet show the missing choice. */
  function chooseFromCamera() {
    stopWebXr()
    shown.cart?.onChoose()
  }

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /** Quick Look's order button, and what tapping it does. */
  const quickLookAction = cart ? {
    label: cart.mode === 'add' ? copy.addToOrder : copy.chooseOptions,
    title: name,
    subtitle: cart.mode === 'add' ? cart.priceLabel : undefined,
  } : null
  function onQuickLookAction() {
    if (!cart) return
    if (cart.mode === 'choose') { cart.onChoose(); return }
    cart.onAdd()
    setNotice(copy.added.replace('{count}', String(cart.count + 1)))
  }

  async function openOnIphone() {
    if (model.usdz_url) {
      onArLaunch?.()
      openQuickLook(quickLookUrl(model.usdz_url, quickLookAction, { realScale: model.real_scale }), cart ? onQuickLookAction : undefined)
      return
    }
    setPreparing(true)
    try {
      const { glbToUsdz } = await import('@/lib/ar/usdz-export')
      const glb = await fetch(model.glb_url).then(res => {
        if (!res.ok) throw new Error(`GLB ${res.status}`)
        return res.arrayBuffer()
      })
      const usdz = await glbToUsdz(glb, { scale: model.scale ?? 1 })
      const url = URL.createObjectURL(new Blob([usdz.slice().buffer], { type: 'model/vnd.usdz+zip' }))
      onArLaunch?.()
      openQuickLook(quickLookUrl(url, quickLookAction, { realScale: model.real_scale }), cart ? onQuickLookAction : undefined)
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
      if (route === 'webxr') {
        // Inside the tap: WebXR only starts from a user gesture.
        if (startWebXr()) onArLaunch?.()
        return
      }
      if (route === 'loading') {
        // Still downloading the dish (a slow connection): the next tap starts AR.
        setPreparing(true)
        loadSessionModule()
          .then(loaded => loaded.preloadDish(model.glb_url))
          .catch(() => {})
          .finally(() => setPreparing(false))
        return
      }
      onArLaunch?.()
      window.location.href = sceneViewerIntentUrl({
        glbUrl: sceneViewerModelUrl(model.glb_url, model.scale, window.location.origin),
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

      {platform === 'scene-viewer' && route === 'webxr' && (
        <WebXrDishViewer
          active={arActive}
          stage={stage}
          name={shown.name}
          copy={copy}
          language={lang}
          cart={shown.cart && shown.cart.onOpenCart ? {
            ...shown.cart,
            // "Go to cart": leave the camera first, then open the menu's cart.
            onOpenCart: () => { stopWebXr(); shown.cart?.onOpenCart?.() },
          } : shown.cart}
          priceLabel={shown.priceLabel}
          details={shown.details}
          theme={theme}
          carousel={carousel}
          loadingPercent={loadingPercent}
          overlayRef={overlayRef}
          gestureLayerRef={gestureLayerRef}
          onExit={stopWebXr}
          onReposition={() => sessionRef.current?.reposition()}
          trackingLost={trackingLost}
          onChoose={chooseFromCamera}
        />
      )}
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
