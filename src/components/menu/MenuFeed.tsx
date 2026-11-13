'use client'

import Image from 'next/image'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Eye, Minus, Play, Plus, ShoppingBag, X } from 'lucide-react'
import { fill, formatMoney, getMenuCopy } from './menu-i18n'
import { dishFeature } from '@/lib/menu/dish-tags'
import DishFeaturePill from './DishFeaturePill'
import { ctaStyle, ui } from './menu-ui'
import type { Product, ProductMedia, PublicProductArModel } from '@/types/database'
import ArButton, { type ArCart, type ArSequenceItem } from '@/components/ar/ArButton'
import FeedDescription from './FeedDescription'
import FeedSizeSheet from './FeedSizeSheet'
import type { FeedSize } from './feed-sizes'
import type { DishDetail } from '@/lib/public-dish-details'
import { getFeedSlideDuration, getProductImages, orderFeedMedia } from './menu-utils'
import { LOOP_COPIES, dishAt, dragOffset, lockAxis, loops, recenter, resolveSwipe, startPosition, type SwipeAxis } from './feed-gestures'
import DishHeading from './DishHeading'

function feedImageSrc(url: string) {
  if (!url.includes('/brands/celes-confections/')) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=20261029`
}

interface FeedProps {
  products: Product[]
  productMediaByProductId: Record<string, ProductMedia[]>
  currency: string
  /** The guest's language, for every label and the price format. */
  lang: string
  primaryColor: string
  accentColor: string
  autoplayVideos: boolean
  directOrdersEnabled: boolean
  cartCount: number
  /** The order as the AR camera's order sheet shows it. */
  arOrder?: ArCart['summary']
  /** The menu's 3D dishes, to walk through inside the camera. */
  arSequence?: ArSequenceItem[]
  /** Adds one of a dish without options from the AR camera (no upsell, the camera stays open). */
  onAddFromAr?: (product: Product) => void
  exitLabel: string
  hasCustomization: (productId: string) => boolean
  /** Sizes to pick from before adding; [] when the dish has none to pick on the feed. */
  sizesFor: (product: Product) => FeedSize[]
  /** Ingredient and allergen notes shown when the description is expanded. */
  detailsFor: (product: Product) => DishDetail[]
  /** Photos shown after the dish's own (e.g. the whole cake). */
  extraImagesFor: (product: Product) => string[]
  quantityFor: (productId: string) => number
  onExit: () => void
  onOpenCart: () => void
  onOpen: (product: Product) => void
  onAdd: (product: Product, size?: FeedSize) => void
  onIncrement: (product: Product) => void
  onDecrement: (product: Product) => void
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', product: Product, mediaType: 'image' | 'video', mediaIndex: number) => void
  /** Dish to open on (restored after a reload). */
  initialIndex?: number
  /** Reports the dish on screen, so the page can restore it. */
  onIndexChange?: (index: number) => void
  /** The price as shown on the dish ("From $15.00" for a dish with sizes); defaults to its own price. */
  priceLabel?: (product: Product) => string
  /** The dish's 3D model: a round cube button opens it on the guest's table (phones with an AR camera only). */
  arModelFor?: (product: Product) => PublicProductArModel | null
  onArOpened?: (product: Product) => void
  onArLaunched?: (product: Product) => void
}

/**
 * The visual feed (phones): one dish per screen, Instagram-style.
 *
 * Navigation rules (owner, 2026-11-12: "smooth, perfect"):
 * - Vertical: native scroll with mandatory snapping, one dish per swipe. Only
 *   the guest's finger changes dish: there is no automatic jump to the next
 *   dish (it fought the finger and left the feed stuck on the previous page).
 * - Pages are exactly the scroller's height (no 100dvh): when the browser bar
 *   shows or hides, every snap point moves together.
 * - Endless: the dish list is rendered three times; once a scroll settles in
 *   the first or last copy, it jumps to the identical card in the middle copy
 *   (feed-gestures.ts `recenter`), so the feed never ends.
 * - The page is told the dish on screen only once a scroll has settled.
 * - Horizontal: a real photo carousel per dish (the neighbour slides in with
 *   the finger); photos advance on their own and loop within the dish.
 * - Each card keeps its own state, so a photo change re-renders one card.
 */
export default function MenuFeed({
  products,
  productMediaByProductId,
  currency,
  lang,
  primaryColor,
  accentColor,
  autoplayVideos,
  directOrdersEnabled,
  cartCount,
  arOrder,
  arSequence,
  onAddFromAr,
  exitLabel,
  hasCustomization,
  sizesFor,
  detailsFor,
  extraImagesFor,
  quantityFor,
  onExit,
  onOpenCart,
  onOpen,
  onAdd,
  onIncrement,
  onDecrement,
  onMediaEvent,
  initialIndex = 0,
  onIndexChange,
  priceLabel,
  arModelFor,
  onArOpened,
  onArLaunched,
}: FeedProps) {
  const copy = getMenuCopy(lang)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const count = products.length
  const positions = loops(count) ? count * LOOP_COPIES : count
  // The first card shown: the restored dish, in the middle copy. Fixed for this mount.
  const [startAt] = useState(() => startPosition(initialIndex, count))
  const lastDishRef = useRef(dishAt(startAt, count))
  const onIndexChangeRef = useRef(onIndexChange)
  useEffect(() => { onIndexChangeRef.current = onIndexChange })
  const [sizePick, setSizePick] = useState<{ product: Product; sizes: FeedSize[] } | null>(null)

  // Land on the start card before the first paint, without animating through the others.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || startAt === 0) return
    scroller.scrollTo({ top: startAt * scroller.clientHeight, behavior: 'instant' })
    // Mount-only: initialIndex is a starting point, not a controlled value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When a scroll has fully settled (finger up, momentum over): recentre the
  // endless loop and report the dish on screen. Never in the middle of a move.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let touching = false
    let timer = 0
    const settle = () => {
      window.clearTimeout(timer)
      if (touching || scroller.clientHeight === 0) return
      const height = scroller.clientHeight
      const position = Math.round(scroller.scrollTop / height)
      // Only once the snap has landed exactly on a card.
      if (Math.abs(scroller.scrollTop - position * height) > 2) return
      const target = recenter(position, count)
      if (target !== position) scroller.scrollTo({ top: target * height, behavior: 'instant' })
      const dish = dishAt(position, count)
      if (dish !== lastDishRef.current) {
        lastDishRef.current = dish
        onIndexChangeRef.current?.(dish)
      }
    }
    // `scrollend` where the browser has it; a short idle timer everywhere else.
    const onScroll = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(settle, 140)
    }
    const onTouchStart = () => { touching = true; window.clearTimeout(timer) }
    const onTouchEnd = () => { touching = false; onScroll() }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('scrollend', settle)
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchend', onTouchEnd, { passive: true })
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.clearTimeout(timer)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', settle)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [count])

  return (
    <section className="fixed inset-0 z-40 bg-zinc-950 text-white md:hidden" aria-label="Visual menu feed">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        {/* Leave the feed: a plain X, the same in every app. */}
        <button
          type="button"
          onClick={onExit}
          aria-label={exitLabel}
          title={exitLabel}
          className="pointer-events-auto flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-xl backdrop-blur-xl transition active:scale-95"
        >
          <X className="size-5" />
        </button>

        {directOrdersEnabled && cartCount > 0 ? (
          <button
            type="button"
            onClick={onOpenCart}
            aria-label={fill(copy.openOrderCount, { count: cartCount })}
            className="pointer-events-auto relative flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-xl backdrop-blur-xl transition active:scale-95"
          >
            <ShoppingBag className="size-4" />
            <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-black text-white ring-2 ring-zinc-950" style={{ backgroundColor: primaryColor }}>
              {cartCount}
            </span>
          </button>
        ) : null /* No dish-count chip: the card's "02 / 05" already says it, and the feed is endless. */}
      </div>

      <div
        ref={scrollerRef}
        tabIndex={0}
        aria-label="Swipe vertically through dishes"
        className="absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-y-contain touch-pan-y outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {Array.from({ length: positions }, (_, position) => {
          const index = dishAt(position, count)
          const product = products[index]
          if (!product) return null
          return (
            <FeedCard
              key={`${position}-${product.id}`}
              product={product}
              index={index}
              count={count}
              priority={position === startAt}
              panDirection={index % 2 === 0 ? 'alternate' : 'alternate-reverse'}
              media={productMediaByProductId[product.id] ?? []}
              extraImages={extraImagesFor(product)}
              autoplay={autoplayVideos}
              copy={copy}
              lang={lang}
              currency={currency}
              primaryColor={primaryColor}
              accentColor={accentColor}
              directOrdersEnabled={directOrdersEnabled}
              cartCount={cartCount}
              arOrder={arOrder}
              arSequence={arSequence}
              arModel={arModelFor?.(product) ?? null}
              quantity={quantityFor(product.id)}
              customizable={hasCustomization(product.id)}
              sizes={sizesFor(product)}
              details={detailsFor(product)}
              price={priceLabel ? priceLabel(product) : formatMoney(product.price, currency, lang)}
              onOpen={onOpen}
              onAdd={onAdd}
              onPickSize={(sizes) => setSizePick({ product, sizes })}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              onOpenCart={onOpenCart}
              onAddFromAr={onAddFromAr}
              onArOpened={onArOpened}
              onArLaunched={onArLaunched}
              onMediaEvent={onMediaEvent}
            />
          )
        })}
      </div>

      {sizePick ? (
        <FeedSizeSheet
          productName={sizePick.product.name}
          sizes={sizePick.sizes}
          currency={currency}
          lang={lang}
          primaryColor={primaryColor}
          onClose={() => setSizePick(null)}
          onConfirm={size => {
            onAdd(sizePick.product, size)
            setSizePick(null)
          }}
        />
      ) : null}
    </section>
  )
}

/** One dish, one screen: its own photo state, so a photo change re-renders only this card. */
function FeedCard({
  product, index, count, priority, panDirection, media, extraImages, autoplay, copy, lang, currency,
  primaryColor, accentColor, directOrdersEnabled, cartCount, arOrder, arSequence, arModel, quantity,
  customizable, sizes, details, price, onOpen, onAdd, onPickSize, onIncrement, onDecrement, onOpenCart,
  onAddFromAr, onArOpened, onArLaunched, onMediaEvent,
}: {
  product: Product
  index: number
  count: number
  priority: boolean
  panDirection: 'alternate' | 'alternate-reverse'
  media: ProductMedia[]
  extraImages: string[]
  autoplay: boolean
  copy: ReturnType<typeof getMenuCopy>
  lang: string
  currency: string
  primaryColor: string
  accentColor: string
  directOrdersEnabled: boolean
  cartCount: number
  arOrder?: ArCart['summary']
  arSequence?: ArSequenceItem[]
  arModel: PublicProductArModel | null
  quantity: number
  customizable: boolean
  sizes: FeedSize[]
  details: DishDetail[]
  price: string
  onOpen: (product: Product) => void
  onAdd: (product: Product, size?: FeedSize) => void
  onPickSize: (sizes: FeedSize[]) => void
  onIncrement: (product: Product) => void
  onDecrement: (product: Product) => void
  onOpenCart: () => void
  onAddFromAr?: (product: Product) => void
  onArOpened?: (product: Product) => void
  onArLaunched?: (product: Product) => void
  onMediaEvent: FeedProps['onMediaEvent']
}) {
  const articleRef = useRef<HTMLElement | null>(null)
  const [slides, setSlides] = useState({ index: 0, count: 0 })
  const reportSlides = useCallback((slideIndex: number, slideCount: number) => {
    setSlides(prev => (prev.index === slideIndex && prev.count === slideCount ? prev : { index: slideIndex, count: slideCount }))
  }, [])
  // The AR button (which preloads a 3D model) only exists on cards near the screen.
  const [near, setNear] = useState(priority)
  useEffect(() => {
    const node = articleRef.current
    if (!node) return
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0]
      if (entry) setNear(entry.isIntersecting)
    }, { rootMargin: '100% 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <article
      ref={articleRef}
      data-analytics-product-id={product.id}
      data-analytics-source="feed"
      aria-label={`${product.name}, dish ${index + 1} of ${count}`}
      className="group relative h-full snap-start snap-always overflow-hidden bg-zinc-950"
    >
      <FeedMedia
        product={product}
        media={media}
        extraImages={extraImages}
        onSlidesChange={reportSlides}
        priority={priority}
        panDirection={panDirection}
        autoplay={autoplay}
        onOpen={() => onOpen(product)}
        viewDishLabel={copy.viewDish}
        onMediaEvent={(event, mediaType, mediaIndex) => onMediaEvent(event, product, mediaType, mediaIndex)}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/95" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-28">
        {slides.count > 1 ? <SlideDots count={slides.count} index={slides.index} label={product.name} /> : null}

        <div className={`mb-3 flex items-center gap-2 ${ui.label} text-white/65`}>
          <span>{String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}</span>
          <span className="h-px w-8 bg-white/35" />
          <span>{copy.swipeNext}</span>
        </div>

        {/* One feature per dish (dishFeature), the system-wide pill. */}
        {(() => { const feature = dishFeature(product); return feature ? <div className="mb-3 flex"><DishFeaturePill tag={feature} lang={lang} tone="glass" /></div> : null })()}

        <DishHeading size="feed" name={product.name} price={price} className="gap-5"
          titleClassName="text-white drop-shadow-lg" priceClassName="text-white drop-shadow-lg" />

        {product.description ? <FeedDescription text={product.description} details={details} seeMore={copy.seeMore} seeLess={copy.seeLess} /> : null}

        <div className="pointer-events-auto mt-5 flex items-center gap-3">
          {arModel && near ? (
            <ArButton
              iconOnly
              model={arModel}
              name={product.name}
              lang={lang}
              onOpen={() => onArOpened?.(product)}
              onMoreInfo={() => onOpen(product)}
              onArLaunch={() => onArLaunched?.(product)}
              priceLabel={price}
              details={{ description: product.description }}
              theme={{ primary: primaryColor, accent: accentColor }}
              sequence={arSequence && arSequence.length > 1 ? { items: arSequence, startId: product.id } : null}
              cart={directOrdersEnabled && onAddFromAr ? (
                sizes.length > 0 || customizable
                  ? { mode: 'choose', count: cartCount, summary: arOrder, onOpenCart, onAdd: () => {}, onChoose: () => onOpen(product) }
                  : {
                      mode: 'add', count: cartCount, summary: arOrder, onOpenCart,
                      priceLabel: price,
                      quantity,
                      onRemove: () => onDecrement(product),
                      lineLabel: formatMoney(product.price * quantity, currency, lang),
                      onAdd: () => onAddFromAr(product),
                      onChoose: () => onOpen(product),
                    }
              ) : null}
              className="flex size-12 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-xl transition active:scale-90"
            />
          ) : null}
          {/* View-only menu: "View dish" below is the one action. */}
          {directOrdersEnabled ? (
            <button
              type="button"
              onClick={() => onOpen(product)}
              aria-label={`${copy.viewDish}: ${product.name}`}
              className="flex size-12 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-xl transition active:scale-90"
            >
              <Eye className="size-4" />
            </button>
          ) : null}

          {directOrdersEnabled && quantity === 0 ? (
            <button
              type="button"
              onClick={() => {
                if (sizes.length > 0) onPickSize(sizes)
                else if (customizable) onOpen(product)
                else onAdd(product)
              }}
              className={`${ui.cta} min-h-12 flex-1`}
              style={ctaStyle(primaryColor, '#ffffff')}
            >
              <ShoppingBag className="size-4" /> {copy.orderNow}
            </button>
          ) : null}

          {directOrdersEnabled && quantity > 0 ? (
            <div className="flex min-h-12 flex-1 items-center justify-between overflow-hidden rounded-full border border-white/20 bg-white text-zinc-950 shadow-2xl">
              <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => onDecrement(product)} className="flex h-12 w-12 items-center justify-center transition hover:bg-zinc-100 active:scale-90"><Minus className="size-4" /></button>
              <span className="text-xs font-black uppercase tracking-wider tabular-nums">{quantity} in order</span>
              <button type="button" aria-label={`Add one ${product.name}`} onClick={() => onIncrement(product)} className="flex h-12 w-12 items-center justify-center transition hover:bg-zinc-100 active:scale-90"><Plus className="size-4" /></button>
            </div>
          ) : null}

          {!directOrdersEnabled ? (
            <button
              type="button"
              onClick={() => onOpen(product)}
              className="min-h-12 flex-1 rounded-full bg-white px-5 text-xs font-black uppercase tracking-widest"
              style={{ color: accentColor }}
            >
              {copy.viewDish}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function FeedMedia({
  product,
  media,
  extraImages,
  onSlidesChange,
  priority,
  panDirection,
  autoplay,
  onOpen,
  viewDishLabel,
  onMediaEvent,
}: {
  product: Product
  media: ProductMedia[]
  extraImages: string[]
  onSlidesChange: (index: number, count: number) => void
  priority: boolean
  panDirection: 'alternate' | 'alternate-reverse'
  autoplay: boolean
  onOpen: () => void
  viewDishLabel: string
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', mediaType: 'image' | 'video', index: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const advanceGuardRef = useRef(false)
  const [nearViewport, setNearViewport] = useState(priority)
  const [active, setActive] = useState(false)
  const [mediaIndex, setMediaIndex] = useState(0)
  // Horizontal drag inside the dish (feed-gestures.ts): the photo track follows
  // the finger without re-rendering (written straight to the track's style),
  // then animates to the next/previous photo or springs back.
  const gestureRef = useRef<{ pointerId: number; startX: number; startY: number; startedAt: number; axis: SwipeAxis | null } | null>(null)
  const [dragging, setDragging] = useState(false)
  // A finger (or the mouse button) on the photo freezes the progress bar, the drift and any video.
  const [held, setHeld] = useState(false)
  const orderedMedia = useMemo(() => orderFeedMedia(media), [media])
  const images = useMemo(() => getProductImages(product), [product])
  const slides = useMemo<Array<{ type: 'image' | 'video'; url: string }>>(() => (
    orderedMedia.length > 0
      ? orderedMedia.map(item => ({ type: item.type, url: item.url }))
      : images.map(url => ({ type: 'image' as const, url }))
  ).concat(extraImages.map(url => ({ type: 'image' as const, url }))), [extraImages, images, orderedMedia])
  const current = slides[mediaIndex] ?? null

  useEffect(() => {
    onSlidesChange(mediaIndex, slides.length)
  }, [mediaIndex, onSlidesChange, slides.length])

  const placeTrack = useCallback((offsetPx: number, animate: boolean) => {
    const track = trackRef.current
    if (!track) return
    track.style.transition = animate ? 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
    track.style.transform = `translate3d(calc(${-mediaIndex * 100}% + ${offsetPx}px), 0, 0)`
  }, [mediaIndex])
  // Every photo change animates the track to the new photo.
  useEffect(() => { placeTrack(0, true) }, [placeTrack])

  const goTo = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= slides.length || nextIndex === mediaIndex) return
    const next = slides[nextIndex]
    startedRef.current = false
    completedRef.current = false
    advanceGuardRef.current = false
    setMediaIndex(nextIndex)
    onMediaEvent('media_swiped', next.type, nextIndex)
  }, [mediaIndex, onMediaEvent, slides])

  // The progress bar or a video ended: next photo, or back to the first one.
  // Never the next dish: only the guest changes dish.
  const advanceTimed = useCallback(() => {
    if (!current || advanceGuardRef.current) return
    advanceGuardRef.current = true
    if (!completedRef.current) {
      completedRef.current = true
      onMediaEvent('media_completed', current.type, mediaIndex)
    }
    if (slides.length < 2) return
    goTo(mediaIndex < slides.length - 1 ? mediaIndex + 1 : 0)
  }, [current, goTo, mediaIndex, onMediaEvent, slides.length])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      if (entry.isIntersecting) setNearViewport(true)
      setActive(entry.isIntersecting && entry.intersectionRatio >= 0.7)
    }, { threshold: [0, 0.7] })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (active && autoplay && !reducedMotion && !held) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [active, autoplay, held, nearViewport, mediaIndex])

  useEffect(() => {
    startedRef.current = false
    completedRef.current = false
    advanceGuardRef.current = false
  }, [current?.url, mediaIndex])

  useEffect(() => {
    if (active) advanceGuardRef.current = false
  }, [active])

  useEffect(() => {
    if (!active || current?.type !== 'image' || startedRef.current) return
    startedRef.current = true
    onMediaEvent('media_started', 'image', mediaIndex)
  }, [active, current?.type, mediaIndex, onMediaEvent])

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: performance.now(), axis: null }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    const wasLocked = gesture.axis
    gesture.axis = lockAxis(dx, dy, gesture.axis)
    // Vertical belongs to the scroller (touch-action: pan-y): leave it alone.
    if (gesture.axis !== 'horizontal') return
    if (!wasLocked) {
      setDragging(true)
      setHeld(true)
    }
    placeTrack(dragOffset(dx, slides.length, mediaIndex), false)
  }

  function endGesture(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    if (gesture.axis !== 'horizontal') return
    setDragging(false)
    setHeld(false)
    const dx = event.clientX - gesture.startX
    const direction = cancelled ? 0 : resolveSwipe(dx, performance.now() - gesture.startedAt, slides.length, mediaIndex)
    if (direction !== 0) goTo(mediaIndex + direction)
    else placeTrack(0, true)
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-zinc-950"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={event => endGesture(event, false)}
      onPointerCancel={event => endGesture(event, true)}
    >
      {/* Photo track: every photo side by side; only the current one and its neighbours load. */}
      <div ref={trackRef} className="absolute inset-0 flex will-change-transform" style={{ transform: `translate3d(${-mediaIndex * 100}%, 0, 0)` }}>
        {slides.length === 0 ? (
          <button type="button" onClick={onOpen} className="flex h-full w-full shrink-0 flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,_#27272a,_#09090b_70%)] text-white/60">
            <span className="text-7xl">🍽️</span><span className="text-[10px] font-black uppercase tracking-[0.24em]">{viewDishLabel}</span>
          </button>
        ) : slides.map((slide, slideIndex) => {
          const isCurrent = slideIndex === mediaIndex
          const nearSlide = Math.abs(slideIndex - mediaIndex) <= 1
          const direct = slide.type === 'video' && /\.(mp4|webm|ogg)(?:$|\?)/i.test(slide.url)
          return (
            <div key={`${slide.url}-${slideIndex}`} className="relative h-full w-full shrink-0 overflow-hidden">
              {!nearSlide || !nearViewport && !priority ? null : slide.type === 'image' ? (
                <Image
                  src={feedImageSrc(slide.url)}
                  alt={isCurrent ? product.name : ''}
                  fill
                  priority={priority && isCurrent}
                  draggable={false}
                  className={`object-cover ${isCurrent && active ? 'menu-feed-image-pan' : 'translate-y-10 scale-[1.08]'}`}
                  style={{ animationDirection: panDirection, animationPlayState: held || dragging ? 'paused' : 'running' }}
                  sizes="100vw"
                />
              ) : direct && isCurrent ? (
                <video
                  key={slide.url}
                  ref={videoRef}
                  src={slide.url}
                  poster={images[0]}
                  muted
                  playsInline
                  loop={slides.length === 1}
                  controls={!autoplay}
                  preload="metadata"
                  className="h-full w-full object-cover"
                  aria-label={`${product.name} video`}
                  onPlay={() => {
                    if (startedRef.current) return
                    startedRef.current = true
                    onMediaEvent('media_started', 'video', mediaIndex)
                  }}
                  onEnded={advanceTimed}
                  onTimeUpdate={event => {
                    const video = event.currentTarget
                    if (completedRef.current || !Number.isFinite(video.duration) || video.duration <= 0) return
                    if (video.currentTime / video.duration >= 0.9) {
                      completedRef.current = true
                      onMediaEvent('media_completed', 'video', mediaIndex)
                    }
                  }}
                />
              ) : direct ? (
                images[0] ? <Image src={feedImageSrc(images[0])} alt="" fill className="object-cover" sizes="100vw" /> : null
              ) : (
                <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center bg-black/15" aria-label={`Open ${product.name} video in details`}><span className="flex size-14 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur"><Play className="ml-1 size-5 fill-current" /></span></button>
              )}
            </div>
          )
        })}
      </div>

      {slides.length > 0 ? (
        <div className="absolute inset-x-4 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))] z-10 flex gap-1" role="group" aria-label={`Media ${mediaIndex + 1} of ${slides.length}${slides.length > 1 ? ' — swipe sideways for more' : ''}`}>
          {slides.map((slide, index) => (
            <span key={`${slide.url}-${index}`} className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/30 shadow-sm">
              {index < mediaIndex ? <span className="absolute inset-0 bg-white" /> : null}
              {index === mediaIndex ? (
                <span
                  key={`${slide.url}-${mediaIndex}-${active ? 'active' : 'inactive'}`}
                  className="menu-feed-slide-progress absolute inset-0 bg-white"
                  style={{ animationDuration: `${getFeedSlideDuration(slide.type)}ms`, animationPlayState: active && !held && !dragging ? 'running' : 'paused' }}
                  onAnimationEnd={advanceTimed}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SlideDots({ count, index, label }: { count: number; index: number; label: string }) {
  return (
    <div className="mb-4 flex justify-center gap-1.5" role="img" aria-label={`${label}: photo ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`h-1.5 rounded-full transition-all duration-200 ${i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/45'}`} />
      ))}
    </div>
  )
}
