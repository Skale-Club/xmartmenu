'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Minus, Play, Plus, Rows3, ShoppingBag } from 'lucide-react'
import { fill, formatMoney, getMenuCopy, translateTag } from './menu-i18n'
import type { Product, ProductMedia } from '@/types/database'
import FeedDescription from './FeedDescription'
import FeedSizeSheet from './FeedSizeSheet'
import type { FeedSize } from './feed-sizes'
import type { DishDetail } from '@/lib/public-dish-details'
import { getFeedSlideDuration, getProductImages, orderFeedMedia } from './menu-utils'

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
  exitLabel: string
  hasCustomization: (productId: string) => boolean
  /** Sizes to pick from before adding; [] when the dish has none to pick on the feed. */
  sizesFor: (product: Product) => FeedSize[]
  /** Ingredient and allergen notes shown when the description is expanded. */
  detailsFor: (product: Product) => DishDetail[]
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
}

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
  exitLabel,
  hasCustomization,
  sizesFor,
  detailsFor,
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
}: FeedProps) {
  const copy = getMenuCopy(lang)
  const feedScrollerRef = useRef<HTMLDivElement | null>(null)
  const lastIndexRef = useRef(initialIndex)
  const [sizePick, setSizePick] = useState<{ product: Product; sizes: FeedSize[] } | null>(null)

  // Land on the restored dish without animating through the ones before it.
  useEffect(() => {
    const scroller = feedScrollerRef.current
    const index = Math.min(initialIndex, products.length - 1)
    if (!scroller || index <= 0) return
    scroller.scrollTo({ top: index * scroller.clientHeight, behavior: 'instant' })
    // Mount-only: initialIndex is a starting point, not a controlled value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reportIndex = useCallback(() => {
    const scroller = feedScrollerRef.current
    if (!scroller || !onIndexChange || scroller.clientHeight === 0) return
    const index = Math.round(scroller.scrollTop / scroller.clientHeight)
    if (index !== lastIndexRef.current) {
      lastIndexRef.current = index
      onIndexChange(index)
    }
  }, [onIndexChange])
  const advanceDish = useCallback((dishIndex: number) => {
    const scroller = feedScrollerRef.current
    if (!scroller || dishIndex >= products.length - 1) return
    scroller.scrollTo({ top: (dishIndex + 1) * scroller.clientHeight, behavior: 'smooth' })
  }, [products.length])

  return (
    <section className="fixed inset-0 z-40 bg-zinc-950 text-white md:hidden" aria-label="Visual menu feed">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-black/45 px-4 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-xl backdrop-blur-xl transition active:scale-95"
        >
          <Rows3 className="size-4" /> {exitLabel}
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
        ) : (
          <span className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white/75 backdrop-blur-xl">
            {fill(copy.dishesCount, { count: products.length })}
          </span>
        )}
      </div>

      <div ref={feedScrollerRef} onScroll={reportIndex} tabIndex={0} aria-label="Swipe vertically through dishes" className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain scroll-smooth touch-pan-y outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((product, index) => {
          const quantity = quantityFor(product.id)
          const customizable = hasCustomization(product.id)

          return (
            <article
              key={product.id}
              data-analytics-product-id={product.id}
              data-analytics-source="feed"
              aria-label={`${product.name}, dish ${index + 1} of ${products.length}`}
              className="group relative h-[100dvh] min-h-[100dvh] snap-start snap-always overflow-hidden bg-zinc-950"
            >
              <FeedMedia
                product={product}
                media={productMediaByProductId[product.id] ?? []}
                priority={index === 0}
                panDirection={index % 2 === 0 ? 'alternate' : 'alternate-reverse'}
                autoplay={autoplayVideos}
                dishIndex={index}
                onAdvanceDish={advanceDish}
                onOpen={() => onOpen(product)}
                viewDishLabel={copy.viewDish}
                onMediaEvent={(event, mediaType, mediaIndex) => onMediaEvent(event, product, mediaType, mediaIndex)}
              />

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/95" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-28">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                  <span>{String(index + 1).padStart(2, '0')} / {String(products.length).padStart(2, '0')}</span>
                  <span className="h-px w-8 bg-white/35" />
                  <span>{copy.swipeNext}</span>
                </div>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {product.is_featured ? <span className="rounded-full border border-amber-300/30 bg-amber-300/20 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-amber-100 backdrop-blur">{copy.chefPick}</span> : null}
                  {product.tags?.slice(0, 2).map(tag => <span key={tag} className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white/85 backdrop-blur">{translateTag(tag, lang)}</span>)}
                </div>

                <div className="flex items-end justify-between gap-5">
                  <h2 className="max-w-[72%] text-[clamp(1.75rem,8vw,2.65rem)] font-black leading-[0.95] tracking-[-0.045em] text-white drop-shadow-lg">{product.name}</h2>
                  <p className="shrink-0 text-xl font-black tracking-tight text-white drop-shadow-lg">{priceLabel ? priceLabel(product) : formatMoney(product.price, currency, lang)}</p>
                </div>

                {product.description ? <FeedDescription text={product.description} details={detailsFor(product)} seeMore={copy.seeMore} seeLess={copy.seeLess} /> : null}

                <div className="pointer-events-auto mt-5 flex items-center gap-3">
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
                        const sizes = sizesFor(product)
                        if (sizes.length > 0) setSizePick({ product, sizes })
                        else if (customizable) onOpen(product)
                        else onAdd(product)
                      }}
                      className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full px-5 text-xs font-black uppercase tracking-widest text-white shadow-2xl transition active:scale-[0.98]"
                      style={{ backgroundColor: primaryColor, boxShadow: `0 18px 45px ${primaryColor}45` }}
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

function FeedMedia({
  product,
  media,
  priority,
  panDirection,
  autoplay,
  dishIndex,
  onAdvanceDish,
  onOpen,
  viewDishLabel,
  onMediaEvent,
}: {
  product: Product
  media: ProductMedia[]
  priority: boolean
  panDirection: 'alternate' | 'alternate-reverse'
  autoplay: boolean
  dishIndex: number
  onAdvanceDish: (dishIndex: number) => void
  onOpen: () => void
  viewDishLabel: string
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', mediaType: 'image' | 'video', index: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const advanceGuardRef = useRef(false)
  const [nearViewport, setNearViewport] = useState(priority)
  const [active, setActive] = useState(false)
  const [mediaIndex, setMediaIndex] = useState(0)
  const orderedMedia = useMemo(() => orderFeedMedia(media), [media])
  const images = useMemo(() => getProductImages(product), [product])
  const slides = useMemo<Array<{ type: 'image' | 'video'; url: string }>>(() => (
    orderedMedia.length > 0
      ? orderedMedia.map(item => ({ type: item.type, url: item.url }))
      : images.map(url => ({ type: 'image' as const, url }))
  ), [images, orderedMedia])
  const current = slides[mediaIndex] ?? null
  const directVideo = current?.type === 'video' && /\.(mp4|webm|ogg)(?:$|\?)/i.test(current.url)
  const imageUrl = current?.type === 'image' ? current.url : null

  const advanceTimed = useCallback(() => {
    if (!current || advanceGuardRef.current) return
    advanceGuardRef.current = true

    if (!completedRef.current) {
      completedRef.current = true
      onMediaEvent('media_completed', current.type, mediaIndex)
    }

    if (mediaIndex < slides.length - 1) {
      const nextIndex = mediaIndex + 1
      const next = slides[nextIndex]
      startedRef.current = false
      completedRef.current = false
      setMediaIndex(nextIndex)
      onMediaEvent('media_swiped', next.type, nextIndex)
      return
    }

    onAdvanceDish(dishIndex)
  }, [current, dishIndex, mediaIndex, onAdvanceDish, onMediaEvent, slides])

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
    if (active && autoplay && !reducedMotion) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [active, autoplay, nearViewport, mediaIndex])

  useEffect(() => {
    startedRef.current = false
    completedRef.current = false
    advanceGuardRef.current = false
  }, [current?.url, mediaIndex])

  useEffect(() => {
    if (active) advanceGuardRef.current = false
  }, [active])

  useEffect(() => {
    if (!active || !current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timeout = window.setTimeout(advanceTimed, getFeedSlideDuration(current.type))
    return () => window.clearTimeout(timeout)
  }, [active, advanceTimed, current])

  useEffect(() => {
    if (!active || current?.type !== 'image' || startedRef.current) return
    startedRef.current = true
    onMediaEvent('media_started', 'image', mediaIndex)
  }, [active, current?.type, mediaIndex, onMediaEvent])

  function moveMedia(direction: -1 | 1) {
    if (slides.length < 2) return
    const nextIndex = (mediaIndex + direction + slides.length) % slides.length
    const next = slides[nextIndex]
    startedRef.current = false
    completedRef.current = false
    advanceGuardRef.current = false
    setMediaIndex(nextIndex)
    onMediaEvent('media_swiped', next.type, nextIndex)
  }

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-zinc-950">
      {directVideo && nearViewport ? (
        <video
          key={current.url}
          ref={videoRef}
          src={current.url}
          poster={images[0]}
          muted
          playsInline
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
      ) : imageUrl ? (
        <Image
          src={imageUrl}
          alt={product.name}
          fill
          priority={priority}
          className={`object-cover ${active ? 'menu-feed-image-pan' : 'scale-[1.08]'}`}
          style={{ animationDirection: panDirection }}
          sizes="100vw"
        />
      ) : (
        <button type="button" onClick={onOpen} className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,_#27272a,_#09090b_70%)] text-white/60">
          <span className="text-7xl">🍽️</span><span className="text-[10px] font-black uppercase tracking-[0.24em]">{viewDishLabel}</span>
        </button>
      )}

      {current?.type === 'video' && !directVideo ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center bg-black/15" aria-label={`Open ${product.name} video in details`}><span className="flex size-14 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur"><Play className="ml-1 size-5 fill-current" /></span></button>
      ) : null}

      {slides.length > 1 ? (
        <>
          <button type="button" onClick={() => moveMedia(-1)} aria-label={`Previous media for ${product.name}`} className="absolute left-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition active:scale-90"><ChevronLeft className="size-5" /></button>
          <button type="button" onClick={() => moveMedia(1)} aria-label={`Next media for ${product.name}`} className="absolute right-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition active:scale-90"><ChevronRight className="size-5" /></button>
        </>
      ) : null}

      {slides.length > 0 ? (
        <div className="absolute inset-x-4 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))] z-10 flex gap-1" aria-label={`Media ${mediaIndex + 1} of ${slides.length}`}>
          {slides.map((slide, index) => (
            <span key={`${slide.url}-${index}`} className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/30 shadow-sm">
              {index < mediaIndex ? <span className="absolute inset-0 bg-white" /> : null}
              {index === mediaIndex ? (
                <span
                  key={`${slide.url}-${active ? 'active' : 'inactive'}`}
                  className="menu-feed-slide-progress absolute inset-0 bg-white"
                  style={{ animationDuration: `${getFeedSlideDuration(slide.type)}ms`, animationPlayState: active ? 'running' : 'paused' }}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
