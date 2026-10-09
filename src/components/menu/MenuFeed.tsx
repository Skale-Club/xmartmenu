'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Minus, Play, Plus, Rows3, ShoppingBag } from 'lucide-react'
import { formatPrice } from '@/lib/utils'
import type { Product, ProductMedia } from '@/types/database'
import { getProductImages } from './menu-utils'

interface FeedProps {
  products: Product[]
  productMediaByProductId: Record<string, ProductMedia[]>
  currency: string
  primaryColor: string
  accentColor: string
  autoplayVideos: boolean
  directOrdersEnabled: boolean
  cartCount: number
  exitLabel: string
  hasCustomization: (productId: string) => boolean
  quantityFor: (productId: string) => number
  onExit: () => void
  onOpenCart: () => void
  onOpen: (product: Product) => void
  onAdd: (product: Product) => void
  onIncrement: (product: Product) => void
  onDecrement: (product: Product) => void
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', product: Product, mediaType: 'image' | 'video', mediaIndex: number) => void
}

export default function MenuFeed({
  products,
  productMediaByProductId,
  currency,
  primaryColor,
  accentColor,
  autoplayVideos,
  directOrdersEnabled,
  cartCount,
  exitLabel,
  hasCustomization,
  quantityFor,
  onExit,
  onOpenCart,
  onOpen,
  onAdd,
  onIncrement,
  onDecrement,
  onMediaEvent,
}: FeedProps) {
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
            aria-label={`Open order with ${cartCount} items`}
            className="pointer-events-auto relative flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-xl backdrop-blur-xl transition active:scale-95"
          >
            <ShoppingBag className="size-4" />
            <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-black text-white ring-2 ring-zinc-950" style={{ backgroundColor: primaryColor }}>
              {cartCount}
            </span>
          </button>
        ) : (
          <span className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white/75 backdrop-blur-xl">
            {products.length} dishes
          </span>
        )}
      </div>

      <div tabIndex={0} aria-label="Swipe vertically through dishes" className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain scroll-smooth touch-pan-y outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                onOpen={() => onOpen(product)}
                onMediaEvent={(event, mediaType, mediaIndex) => onMediaEvent(event, product, mediaType, mediaIndex)}
              />

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/95" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-28">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                  <span>{String(index + 1).padStart(2, '0')} / {String(products.length).padStart(2, '0')}</span>
                  <span className="h-px w-8 bg-white/35" />
                  <span>Swipe for next dish</span>
                </div>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {product.is_featured ? <span className="rounded-full border border-amber-300/30 bg-amber-300/20 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-amber-100 backdrop-blur">Chef pick</span> : null}
                  {product.tags?.slice(0, 2).map(tag => <span key={tag} className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white/85 backdrop-blur">{tag}</span>)}
                </div>

                <div className="flex items-end justify-between gap-5">
                  <h2 className="max-w-[72%] text-[clamp(1.75rem,8vw,2.65rem)] font-black leading-[0.95] tracking-[-0.045em] text-white drop-shadow-lg">{product.name}</h2>
                  <p className="shrink-0 text-xl font-black tracking-tight text-white drop-shadow-lg">{formatPrice(product.price, currency)}</p>
                </div>

                {product.description ? <p className="mt-3 line-clamp-2 max-w-[90%] text-sm font-medium leading-relaxed text-white/75 drop-shadow">{product.description}</p> : null}

                <div className="pointer-events-auto mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onOpen(product)}
                    aria-label={`View details for ${product.name}`}
                    className="flex size-12 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur-xl transition active:scale-90"
                  >
                    <Eye className="size-4" />
                  </button>

                  {directOrdersEnabled && quantity === 0 ? (
                    <button
                      type="button"
                      onClick={() => customizable ? onOpen(product) : onAdd(product)}
                      className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full px-5 text-xs font-black uppercase tracking-widest text-white shadow-2xl transition active:scale-[0.98]"
                      style={{ backgroundColor: primaryColor, boxShadow: `0 18px 45px ${primaryColor}45` }}
                    >
                      <ShoppingBag className="size-4" /> {customizable ? 'Customize' : 'Order now'}
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
                      View dish
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function FeedMedia({
  product,
  media,
  priority,
  panDirection,
  autoplay,
  onOpen,
  onMediaEvent,
}: {
  product: Product
  media: ProductMedia[]
  priority: boolean
  panDirection: 'alternate' | 'alternate-reverse'
  autoplay: boolean
  onOpen: () => void
  onMediaEvent: (event: 'media_started' | 'media_completed' | 'media_swiped', mediaType: 'image' | 'video', index: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const [nearViewport, setNearViewport] = useState(priority)
  const [active, setActive] = useState(false)
  const [mediaIndex, setMediaIndex] = useState(0)
  const orderedMedia = [...media].sort((a, b) => a.display_order - b.display_order)
  const images = getProductImages(product)
  const slides: Array<{ type: 'image' | 'video'; url: string }> = orderedMedia.length > 0
    ? orderedMedia.map(item => ({ type: item.type, url: item.url }))
    : images.map(url => ({ type: 'image' as const, url }))
  const current = slides[mediaIndex] ?? null
  const directVideo = current?.type === 'video' && /\.(mp4|webm|ogg)(?:$|\?)/i.test(current.url)
  const imageUrl = current?.type === 'image' ? current.url : null

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

  function moveMedia(direction: -1 | 1) {
    if (slides.length < 2) return
    const nextIndex = (mediaIndex + direction + slides.length) % slides.length
    const next = slides[nextIndex]
    startedRef.current = false
    completedRef.current = false
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
          loop
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
          <span className="text-7xl">🍽️</span><span className="text-[10px] font-black uppercase tracking-[0.24em]">View dish</span>
        </button>
      )}

      {current?.type === 'video' && !directVideo ? (
        <button type="button" onClick={onOpen} className="absolute inset-0 flex items-center justify-center bg-black/15" aria-label={`Open ${product.name} video in details`}><span className="flex size-14 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur"><Play className="ml-1 size-5 fill-current" /></span></button>
      ) : null}

      {slides.length > 1 ? (
        <>
          <button type="button" onClick={() => moveMedia(-1)} aria-label={`Previous media for ${product.name}`} className="absolute left-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition active:scale-90"><ChevronLeft className="size-5" /></button>
          <button type="button" onClick={() => moveMedia(1)} aria-label={`Next media for ${product.name}`} className="absolute right-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition active:scale-90"><ChevronRight className="size-5" /></button>
          <div className="absolute left-1/2 top-[max(5rem,calc(env(safe-area-inset-top)+4rem))] z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-2 backdrop-blur" aria-label={`Media ${mediaIndex + 1} of ${slides.length}`}>
            {slides.map((slide, index) => <span key={`${slide.url}-${index}`} className={`h-1.5 rounded-full transition-all ${index === mediaIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/45'}`} />)}
          </div>
        </>
      ) : null}
    </div>
  )
}
